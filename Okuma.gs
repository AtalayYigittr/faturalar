/**
 * Okuma.gs — Fiş, fatura, PDF ve e-Fatura XML okuma.
 *
 * Sıra:
 *  1. XML ise  -> e-Fatura (UBL-TR) olarak doğrudan çözülür (en doğru sonuç).
 *  2. Ayarlarda Gemini API anahtarı varsa -> yapay zekâ ile okunur (fişlerde en iyi sonuç).
 *  3. Aksi halde / hata olursa -> Google Drive OCR ile metne çevrilir, kurallarla ayrıştırılır.
 * Her durumda belge "Harcama Belgeleri" klasörüne kaydedilir ve linki kayda eklenir.
 */

function belgeOku(dosya) {
  if (!dosya || !dosya.base64) throw new Error('Dosya alınamadı.');
  const ad = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss') + '_' + String(dosya.ad || 'belge').replace(/[\\\/:*?"<>|]/g, '_');
  const blob = Utilities.newBlob(Utilities.base64Decode(dosya.base64), dosya.mimeType || 'application/octet-stream', ad);
  const kayitli = klasor_().createFile(blob);

  const notlar = [];
  let sonuc = null;
  const tur = blob.getContentType() || '';
  const xmlMi = /xml/i.test(tur) || /\.xml$/i.test(dosya.ad || '');

  if (xmlMi) {
    sonuc = efaturaXmlAyikla(blob.getDataAsString('UTF-8'));
    sonuc.yontem = 'e-Fatura XML';
    sonuc.kaynak = 'e-Fatura XML';
  } else {
    if (props_().getProperty('GEMINI_API_KEY')) {
      try {
        sonuc = geminiOku_(blob);
        sonuc.yontem = 'Yapay zekâ (Gemini)';
      } catch (e) {
        notlar.push('Yapay zekâ ile okunamadı (' + e.message + '), Google OCR kullanıldı.');
      }
    }
    if (!sonuc) {
      const metin = ocrMetin_(blob);
      sonuc = metindenAyikla(metin);
      sonuc.hamMetin = metin.slice(0, 6000);
      sonuc.yontem = 'Google OCR';
    }
    sonuc.kaynak = /pdf/i.test(tur) ? 'PDF' : 'Fiş/Fatura Fotoğrafı';
  }

  if (!sonuc.kategori && sonuc.firma) sonuc.kategori = firmaKategorisi_(sonuc.firma);
  sonuc.belgeUrl = kayitli.getUrl();
  sonuc.notlar = notlar;
  return sonuc;
}

/** Google Drive OCR: resmi/PDF'i geçici Google Dokümanına çevirip metnini alır, sonra siler. */
function ocrMetin_(blob) {
  const dosya = Drive.Files.create(
    { name: 'ocr_gecici_' + Date.now(), mimeType: MimeType.GOOGLE_DOCS },
    blob,
    { ocrLanguage: 'tr', fields: 'id' }
  );
  try {
    return DocumentApp.openById(dosya.id).getBody().getText();
  } finally {
    try { Drive.Files.remove(dosya.id); } catch (e) { DriveApp.getFileById(dosya.id).setTrashed(true); }
  }
}

/** Gemini ile yapılandırılmış okuma. Anahtar: https://aistudio.google.com/apikey */
function geminiOku_(blob) {
  const p = props_();
  const anahtar = p.getProperty('GEMINI_API_KEY');
  const model = p.getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const kategoriler = kategorileriGetir();

  const istem =
    'Bu bir Türkiye\'de düzenlenmiş fiş, fatura veya e-arşiv faturasıdır. Aşağıdaki alanları çıkar:\n' +
    '- tarih: belge tarihi, YYYY-MM-DD biçiminde\n' +
    '- firma: satıcı firmanın adı/ünvanı\n' +
    '- aciklama: ne satın alındığının kısa Türkçe özeti (en fazla 120 karakter, örn. "Benzin 40 lt" veya "Kırtasiye malzemesi")\n' +
    '- belgeNo: fiş/fatura numarası (yoksa boş)\n' +
    '- toplam: KDV dahil ödenecek toplam tutar (sayı)\n' +
    '- kdv: toplam KDV tutarı (TOPKDV / Hesaplanan KDV toplamı; birden çok oran varsa topla) (sayı)\n' +
    '- kategori: şu listeden en uygun olanı, emin değilsen boş bırak: ' + kategoriler.join(', ') + '\n' +
    'Okuyamadığın alanı boş bırak (sayılar için null). Tahmin uydurma.';

  const govde = {
    contents: [{ parts: [
      { text: istem },
      { inline_data: { mime_type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) } }
    ] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          tarih: { type: 'STRING' }, firma: { type: 'STRING' }, aciklama: { type: 'STRING' },
          belgeNo: { type: 'STRING' }, toplam: { type: 'NUMBER', nullable: true },
          kdv: { type: 'NUMBER', nullable: true }, kategori: { type: 'STRING' }
        }
      }
    }
  };

  const yanit = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': anahtar },
    payload: JSON.stringify(govde),
    muteHttpExceptions: true
  });
  if (yanit.getResponseCode() !== 200) throw new Error('HTTP ' + yanit.getResponseCode() + ' ' + yanit.getContentText().slice(0, 200));

  const j = JSON.parse(yanit.getContentText());
  const metin = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts &&
    j.candidates[0].content.parts.map(function (x) { return x.text || ''; }).join('');
  if (!metin) throw new Error('boş yanıt');
  const v = JSON.parse(metin);

  const sonuc = {
    tarih: tarihBul_(v.tarih || ''),
    firma: String(v.firma || '').trim(),
    aciklama: String(v.aciklama || '').trim(),
    belgeNo: String(v.belgeNo || '').trim(),
    toplam: sayiCoz(v.toplam),
    kdv: sayiCoz(v.kdv),
    kategori: kategoriler.indexOf(v.kategori) >= 0 ? v.kategori : ''
  };
  if (sonuc.toplam !== null) sonuc.toplam = yuvarla2(sonuc.toplam);
  if (sonuc.kdv !== null) sonuc.kdv = yuvarla2(sonuc.kdv);
  sonuc.eksikler = eksikleriBelirle_(sonuc);
  return sonuc;
}
