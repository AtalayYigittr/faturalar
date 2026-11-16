/**
 * BizimHesap.gs — Bizim Hesap'tan SALT OKUNUR aktarım.
 *
 * Bu dosyada yalnızca HTTP GET istekleri vardır; Bizim Hesap'a veri yazan
 * (addinvoice, cancelinvoice vb.) hiçbir çağrı bulunmaz ve eklenmemelidir.
 *
 * Kullanılan uç noktalar (Bizim Hesap B2B API):
 *   GET https://bizimhesap.com/api/b2b/customers              -> cari listesi
 *   GET https://bizimhesap.com/api/b2b/abstract/{cari-id}     -> cari hesap ekstresi
 * Ekstredeki hareketlerden türü filtreye uyanlar (varsayılan: "Alış Faturası" vb.)
 * harcama olarak "Kontrol Et" durumuyla tabloya eklenir. Aynı hareket iki kez aktarılmaz.
 */

const BH_TABAN = 'https://bizimhesap.com/api/b2b/';
const BH_SABIT_ANAHTAR = 'BZMHB2B724018943908D0B82491F203F'; // Bizim Hesap dokümanındaki sabit "Key"

function bhIstek_(yol) {
  const token = props_().getProperty('BH_TOKEN');
  if (!token) throw new Error('Bizim Hesap token girilmemiş (Ayarlar).');
  return {
    url: BH_TABAN + yol,
    method: 'get',            // <-- yalnızca okuma
    headers: { token: token, key: BH_SABIT_ANAHTAR },
    muteHttpExceptions: true
  };
}

function bhCoz_(yanit, yol) {
  const kod = yanit.getResponseCode();
  const govde = yanit.getContentText();
  let j = null;
  try { j = JSON.parse(govde); } catch (e) { /* aşağıda */ }
  if (kod === 401 || kod === 403) throw new Error('Bizim Hesap token geçersiz veya yetkisiz (HTTP ' + kod + ').');
  if (kod !== 200 || !j) throw new Error('Bizim Hesap ' + yol + ' → HTTP ' + kod + ': ' + govde.slice(0, 200));
  const hata = (j.resultCode === 0 && j.errorText) || j.Message || j.error;
  if (hata) throw new Error('Bizim Hesap: ' + hata);
  return j;
}

function bhGet_(yol) {
  const istek = bhIstek_(yol);
  return bhCoz_(UrlFetchApp.fetch(istek.url, istek), yol);
}

function bhCariler_() {
  const j = bhGet_('customers');
  const liste = (j.data && j.data.customers) || j.customers || [];
  return liste.map(function (c) { return { id: c.id, kod: c.code, unvan: c.title || '' }; }).filter(function (c) { return c.id; });
}

/** Ayarlar ekranındaki "Bağlantıyı test et" düğmesi. */
function bizimHesapTest() {
  const cariler = bhCariler_();
  let ornek = null;
  if (cariler.length) {
    try {
      const e = bhGet_('abstract/' + encodeURIComponent(cariler[0].id));
      const d = e.data || {};
      ornek = { cari: d.title || cariler[0].unvan, hareketSayisi: (d.abstract || []).length,
        turler: Array.from(new Set((d.abstract || []).map(function (x) { return x.type; }))).slice(0, 10) };
    } catch (err) { ornek = { hata: err.message }; }
  }
  return { cariSayisi: cariler.length, ornekCariler: cariler.slice(0, 5).map(function (c) { return c.unvan; }), ornek: ornek };
}

/** Zamanlayıcının çalıştırdığı fonksiyon. Arayüzden "Şimdi aktar" ile de çağrılır. */
function bizimHesapSenkron() {
  const p = props_();
  const baslangicZamani = Date.now();
  const filtre = new RegExp(p.getProperty('BH_FILTRE') || 'alış|alis|gider|masraf', 'i');
  const baslangic = p.getProperty('BH_BASLANGIC') || '';
  const kdvOrani = sayiCoz(p.getProperty('BH_KDV_ORANI'));

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { mesaj: 'Başka bir aktarım sürüyor.' };
  try {
    const log = sayfa_(SAYFA_BH);
    const sonLog = log.getLastRow();
    const aktarilmis = new Set(sonLog > 1 ? log.getRange(2, 1, sonLog - 1, 1).getValues().map(function (r) { return String(r[0]); }) : []);

    const firmaKat = {};
    tumKayitlar_().forEach(function (r) { if (r.kategori && r.firma) firmaKat[r.firma.toLocaleLowerCase().trim()] = r.kategori; });
    const cariler = bhCariler_();
    const yeniSatirlar = [], yeniLog = [];
    let taranan = 0;

    for (let i = 0; i < cariler.length; i += 20) {
      if (Date.now() - baslangicZamani > 4.5 * 60 * 1000) break; // Apps Script 6 dk sınırı
      const grup = cariler.slice(i, i + 20);
      const yanitlar = UrlFetchApp.fetchAll(grup.map(function (c) { return bhIstek_('abstract/' + encodeURIComponent(c.id)); }));

      yanitlar.forEach(function (y, n) {
        const cari = grup[n];
        let d;
        try { d = bhCoz_(y, 'abstract').data || {}; } catch (e) { return; }
        taranan++;
        (d.abstract || []).forEach(function (h) {
          if (!filtre.test(String(h.type || ''))) return;
          const tarih = tarihBul_(h.trxdate);
          if (!tarih || (baslangic && tarih < baslangic)) return;
          const tutar = sayiCoz(h.credit) || sayiCoz(h.debit);
          if (!(tutar > 0)) return;

          const anahtar = [cari.id, h.trxdate, h.type, tutar.toFixed(2), h.note || ''].join('|');
          if (aktarilmis.has(anahtar)) return;
          aktarilmis.add(anahtar);

          const kayit = {
            id: yeniId_(),
            tarih: tarih,
            aciklama: (h.note && String(h.note).trim()) || (h.type + ' — ' + (d.title || cari.unvan)),
            kategori: firmaKat[String(d.title || cari.unvan).toLocaleLowerCase().trim()] || '',
            firma: d.title || cari.unvan,
            belgeNo: '',
            toplam: yuvarla2(tutar),
            kdv: kdvOrani > 0 ? yuvarla2(tutar * kdvOrani / (100 + kdvOrani)) : null,
            kaynak: 'Bizim Hesap',
            durum: 'Kontrol Et',
            not: 'Bizim Hesap: ' + h.type + (kdvOrani > 0 ? ' · KDV %' + kdvOrani + ' varsayılarak hesaplandı' : ' · KDV girilmeli')
          };
          yeniSatirlar.push(nesnedenSatir_(kayit));
          yeniLog.push([anahtar, kayit.id, new Date(), JSON.stringify(h).slice(0, 1000)]);
        });
      });
    }

    if (yeniSatirlar.length) {
      const sh = sayfa_(SAYFA_HARCAMA);
      sh.getRange(sh.getLastRow() + 1, 1, yeniSatirlar.length, SUTUNLAR.length).setValues(yeniSatirlar);
      log.getRange(log.getLastRow() + 1, 1, yeniLog.length, 4).setValues(yeniLog);
    }
    const mesaj = taranan + '/' + cariler.length + ' cari tarandı, ' + yeniSatirlar.length + ' yeni harcama aktarıldı.';
    p.setProperty('BH_SON_CALISMA', Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy HH:mm'));
    p.setProperty('BH_SON_SONUC', mesaj);
    return { mesaj: mesaj, yeni: yeniSatirlar.length };
  } catch (e) {
    p.setProperty('BH_SON_CALISMA', Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy HH:mm'));
    p.setProperty('BH_SON_SONUC', 'HATA: ' + e.message);
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function bizimHesapZamanlayiciKur_(aktif, saat) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'bizimHesapSenkron') ScriptApp.deleteTrigger(t);
  });
  if (!aktif) return;
  const gecerli = [1, 2, 4, 6, 8, 12];
  const s = gecerli.indexOf(saat) >= 0 ? saat : 6;
  ScriptApp.newTrigger('bizimHesapSenkron').timeBased().everyHours(s).create();
}
