/**
 * Rapor.gs — Aylık ve yıllık harcama raporları.
 */

/**
 * @param {number} yil  Raporlanacak yıl
 * @return {{yil, yillar, aylar[12], kategoriler[], genel, yillik[]}}
 */
function raporGetir(yil) {
  const kayitlar = tumKayitlar_();
  yil = String(yil || new Date().getFullYear());

  const yillikHarita = {};
  kayitlar.forEach(function (r) {
    const y = r.tarih.slice(0, 4);
    if (!y) return;
    const o = yillikHarita[y] || (yillikHarita[y] = { yil: y, toplam: 0, kdv: 0, adet: 0 });
    o.toplam += r.toplam; o.kdv += r.kdv || 0; o.adet++;
  });
  const yillik = Object.keys(yillikHarita).sort().map(function (y) {
    const o = yillikHarita[y];
    return { yil: y, toplam: yuvarla2(o.toplam), kdv: yuvarla2(o.kdv), adet: o.adet };
  });
  if (!yillikHarita[yil]) yillik.push({ yil: yil, toplam: 0, kdv: 0, adet: 0 });

  const aylar = [];
  for (let i = 0; i < 12; i++) aylar.push({ ay: i + 1, toplam: 0, kdv: 0, adet: 0 });
  const katHarita = {};
  let kdvsiz = 0;

  kayitlar.forEach(function (r) {
    if (r.tarih.slice(0, 4) !== yil) return;
    const a = Number(r.tarih.slice(5, 7)) - 1;
    aylar[a].toplam += r.toplam; aylar[a].kdv += r.kdv || 0; aylar[a].adet++;
    if (r.kdv === null) kdvsiz++;
    const ad = r.kategori || '(Kategorisiz)';
    const k = katHarita[ad] || (katHarita[ad] = { ad: ad, toplam: 0, kdv: 0, adet: 0, aylik: new Array(12).fill(0), aylikKdv: new Array(12).fill(0) });
    k.toplam += r.toplam; k.kdv += r.kdv || 0; k.adet++;
    k.aylik[a] += r.toplam; k.aylikKdv[a] += r.kdv || 0;
  });

  aylar.forEach(function (a) { a.toplam = yuvarla2(a.toplam); a.kdv = yuvarla2(a.kdv); });
  const kategoriler = Object.keys(katHarita).map(function (ad) {
    const k = katHarita[ad];
    return { ad: ad, toplam: yuvarla2(k.toplam), kdv: yuvarla2(k.kdv), adet: k.adet,
      aylik: k.aylik.map(yuvarla2), aylikKdv: k.aylikKdv.map(yuvarla2) };
  }).sort(function (a, b) { return b.toplam - a.toplam; });

  const genel = aylar.reduce(function (g, a) { g.toplam += a.toplam; g.kdv += a.kdv; g.adet += a.adet; return g; }, { toplam: 0, kdv: 0, adet: 0 });
  genel.toplam = yuvarla2(genel.toplam); genel.kdv = yuvarla2(genel.kdv); genel.kdvsiz = kdvsiz;

  return { yil: yil, yillar: yillik.map(function (y) { return y.yil; }).sort().reverse(), aylar: aylar, kategoriler: kategoriler, genel: genel, yillik: yillik };
}
