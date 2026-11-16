# Harcama Takip — Google Sheets'e harcama aktarma

Telefondan ve web'den açılan, Google Apps Script üzerinde çalışan harcama uygulaması.

- **Fiş / fatura / PDF okuma:** Telefon kamerasıyla fotoğraf çekin ya da dosya yükleyin. Tarih, açıklama, firma, belge no, toplam tutar ve KDV okunur. Okunamayan veya şüpheli alanlar **sarı** işaretlenir, kaydetmeden önce düzeltirsiniz.
- **e-Fatura XML:** UBL-TR XML yüklerseniz alanlar doğrudan XML'den alınır (en doğru yöntem).
- **Elle giriş:** Aynı form, belge yüklemeden de doldurulabilir. %1 / %10 / %20 düğmeleri KDV'yi toplamdan hesaplar.
- **Kategoriler:** Kira, Hizmet, Yakıt, İletişim, Seyahat, Malzeme Alımı, Yazılım Alımı, Numune Gideri hazır gelir; Ayarlar'dan ya da form içinden yenisini ekleyebilirsiniz. Aynı firmaya daha önce verdiğiniz kategori otomatik önerilir.
- **Raporlar:** Aylık (12 ay grafik + tablo, aya dokununca kategori dağılımı) ve yıllık (yıllara göre karşılaştırma) ekranı.
- **Bizim Hesap:** Salt okunur bağlantı; zamanlayıcıyla düzenli kontrol eder, yeni alış faturalarını "Kontrol Et" durumuyla aktarır.
- **Kopya kontrolü:** Aynı tarih + tutar + firma ya da aynı belge no ile ikinci kez kayıt eklenmek istenirse uyarır.
- Her belge Drive'da **Harcama Belgeleri** klasörüne kaydedilir; linki Sheet'teki satıra yazılır.

## Google Sheet yapısı

`Harcamalar` sayfası: ID · Tarih · Açıklama · Kategori · Firma · Belge No · Toplam Tutar · KDV Tutarı · KDV Hariç Tutar · Kaynak · Durum · Belge Linki · Not · Kayıt Zamanı
`Kategoriler` sayfası: kategori listesi (doğrudan Sheet'ten de düzenlenebilir).
`BizimHesapAktarim` (gizli): aynı hareketin iki kez aktarılmaması için kayıt.

## Kurulum (clasp ile, GitHub'dan)

```bash
npm i -g @google/clasp
clasp login
clasp create --type standalone --title "Harcama Takip"   # .clasp.json oluşturur
clasp push
clasp open    # düzenleyiciyi açar
```

Düzenleyicide:
1. Üstteki fonksiyon listesinden **`kurulum`** seçip **Çalıştır**. İzinleri onaylayın. Günlükte Sheet ve klasör linkleri yazar.
   (Sheet'i siz oluşturmak isterseniz: Proje Ayarları → Komut dosyası özellikleri → `SHEET_ID` = tablonun ID'si, sonra `kurulum`.)
2. **Dağıt → Yeni dağıtım → Web uygulaması**. "Şu kullanıcı olarak yürüt: Ben", "Erişimi olanlar: Yalnızca ben". Dağıt.
3. Verilen `/exec` linkini telefonda açın → tarayıcı menüsünden **Ana ekrana ekle**. Uygulama gibi açılır.

Kod güncellemesinden sonra: `clasp push`, ardından Dağıt → Dağıtımları yönet → mevcut dağıtımı **Yeni sürüm** ile güncelleyin (link değişmez).

## Fiş okuma kalitesi

- **Varsayılan (ücretsiz):** Google Drive OCR + Türk fişlerine göre yazılmış kurallar (TOPLAM, TOPKDV, Ödenecek Tutar, Hesaplanan KDV, tarih, fiş no). Net çekilmiş fişlerde iyi sonuç verir; buruşuk / soluk termal fişlerde alanlar sarı gelir.
- **Önerilen:** Ayarlar → Gemini API anahtarı. Anahtar <https://aistudio.google.com/apikey> adresinden alınır. Fişi yapay zekâ okur; açıklamayı ("Benzin 40 lt" gibi) ve kategoriyi de önerir. Hata olursa otomatik olarak OCR'a döner.
  Not: Ücretsiz Gemini katmanında Google gönderilen içeriği ürün geliştirmede kullanabilir; fatura gizliliği önemliyse ücretli katmanı kullanın. Model adı Ayarlar'dan değiştirilebilir (Google eski modelleri zamanla kapatır).

## Bizim Hesap bağlantısı — önemli notlar

- Bizim Hesap'ın herkese açık B2B API'sinde **gelen e-fatura listesi veya alış faturası listesi veren bir uç nokta yok**. Belgelenen okuma uç noktaları: ürünler, depolar, stok, cari listesi (`/customers`) ve cari ekstresi (`/abstract/{cari}`).
- Bu yüzden program cari ekstrelerini okur ve türü filtreye uyan hareketleri (varsayılan `alış|alis|gider|masraf` → "Alış Faturası") harcama olarak alır. Ekstrede **KDV ayrımı yok**: bu kayıtlar "Kontrol Et" durumunda gelir, KDV'yi girersiniz (ya da Ayarlar'da varsayılan KDV oranı verirsiniz). Kayıtlar ekranında "Sadece kontrol bekleyenler" ile listelenir.
- Token: Bizim Hesap → Ayarlar → Entegrasyonlar / API (bulamazsanız destek@bizimhesap.com'dan B2B API token isteyin).
- **Ayarlar → Bağlantıyı test et** cari sayısını ve örnek ekstredeki hareket türlerini gösterir. Tedarikçileriniz listede görünmüyorsa veya alış faturası türü farklı yazılıyorsa filtreyi buna göre düzenleyin.
- Program yalnızca `GET` istek atar; `BizimHesap.gs` içinde yazma yapan (addinvoice, cancelinvoice) hiçbir çağrı yoktur.
- "Şu tarihten itibaren aktar" alanını doldurun, yoksa ilk çalıştırmada geçmişteki bütün alış faturaları aktarılır.

Tam e-fatura (KDV dahil) aktarımı için alternatif: Bizim Hesap'tan veya GİB portalından gelen faturaların **XML**'ini indirip "Dosya yükle" ile yükleyin. Alanlar eksiksiz okunur.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `Kod.gs` | Web uygulaması, Sheet yapısı, kayıt / kategori / ayar işlemleri |
| `Okuma.gs` | Belge kaydetme, Drive OCR, Gemini okuma |
| `Ayikla.gs` | Fiş metni ve e-Fatura XML ayrıştırıcıları (Apps Script'ten bağımsız, test edilebilir) |
| `BizimHesap.gs` | Bizim Hesap salt okunur aktarım + zamanlayıcı |
| `Rapor.gs` | Aylık / yıllık rapor hesapları |
| `Index.html`, `Stil.html`, `App.html` | Mobil uyumlu arayüz |
