# Migration hatı kararı — Faz 5B.1

`istasyonos-main` kanonik hattır. `.local/integration/istasyonos` ayrı geliştirme kaynağı olarak korunur; migration dosyaları, numaraları ve manifesti ana hatta doğrudan kopyalanmaz. Entegrasyon özellikleri bağımlılıkları ve uygulama/test kodları incelenerek ileride yeni kanonik migration numaralarıyla port edilir.

Ana hattaki uygulanan geçmiş 0017'ye kadar sürüm adlarıyla eşleşir. Önceki SQL checksum'ları migration tablosunda saklanmadığından tarihsel ham checksum uyumu **UNKNOWN** olarak kalır. Mevcut dosya/manifest checksum doğrulaması bu geçmiş kanıtının yerine geçmez.

0018 FAST migrationı ana hatta yeni enum üyesi ekler. Eski CASH, IBAN, DEBT ve AR_COLLECTION kayıtları değişmez. FAST ayrı satış beyanı olarak kaynak toplamında görünür; banka tahsilatı teyidi değildir ve hesap muhasebeye gönderildiğinde teyit bekleyen statüsünde kalır. FAST için veritabanına uygulama bu aşamada yapılmaz.
