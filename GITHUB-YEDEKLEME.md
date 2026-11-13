# İstasyonOS kaynak yedeği

Bu dal 13 Kasım 2026 tarihinde C:\laragon\www\istasyonos-main kaynaklarının seçilmiş anlık görüntüsüdür. Ana dal değiştirilmemiştir.

Temel commit: 1777c5637a99131e7f76b051e960a1372032b632. Bu, ana dalla işlevsel birleştirme veya üretime dağıtım değildir. Yerelde bulunmayan uzak dosyalar bu anlık görüntüde bulunmaz; migration zincirleri ayrıştığı için PR birleştirilmeden önce ayrıca incelenmelidir.

.env dosyaları (örnek dahil), .local, node_modules, dist, veritabanı yedekleri, özel anahtarlar ve veri içerebilecek tarihsel PNG/Excel/CSV belge ekleri dahil edilmemiştir. Uygulama ikonları ve sentetik DEMO test görselleri korunmuştur.

455 kaynak dosyası token/özel anahtar, gömülü parola, bağlantı adresi ve SQL dump kalıplarıyla tarandı. Bulunan 53 eşleşme incelendi: sentetik test değerleri veya çalışma anında üretilen değişkenler. Ek taramada Google API anahtarı, JWT, Bearer token ve TR IBAN kalıpları için eşleşme bulunmadı. Bu tarama kalıp tabanlıdır.

Çalışan uygulama, servisler ve veritabanları değiştirilmedi. Yerel .env testlere aktarılmadan ve gerçek veritabanı bağlantısı yasaklanarak doğrulama yürütüldü; sonuçlar PR açıklamasında belirtilir. Eski belgelerdeki doğrulama iddiaları bu yedeğin güncel doğrulama sonucu değildir.
