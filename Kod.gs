/**
 * Harcama Takip — Google Apps Script web uygulaması
 * Kod.gs: web arayüzü, Google Sheet yapısı, kategoriler, kayıt ekleme/düzenleme/silme, ayarlar.
 */

const SAYFA_HARCAMA = 'Harcamalar';
const SAYFA_KATEGORI = 'Kategoriler';
const SAYFA_BH = 'BizimHesapAktarim';
const TZ = 'Europe/Istanbul';
const SUTUNLAR = ['ID', 'Tarih', 'Açıklama', 'Kategori', 'Firma', 'Belge No', 'Toplam Tutar', 'KDV Tutarı',
  'KDV Hariç Tutar', 'Kaynak', 'Durum', 'Belge Linki', 'Not', 'Kayıt Zamanı'];
const VARSAYILAN_KATEGORILER = ['Kira', 'Hizmet', 'Yakıt', 'İletişim', 'Seyahat', 'Malzeme Alımı', 'Yazılım Alımı', 'Numune Gideri'];

// ---------------------------------------------------------------------------
// Web arayüzü
// ---------------------------------------------------------------------------
function doGet() {
  ss_(); // ilk açılışta tabloyu hazırlar
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Harcamalarım')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(ad) {
  return HtmlService.createHtmlOutputFromFile(ad).getContent();
}

/** Apps Script düzenleyicisinden bir kez çalıştırın: tabloyu ve belge klasörünü oluşturur, yetkileri ister. */
function kurulum() {
  const ss = ss_();
  const klasor = klasor_();
  Logger.log('Google Sheet: ' + ss.getUrl());
  Logger.log('Belge klasörü: ' + klasor.getUrl());
}

// ---------------------------------------------------------------------------
// Yardımcılar: ayarlar, tablo, klasör
// ---------------------------------------------------------------------------
function props_() { return PropertiesService.getScriptProperties(); }

let _ss = null;
function ss_() {
  if (_ss) return _ss;
  const p = props_();
  const id = p.getProperty('SHEET_ID');
  if (id) {
    try { _ss = SpreadsheetApp.openById(id); } catch (e) { _ss = null; }
  }
  if (!_ss) {
    _ss = SpreadsheetApp.create('Harcamalar');
    _ss.setSpreadsheetLocale('tr_TR');
    _ss.setSpreadsheetTimeZone(TZ);
    p.setProperty('SHEET_ID', _ss.getId());
  }
  sayfalariHazirla_(_ss);
  return _ss;
}

function sayfalariHazirla_(ss) {
  let h = ss.getSheetByName(SAYFA_HARCAMA);
  if (!h) h = ss.insertSheet(SAYFA_HARCAMA, 0);
  if (h.getLastRow() === 0) {
    h.getRange(1, 1, 1, SUTUNLAR.length).setValues([SUTUNLAR])
      .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
    h.setFrozenRows(1);
    h.getRange('B2:B').setNumberFormat('dd.mm.yyyy');
    h.getRange('F2:F').setNumberFormat('@');
    h.getRange('G2:I').setNumberFormat('#,##0.00');
    h.getRange('N2:N').setNumberFormat('dd.mm.yyyy hh:mm');
    h.setColumnWidth(3, 280);
    h.setColumnWidth(5, 200);
  }
  let k = ss.getSheetByName(SAYFA_KATEGORI);
  if (!k) {
    k = ss.insertSheet(SAYFA_KATEGORI);
    k.getRange(1, 1).setValue('Kategori').setFontWeight('bold');
    k.getRange(2, 1, VARSAYILAN_KATEGORILER.length, 1).setValues(VARSAYILAN_KATEGORILER.map(function (x) { return [x]; }));
  }
  let b = ss.getSheetByName(SAYFA_BH);
  if (!b) {
    b = ss.insertSheet(SAYFA_BH);
    b.getRange(1, 1, 1, 4).setValues([['Anahtar', 'Harcama ID', 'Aktarım Zamanı', 'Ham Veri']]).setFontWeight('bold');
    b.hideSheet();
  }
  ['Sheet1', 'Sayfa1'].forEach(function (ad) {
    const s = ss.getSheetByName(ad);
    if (s && ss.getSheets().length > 1 && s.getLastRow() === 0) ss.deleteSheet(s);
  });
}

function sayfa_(ad) { return ss_().getSheetByName(ad); }

function klasor_() {
  const p = props_();
  const id = p.getProperty('KLASOR_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* yeniden oluştur */ } }
  const f = DriveApp.createFolder('Harcama Belgeleri');
  p.setProperty('KLASOR_ID', f.getId());
  return f;
}

function tarihStr_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (typeof v === 'string') return tarihBul_(v);
  return '';
}
function tarihNesne_(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : '';
}
function sayi_(v) { const n = sayiCoz(v); return n === null ? null : n; }
function yeniId_() { return 'H' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }

function satirdanNesne_(r) {
  return {
    id: String(r[0]), tarih: tarihStr_(r[1]), aciklama: String(r[2] || ''), kategori: String(r[3] || ''),
    firma: String(r[4] || ''), belgeNo: String(r[5] || ''), toplam: sayi_(r[6]) || 0,
    kdv: r[7] === '' ? null : sayi_(r[7]), kaynak: String(r[9] || ''), durum: String(r[10] || ''),
    belgeUrl: String(r[11] || ''), not: String(r[12] || '')
  };
}

function nesnedenSatir_(h, kayitZamani) {
  const t = yuvarla2(h.toplam);
  const k = (h.kdv === null || h.kdv === undefined || h.kdv === '') ? '' : yuvarla2(h.kdv);
  return [h.id, tarihNesne_(h.tarih), h.aciklama || '', h.kategori || '', h.firma || '', String(h.belgeNo || ''),
    t, k, k === '' ? '' : yuvarla2(t - k), h.kaynak || 'Manuel', h.durum || 'Tamam', h.belgeUrl || '', h.not || '',
    kayitZamani || new Date()];
}

function tumKayitlar_() {
  const sh = sayfa_(SAYFA_HARCAMA);
  const son = sh.getLastRow();
  if (son < 2) return [];
  return sh.getRange(2, 1, son - 1, SUTUNLAR.length).getValues()
    .filter(function (r) { return r[0] !== ''; })
    .map(satirdanNesne_);
}

function satirBul_(sh, id) {
  const hucre = sh.getRange('A:A').createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hucre ? hucre.getRow() : -1;
}

function dogrula_(h) {
  if (!h) throw new Error('Kayıt boş.');
  h.toplam = sayi_(h.toplam);
  h.kdv = (h.kdv === '' || h.kdv === null || h.kdv === undefined) ? null : sayi_(h.kdv);
  h.aciklama = String(h.aciklama || '').trim();
  h.kategori = String(h.kategori || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.tarih || '')) throw new Error('Tarih geçersiz.');
  if (!(h.toplam > 0)) throw new Error('Toplam tutar 0\'dan büyük olmalı.');
  if (h.kdv !== null && (h.kdv < 0 || h.kdv > h.toplam)) throw new Error('KDV tutarı toplamdan büyük olamaz.');
  if (!h.aciklama) throw new Error('Açıklama boş olamaz.');
  if (!h.kategori) throw new Error('Kategori seçin.');
}

function kopyaBul_(h, haricId) {
  const tf = String(h.firma || '').toLocaleLowerCase();
  return tumKayitlar_().find(function (r) {
    if (r.id === haricId) return false;
    if (h.belgeNo && r.belgeNo && String(h.belgeNo).trim() === r.belgeNo.trim() && tf && r.firma.toLocaleLowerCase() === tf) return true;
    return r.tarih === h.tarih && Math.abs(r.toplam - h.toplam) < 0.01 && (!tf || !r.firma || r.firma.toLocaleLowerCase() === tf);
  }) || null;
}

/** Aynı firmaya daha önce verilen kategoriyi öner. */
function firmaKategorisi_(firma) {
  if (!firma) return '';
  const f = String(firma).toLocaleLowerCase().trim();
  const kayitlar = tumKayitlar_();
  for (let i = kayitlar.length - 1; i >= 0; i--) {
    if (kayitlar[i].kategori && kayitlar[i].firma.toLocaleLowerCase().trim() === f) return kayitlar[i].kategori;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Arayüzün çağırdığı fonksiyonlar
// ---------------------------------------------------------------------------
function ilkVeri() {
  return { kategoriler: kategorileriGetir(), ayarlar: ayarlariGetir(), bugun: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') };
}

function harcamaKaydet(h, zorla) {
  dogrula_(h);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!zorla) {
      const k = kopyaBul_(h);
      if (k) return { kopya: true, mesaj: 'Benzer bir kayıt zaten var: ' + k.tarih + ' · ' + k.aciklama + ' · ' + k.toplam.toFixed(2) + ' ₺. Yine de kaydedilsin mi?' };
    }
    h.id = yeniId_();
    h.durum = 'Tamam';
    sayfa_(SAYFA_HARCAMA).appendRow(nesnedenSatir_(h));
    return { ok: true, id: h.id };
  } finally {
    lock.releaseLock();
  }
}

function harcamaGuncelle(h) {
  dogrula_(h);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sayfa_(SAYFA_HARCAMA);
    const r = satirBul_(sh, h.id);
    if (r < 0) throw new Error('Kayıt bulunamadı.');
    const eski = sh.getRange(r, 1, 1, SUTUNLAR.length).getValues()[0];
    h.kaynak = eski[9];
    h.durum = 'Tamam'; // kullanıcı kontrol edip kaydetti
    if (!h.belgeUrl) h.belgeUrl = eski[11];
    sh.getRange(r, 1, 1, SUTUNLAR.length).setValues([nesnedenSatir_(h, eski[13] || new Date())]);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function harcamaSil(id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sayfa_(SAYFA_HARCAMA);
    const r = satirBul_(sh, id);
    if (r < 0) throw new Error('Kayıt bulunamadı.');
    sh.deleteRow(r);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** f: {yil, ay (0 = tümü), kategori, ara, kontrol (true = sadece kontrol bekleyenler)} */
function harcamalariListele(f) {
  f = f || {};
  const ara = String(f.ara || '').toLocaleLowerCase().trim();
  const hepsi = tumKayitlar_();
  const kontrolSayisi = hepsi.filter(function (r) { return r.durum === 'Kontrol Et'; }).length;
  let liste = hepsi.filter(function (r) {
    if (f.yil && r.tarih.slice(0, 4) !== String(f.yil)) return false;
    if (f.ay && Number(r.tarih.slice(5, 7)) !== Number(f.ay)) return false;
    if (f.kategori && r.kategori !== f.kategori) return false;
    if (f.kontrol && r.durum !== 'Kontrol Et') return false;
    if (ara && (r.aciklama + ' ' + r.firma + ' ' + r.belgeNo + ' ' + r.not).toLocaleLowerCase().indexOf(ara) < 0) return false;
    return true;
  });
  liste.sort(function (a, b) { return a.tarih < b.tarih ? 1 : a.tarih > b.tarih ? -1 : 0; });
  const toplam = yuvarla2(liste.reduce(function (s, r) { return s + r.toplam; }, 0));
  const kdv = yuvarla2(liste.reduce(function (s, r) { return s + (r.kdv || 0); }, 0));
  return { kayitlar: liste.slice(0, 500), adet: liste.length, toplam: toplam, kdv: kdv, kontrolSayisi: kontrolSayisi };
}

// ---------------------------------------------------------------------------
// Kategoriler
// ---------------------------------------------------------------------------
function kategorileriGetir() {
  const sh = sayfa_(SAYFA_KATEGORI);
  const son = sh.getLastRow();
  if (son < 2) return [];
  return sh.getRange(2, 1, son - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); }).filter(Boolean);
}

function kategoriEkle(ad) {
  ad = String(ad || '').trim();
  if (!ad) throw new Error('Kategori adı boş.');
  const liste = kategorileriGetir();
  if (liste.some(function (k) { return k.toLocaleLowerCase('tr') === ad.toLocaleLowerCase('tr'); })) throw new Error('"' + ad + '" zaten var.');
  sayfa_(SAYFA_KATEGORI).appendRow([ad]);
  return kategorileriGetir();
}

function kategoriSil(ad) {
  const sh = sayfa_(SAYFA_KATEGORI);
  const hucre = sh.getRange('A:A').createTextFinder(String(ad)).matchEntireCell(true).findNext();
  if (hucre && hucre.getRow() > 1) sh.deleteRow(hucre.getRow());
  return kategorileriGetir(); // mevcut kayıtlardaki kategori adı korunur
}

// ---------------------------------------------------------------------------
// Ayarlar (gizli anahtarlar Script Properties'te tutulur, tabloda değil)
// ---------------------------------------------------------------------------
function ayarlariGetir() {
  const p = props_().getProperties();
  return {
    sheetUrl: ss_().getUrl(),
    klasorUrl: klasor_().getUrl(),
    geminiVar: !!p.GEMINI_API_KEY,
    geminiModel: p.GEMINI_MODEL || 'gemini-2.5-flash',
    bhTokenVar: !!p.BH_TOKEN,
    bhAktif: p.BH_AKTIF === 'true',
    bhBaslangic: p.BH_BASLANGIC || '',
    bhFiltre: p.BH_FILTRE || 'alış|alis|gider|masraf',
    bhKdvOrani: p.BH_KDV_ORANI || '',
    bhSaat: p.BH_SAAT || '6',
    bhSonCalisma: p.BH_SON_CALISMA || '',
    bhSonSonuc: p.BH_SON_SONUC || ''
  };
}

function ayarlariKaydet(a) {
  const p = props_();
  if (a.geminiKey === '-') p.deleteProperty('GEMINI_API_KEY');
  else if (a.geminiKey) p.setProperty('GEMINI_API_KEY', String(a.geminiKey).trim());
  if (a.geminiModel) p.setProperty('GEMINI_MODEL', String(a.geminiModel).trim());
  if (a.bhToken === '-') p.deleteProperty('BH_TOKEN');
  else if (a.bhToken) p.setProperty('BH_TOKEN', String(a.bhToken).trim());
  p.setProperty('BH_BASLANGIC', a.bhBaslangic || '');
  p.setProperty('BH_FILTRE', a.bhFiltre || 'alış|alis|gider|masraf');
  p.setProperty('BH_KDV_ORANI', a.bhKdvOrani === undefined ? '' : String(a.bhKdvOrani));
  p.setProperty('BH_SAAT', String(a.bhSaat || '6'));
  p.setProperty('BH_AKTIF', a.bhAktif ? 'true' : 'false');
  if (a.bhAktif && !p.getProperty('BH_TOKEN')) throw new Error('Otomatik aktarım için önce Bizim Hesap token girin.');
  bizimHesapZamanlayiciKur_(!!a.bhAktif, Number(a.bhSaat || 6));
  return ayarlariGetir();
}
