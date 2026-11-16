/**
 * Ayikla.gs — Fiş / fatura metninden ve e-Fatura (UBL) XML'inden alan çıkarma.
 * Bu dosyadaki fonksiyonlar Apps Script servislerine bağlı değildir (saf JS),
 * böylece bilgisayarda Node ile de test edilebilir.
 */

/** Türkçe karakterleri sadeleştirip büyük harfe çevirir: "Ödenecek Tutar" -> "ODENECEK TUTAR" */
function trNormal_(s) {
  return String(s || '')
    .replace(/̇/g, '')
    .toUpperCase()
    .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C');
}

/** "1.234,56" / "1234,56" / "1,234.56" / "125.50" / "*125,50" -> sayı. Çözülemezse null. */
function sayiCoz(s) {
  if (s === null || s === undefined || s === '') return null;
  if (typeof s === 'number') return isFinite(s) ? s : null;
  let t = String(s).replace(/[^\d.,-]/g, '');
  if (!t) return null;
  const sv = t.lastIndexOf(','), sn = t.lastIndexOf('.');
  if (sv > sn) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (sn > sv) {
    const ondalik = t.length - sn - 1;
    if (ondalik === 3 && sv === -1 && (t.match(/\./g) || []).length >= 1 && !/^0\./.test(t)) {
      t = t.replace(/\./g, ''); // "1.234" -> binlik ayıracı
    } else {
      t = t.replace(/,/g, '');
    }
  }
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
}

function yuvarla2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/** Bir satırdaki tutarları (ondalıklı sayılar) döndürür; tarih ve yüzde ifadelerini atlar. */
function tutarlar_(satir) {
  const temiz = String(satir || '')
    .replace(/\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/g, ' ')   // tarihler
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')                 // saat
    .replace(/%\s*\d+([.,]\d+)?/g, ' ')                      // %20, %1,5
    .replace(/\d+([.,]\d+)?\s*%/g, ' ');
  const re = /(?<![\d.,])(\d{1,3}(?:[.,\s]\d{3})+[.,]\d{2}|\d+[.,]\d{2})(?!\d)/g;
  const sonuc = [];
  let m;
  while ((m = re.exec(temiz)) !== null) {
    const n = sayiCoz(m[1].replace(/\s/g, ''));
    if (n !== null) sonuc.push(n);
  }
  return sonuc;
}

/** Metinden ilk geçerli tarihi "yyyy-MM-dd" olarak döndürür. */
function tarihBul_(metin) {
  const s = String(metin || '');
  let m = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (m && gecerliTarih_(+m[1], +m[2], +m[3])) return tarihYaz_(+m[1], +m[2], +m[3]);
  const re = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?!\d)/g;
  while ((m = re.exec(s)) !== null) {
    let y = +m[3];
    if (y < 100) y += 2000;
    if (gecerliTarih_(y, +m[2], +m[1])) return tarihYaz_(y, +m[2], +m[1]);
  }
  return '';
}
function gecerliTarih_(y, a, g) { return y >= 2000 && y <= 2100 && a >= 1 && a <= 12 && g >= 1 && g <= 31; }
function tarihYaz_(y, a, g) { return y + '-' + String(a).padStart(2, '0') + '-' + String(g).padStart(2, '0'); }

/**
 * OCR metninden fiş/fatura alanlarını çıkarır.
 * Dönen nesne: {tarih, firma, aciklama, belgeNo, toplam, kdv, eksikler[]}
 */
function metindenAyikla(metin) {
  const satirlar = String(metin || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  const N = satirlar.map(trNormal_);

  // Satırdaki tutar yoksa bir alt satıra bak (OCR sütunları ayrı satıra bölebilir)
  function satirTutari(i) {
    let t = tutarlar_(satirlar[i]);
    if (!t.length && i + 1 < satirlar.length) t = tutarlar_(satirlar[i + 1]);
    return t.length ? t[t.length - 1] : null;
  }

  // ---- Toplam ----
  const toplamAnahtarlari = [
    /GENEL\s*TOPLAM/, /ODENECEK\s*TUTAR|ODENECEK\s*TOPLAM|^ODENECEK/, /VERGILER\s*DAHIL\s*TOPLAM/,
    /KDV\s*DAHIL\s*TOPLAM|TOPLAM\s*\(?KDV\s*DAHIL/, /TOPLAM\s*TUTAR/, /\bTOPLAM\b/, /^TUTAR\b/
  ];
  function toplamDislanir(n) {
    if (/ARA\s*TOPLAM|MATRAH|ISKONTO|INDIRIM|MAL\s*HIZMET\s*TOPLAM|HARIC|TOPKDV|TOPLAM\s*MIKTAR|ADET/.test(n)) return true;
    if (/KDV/.test(n) && !/DAHIL/.test(n)) return true;
    return false;
  }
  let toplam = null;
  for (let k = 0; k < toplamAnahtarlari.length && toplam === null; k++) {
    const adaylar = [];
    for (let i = 0; i < N.length; i++) {
      if (toplamAnahtarlari[k].test(N[i]) && !toplamDislanir(N[i])) {
        const t = satirTutari(i);
        if (t !== null) adaylar.push(t);
      }
    }
    if (adaylar.length) toplam = Math.max.apply(null, adaylar);
  }

  // ---- KDV ----
  let kdv = null;
  const kdvToplamRe = /TOPKDV|TOP\.?\s*KDV|TOPLAM\s*KDV|KDV\s*TOPLAM|TOPLAM\s*VERGI/;
  const kdvSatirRe = /HESAPLANAN\s*KDV|KDV\s*TUTARI/;
  let adaylar = [];
  N.forEach(function (n, i) { if (kdvToplamRe.test(n) && !/DAHIL/.test(n)) { const t = satirTutari(i); if (t !== null) adaylar.push(t); } });
  if (adaylar.length) kdv = Math.max.apply(null, adaylar);
  if (kdv === null) {
    adaylar = [];
    N.forEach(function (n, i) { if (kdvSatirRe.test(n)) { const t = satirTutari(i); if (t !== null) adaylar.push(t); } });
    if (adaylar.length) kdv = yuvarla2(adaylar.reduce(function (a, b) { return a + b; }, 0));
  }
  if (kdv === null) {
    adaylar = [];
    N.forEach(function (n, i) {
      if (/\bKDV\b/.test(n) && /%|\bKDV\s*\d/.test(satirlar[i] + n) && !/DAHIL|HARIC|MATRAH|ORANI/.test(n)) {
        const t = tutarlar_(satirlar[i]);
        if (t.length) adaylar.push(t[t.length - 1]);
      }
    });
    if (adaylar.length) kdv = yuvarla2(adaylar.reduce(function (a, b) { return a + b; }, 0));
  }

  // ---- Tarih: önce "TARİH" geçen satırlar ----
  let tarih = '';
  for (let i = 0; i < N.length && !tarih; i++) if (/TARIH/.test(N[i])) tarih = tarihBul_(satirlar[i]) || (i + 1 < satirlar.length ? tarihBul_(satirlar[i + 1]) : '');
  if (!tarih) tarih = tarihBul_(satirlar.join('\n'));

  // ---- Belge no ----
  let belgeNo = '';
  for (let i = 0; i < N.length && !belgeNo; i++) {
    const m = N[i].match(/(?:FIS|FATURA|BELGE|EVRAK|Z)\s*(?:NO|NUMARASI|NUMARA|NR)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-\/]*)/);
    if (m) belgeNo = m[1];
  }
  if (!belgeNo) {
    const m = N.join(' ').match(/\b[A-Z0-9]{3}20\d{2}\d{9}\b/); // e-Fatura / e-Arşiv numarası (16 hane)
    if (m) belgeNo = m[0];
  }

  // ---- Firma: harf içeren ilk anlamlı satır ----
  let firma = '';
  for (let i = 0; i < Math.min(N.length, 8) && !firma; i++) {
    if (/[A-Z]{3,}/.test(N[i]) && !/TARIH|SAAT|FIS\s*NO|E-?ARSIV|^FATURA$|^FIS$|TESEKKUR|HOSGELDINIZ|HOS\s*GELDINIZ/.test(N[i])) {
      firma = satirlar[i].replace(/\s{2,}/g, ' ').slice(0, 80);
    }
  }

  const sonuc = {
    tarih: tarih,
    firma: firma,
    aciklama: firma ? firma + ' alımı' : '',
    belgeNo: belgeNo,
    toplam: toplam !== null ? yuvarla2(toplam) : null,
    kdv: kdv !== null ? yuvarla2(kdv) : null
  };
  sonuc.eksikler = eksikleriBelirle_(sonuc, ['aciklama']);
  return sonuc;
}

/** Okunamayan / şüpheli alanları listeler. "kontrol" listesi her zaman göz atılması önerilen alanlardır. */
function eksikleriBelirle_(s, kontrol) {
  const e = [];
  if (!s.tarih) e.push('tarih');
  if (s.toplam === null || s.toplam === undefined || !(s.toplam > 0)) e.push('toplam');
  if (s.kdv === null || s.kdv === undefined) e.push('kdv');
  else if (s.toplam > 0 && s.kdv > s.toplam * 0.5) e.push('kdv');
  if (!s.aciklama) e.push('aciklama');
  (kontrol || []).forEach(function (k) { if (e.indexOf(k) < 0) e.push(k); });
  return e;
}

// ----------------------------------------------------------------------------
// e-Fatura / e-Arşiv UBL-TR XML
// ----------------------------------------------------------------------------
function xmlCoz_(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
    .replace(/&amp;/g, '&').trim();
}
/** İlk <ön-ek:ad>...</ön-ek:ad> bloğunun iç XML'i */
function xmlBlok_(xml, ad) {
  const re = new RegExp('<(?:[\\w-]+:)?' + ad + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?' + ad + '>');
  const m = String(xml || '').match(re);
  return m ? m[1] : '';
}
function xmlTumBloklar_(xml, ad) {
  const re = new RegExp('<(?:[\\w-]+:)?' + ad + '(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?' + ad + '>', 'g');
  const out = []; let m;
  while ((m = re.exec(String(xml || ''))) !== null) out.push(m[1]);
  return out;
}
function xmlDeger_(xml, ad) { return xmlCoz_(xmlBlok_(xml, ad)); }

/** UBL-TR e-Fatura XML'inden alanları çıkarır. */
function efaturaXmlAyikla(xml) {
  let x = String(xml || '');
  if (!/<(?:[\w-]+:)?Invoice[\s>]/.test(x)) throw new Error('Bu dosya bir e-Fatura (UBL Invoice) XML\'i değil.');
  x = x.replace(/<(?:[\w-]+:)?UBLExtensions[\s\S]*?<\/(?:[\w-]+:)?UBLExtensions>/, '');

  const satirBas = x.search(/<(?:[\w-]+:)?InvoiceLine[\s>]/);
  const ust = satirBas > 0 ? x.slice(0, satirBas) : x;

  const tedarikci = xmlBlok_(ust, 'AccountingSupplierParty');
  let firma = xmlDeger_(tedarikci, 'RegistrationName') || xmlDeger_(xmlBlok_(tedarikci, 'PartyName'), 'Name');
  if (!firma) {
    const kisi = xmlBlok_(tedarikci, 'Person');
    firma = (xmlDeger_(kisi, 'FirstName') + ' ' + xmlDeger_(kisi, 'FamilyName')).trim();
  }

  const parasal = xmlBlok_(ust, 'LegalMonetaryTotal');
  const toplam = sayiCoz(xmlDeger_(parasal, 'TaxInclusiveAmount')) || sayiCoz(xmlDeger_(parasal, 'PayableAmount'));
  const vergiBlok = xmlBlok_(ust, 'TaxTotal');
  let kdv = sayiCoz(xmlDeger_(vergiBlok, 'TaxAmount'));

  const kalemler = xmlTumBloklar_(x, 'InvoiceLine').map(function (b) { return xmlDeger_(xmlBlok_(b, 'Item'), 'Name'); }).filter(Boolean);
  let aciklama = kalemler.slice(0, 10).join(', ');
  if (kalemler.length > 10) aciklama += ' (+' + (kalemler.length - 10) + ' kalem)';
  if (aciklama.length > 250) aciklama = aciklama.slice(0, 247) + '...';

  const sonuc = {
    tarih: tarihBul_(xmlDeger_(ust, 'IssueDate')),
    firma: firma,
    aciklama: aciklama || (firma ? firma + ' faturası' : ''),
    belgeNo: xmlDeger_(ust, 'ID'),
    toplam: toplam !== null ? yuvarla2(toplam) : null,
    kdv: kdv !== null ? yuvarla2(kdv) : null
  };
  sonuc.eksikler = eksikleriBelirle_(sonuc);
  return sonuc;
}

// Node ile test için
if (typeof module !== 'undefined') {
  module.exports = { sayiCoz: sayiCoz, tutarlar_: tutarlar_, tarihBul_: tarihBul_, metindenAyikla: metindenAyikla, efaturaXmlAyikla: efaturaXmlAyikla, trNormal_: trNormal_ };
}
