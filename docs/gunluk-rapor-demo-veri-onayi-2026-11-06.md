# Günlük rapor aktarımı ve DEMO veri izni

6 Kasım 2026 tarihli kullanıcı mesajıyla günlük rapor aktarımı geliştirmesi
ve İstasyonOS test veritabanında örnek veri kullanımı onaylandı.

Bu izin sonraki geliştirmelerde geçerlidir; aynı kapsam için yeniden izin
istenmesi gerekmez. Kapsam yalnız İstasyonOS DEMO/test alanıdır. Üretim,
diğer projeler/veritabanları, gerçek mali defter işlemleri ve bağımsız iş
onaylarının atlanması bu iznin kapsamı dışındadır.

İzin mevcut `st_audit` tablosuna `CHAT_AUTHORIZATION_DEMO_DAILY_IMPORT_SEED`
eylemiyle, DEMO istasyon kapsamında kaydedildi (audit no. 260). İşlemi
yürüten aktör mevcut DEMO test hesabıdır; bu olay kullanıcının uygulamada
kimliği doğrulanmış mali veya stok onayı olarak değerlendirilmez.
Özgün mesaj, kaynak ZIP özeti ve olay referansı özel `.local` kayıtlarında
korunur. Yeni onay tablosu veya migration oluşturulmadı.

Sentetik ürün/net ölçüm örneği uygulamanın mevcut API'si üzerinden eklendi:
ürün 106 L, net 102 L. Örnek kaydı kaynak fotoğraftan okunmuş gerçek ölçüm
olarak işaretlenmedi. Stok hareketi veya dönem kapatma onayı oluşturulmadı;
mevcut bağımsız onay kuralları korunur.

## Geliştirme boyunca geçerli genişletme

Kullanıcı sonraki mesajında geliştirme için ihtiyaç duyulan örnek verilerin
kaydedilmesine genel izin verdi ve yeni kurulumda boş veritabanı
kullanılacağını belirtti. İzin DEMO/test geliştirmesi boyunca geçerlidir;
her örnek veri için yeniden izin istenmez. Bu, mevcut veritabanını şimdi
sıfırlama talimatı değildir. Yeni kurulumda migration ile temiz şema kurulur;
örnek veriler başlangıçta otomatik taşınmaz veya uygulama açılışında üretilmez.

Genişletilmiş izin mevcut audit tablosuna
`CHAT_AUTHORIZATION_DEMO_DEVELOPMENT_SEED` eylemiyle kaydedildi
(audit no. 262). Kaynak sohbet mesajı ve olay referansı özel `.local`
kaydında korunur. İşlem aktörü DEMO test hesabıdır; bu izin mali iş onayı
yerine geçmez. Önceki kapsam sınırları geçerlidir.
