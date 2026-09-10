'use strict';

// app.js ile aynı renderer kapsamı; yalnız kullanıcı onayıyla yazma çağırır.
async function uretilecekleriCiz(parametre) {
  if (!yetkiVar('uretim')) return;
  const kap = el('section', { id: 'aktarimUretim' });
  icerik.appendChild(kap);
  async function ciz() {
    bosalt(kap);
    let veri;
    try { veri = await cagir('aktarim:uretilecekler', parametre); }
    catch (e) { kap.appendChild(el('div', { sinif: 'aciklama-kutu uyari', metin: e.message })); return; }
    if (!veri.aktarim) return;
    const bag = { aktarimId: veri.aktarim.id, aktarimTarihi: gunAnahtari(veri.aktarim.isGunu) };
    const acik = durum.yazmaAcik && !veri.aktarim.geriAlindi && veri.aktarim.durum === 'tamam';
    const emirAc = (r) => ekranAc('uretim', { ...bag, kip: 'fireli', mamulStokNo: r.stokNo,
      oneriMiktar: Number(r.eksik) > 0 ? Number(r.eksik) : null });
    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Aktarımdan sonra üretilecekler' }));
    kap.appendChild(el('div', { sinif: 'aciklama-kutu', metin:
      tarihYaz(veri.aktarim.isGunu) + ' aktarımı ' + (veri.aktarim.geriAlindi ? 'geri alındı' : 'yapıldı') +
      ' · ' + veri.uretimler.length + ' bağlı üretim fişi. Aktarımı geri almadan önce bu üretimleri geri alın.' }));
    if (!durum.yazmaAcik) kap.appendChild(el('div', { sinif: 'aciklama-kutu uyari', metin: 'Vega’ya yazma kapalı. Üretim düğmeleri kullanılamaz.' }));
    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Eksiği kapatılacaklar' }));
    const secilen = new Set();
    const toplu = el('button', { sinif: 'dugme-ana', metin: 'Seçilenleri sıfıra kadar üret', disabled: true });
    kap.appendChild(tabloYap(['Seç', 'Mamul', 'Kalan', 'Üretilecek'], veri.eksikler, (r) => {
      const kutu = el('input', { type: 'checkbox', disabled: !acik || r.uretilemez });
      kutu.addEventListener('change', () => {
        if (kutu.checked) secilen.add(Number(r.stokNo)); else secilen.delete(Number(r.stokNo));
        toplu.disabled = !acik || !secilen.size;
      });
      return el('tr', null, [el('td', null, [kutu]), hucre(r.ad), hucre(miktarYaz(r.kalan), 'sayi eksi'),
        hucre(r.uretilemez ? 'Reçete kendini tüketiyor' : miktarYaz(r.uretilecek) + ' ' + r.birim, 'sayi')]);
    }));
    if (!veri.eksikler.length) kap.appendChild(el('p', { metin: 'Eksiye düşen tek çıktılı mamul yok.' }));
    toplu.addEventListener('click', async () => {
      const onay = await window.galya.cagir('sistem:onay', { baslik: 'Eksiği kapat',
        mesaj: secilen.size + ' mamul için üretim fişi yazılacak.',
        detay: 'Miktarlar güncel stoktan hesaplanır; fişler bu aktarım gününe bağlanır.', evet: 'Üret', hayir: 'Vazgeç' });
      if (!onay.veri || !onay.veri.onay) return;
      toplu.disabled = true;
      try {
        const sonuc = await cagir('uretim:hepsiniSifirla', { ...bag, depo: veri.aktarim.depo, stokNolar: [...secilen] });
        bildir(sonuc.yazilan + ' üretim yazıldı' + (sonuc.hatali ? ', ' + sonuc.hatali + ' üretim yazılamadı.' : '.'), sonuc.hatali ? 'kotu' : 'iyi');
        if (sonuc.hatali) hataGoster(new Error(sonuc.sonuclar.filter((r) => !r.tamam).map((r) => r.ad + ': ' + r.mesaj).join('\n')));
      } catch (e) { hataGoster(e); }
      await ciz();
    });
    kap.appendChild(toplu);
    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'İş emri gerekenler' }));
    kap.appendChild(el('p', { sinif: 'alt-not', metin: 'Çok çıktılı reçetelerde hammaddeyi ve her çıktının miktarını siz yazarsınız.' }));
    kap.appendChild(tabloYap(['Mamul', 'Çıktı', 'Eksik', ''], veri.isEmirleri, (r) => el('tr', null, [
      hucre(r.ad), hucre(sayiYaz(r.ciktiSayisi)), hucre(r.eksik > 0 ? miktarYaz(r.eksik) : '—'),
      el('td', null, [el('button', { sinif: 'dugme-kucuk', metin: 'İş emri aç', disabled: !acik, tikla: () => emirAc(r) })])
    ])));
    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Bugün de yapılacak mı?' }));
    kap.appendChild(el('p', { sinif: 'alt-not', metin: 'Son 30 günde en sık yapılan üretimler. Seçmek yalnız iş emrini açar.' }));
    kap.appendChild(tabloYap(['Mamul', 'Son 30 gün', 'Son üretim', ''], veri.aliskanliklar, (r) => el('tr', null, [
      hucre(r.ad), hucre(sayiYaz(r.adet) + ' kez'), hucre(tarihYaz(r.son)),
      el('td', null, [el('button', { sinif: 'dugme-kucuk', metin: 'İş emri aç', disabled: !acik, tikla: () => emirAc(r) })])
    ])));
    if (!veri.aliskanliklar.length) kap.appendChild(el('p', { metin: 'Son 30 günde üretim kaydı yok.' }));
    kap.appendChild(el('button', { sinif: 'dugme-sade', metin: 'Başka bir manuel üretim', disabled: !acik,
      tikla: () => ekranAc('uretim', { ...bag, kip: 'fireli' }) }));
    kap.appendChild(el('div', { sinif: 'bolum-basligi', metin: 'Bu aktarıma bağlı üretimler' }));
    kap.appendChild(tabloYap(['Fiş', 'Mamul', 'Miktar', 'Kullanıcı', ''], veri.uretimler, (r) => el('tr', null, [
      hucre(r.fisNo), hucre(r.ad), hucre(miktarYaz(r.miktar)), hucre(r.kullanici || '—'),
      el('td', null, [el('button', { sinif: 'dugme-kucuk', metin: 'Üretimi geri al', disabled: !durum.yazmaAcik,
        tikla: async () => {
          const onay = await window.galya.cagir('sistem:onay', { baslik: 'Üretimi geri al', mesaj: r.fisNo + ' geri alınacak.',
            detay: 'Üretimin bütün belge ve depo hareketleri silinir.', evet: 'Geri al', hayir: 'Vazgeç' });
          if (!onay.veri || !onay.veri.onay) return;
          try { await cagir('uretim:geriAl', { id: r.id }); await ciz(); } catch (e) { hataGoster(e); }
        } })])
    ])));
  }
  await ciz();
}
