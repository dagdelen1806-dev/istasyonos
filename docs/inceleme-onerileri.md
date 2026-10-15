# İstasyon OS — Proje İncelemesi ve Öneriler

**İncelenen materyal:** `akaryakıt.txt` (592 satırlık Database Blueprint v1.0 plan özeti)  
**İnceleme kapsamı:** Mimari yaklaşım, kapsam, veri modeli yol haritası ve vardiya takip ürününe uygunluk.  
**Sınır:** Proje klasöründe bu belge dışında uygulama kaynak kodu, migration, ERD veya çalışan yazılım bulunmadığından kod kalitesi ya da mevcut uygulamanın davranışı değerlendirilemedi.

## Kısa değerlendirme

Belge; tenant/istasyon ayrımını, kullanıcı-personel-rol-yetki ayrımını, modül bazlı erişimi, kritik kayıtların fiziksel silinmemesini ve audit yaklaşımını doğru biçimde temellendiriyor. Bu kararlar, ileride birden fazla istasyon ve şirkete açılabilecek bir sistem için iyi bir başlangıç.

En önemli ürün riski **kapsamın çok geniş olması**: proje talimatındaki “akaryakıt istasyonları aylık vardiya takip programı” odağı; belgede kasa, satış, banka, yakıt otomasyonu, market, satın alma, fatura, finans, İK ve AI içeren geniş bir işletme yönetim sistemine dönüşmüş. Buna karşılık, ana ürün olan aylık vardiya planlama ve gerçekleşen çalışma akışının iş kuralları henüz belgede yok. İlk olarak ürün sınırı ve vardiya işleyişi netleştirilmeli.

## Güçlü taraflar

- Tek istasyona kilitlenmeyen tenant → station modeli baştan düşünülmüş.
- `USER != EMPLOYEE != ROLE != PERMISSION` ayrımı doğru; hesap ile çalışan kaydının birbirine karıştırılmasını önlüyor.
- Yetkilerin istasyon/tenant/kişi kapsamları ve modül etkinliğiyle birlikte kontrol edilmesi hedeflenmiş.
- Finansal ve operasyonel kayıtların silinmek yerine düzeltme/iptal ve audit geçmişiyle yönetilmesi düşünülmüş.
- Entegrasyonların ortak katmandan yönetilmesi ve sırların ayrı, şifreli saklanması öngörülmüş.
- İK’nın opsiyonel bir modül olması, çekirdek vardiya deneyimini gereksiz bağımlılıktan koruyabilir.

## Öncelikli öneriler

### P0 — Ürünün ilk sürüm sınırını belirleyin

İlk sürümün hedefini **aylık vardiya planı + vardiya gerçekleşmesi/devam kaydı + onay ve temel raporlar** olarak tanımlayın. Kasa, satış, banka, stok ve AI gibi alanları ilk sürüme dahil etmek gerekip gerekmediğini açıkça kararlaştırın. Vardiya kapatmada kasa teslimi gerekiyorsa, ilk sürümde yalnızca gerekli kasa farkı/teslim özetini kapsayın; tam finans modülünü ayrı faza bırakın.

Her faz için “dahil / hariç” listesi ve başarı ölçütü koyun. Örneğin: bir istasyonun aylık planı hazırlanabiliyor, yayınlanabiliyor, değişiklikleri izlenebiliyor ve gerçekleşen vardiyalar raporlanabiliyor.

### P0 — `06 Shift` aşamasına geçmeden iş kurallarını yazın

Vardiya blueprint’inde en az şu kararlar yer almalı:

1. **Plan ve gerçekleşen kayıt ayrımı:** Planlanan vardiya ile fiilen giriş/çıkış ayrı alanlar veya ilişkili kayıtlar olmalı; sonradan yapılan düzenlemeler ilk planı sessizce ezmemeli.
2. **Durum akışı:** Taslak → yayımlandı → devam ediyor → tamamlandı/onaylandı gibi durumlar; iptal ve düzeltme kuralları tanımlanmalı.
3. **Aylık plan yaşam döngüsü:** Ayın planı ne zaman hazırlanır, kim yayımlar, yayımdan sonra değişiklik kimin onayına tabidir, geçmiş aya ne zaman kilit konur?
4. **Gece yarısını aşan vardiyalar:** Başlangıç/bitiş tam tarih-saat olmalı; yalnızca saat alanı kullanmak hatalı süre hesaplarına yol açar.
5. **Çakışma ve uygunluk:** Aynı çalışana çakışan vardiya, asgari dinlenme süresi, ardışık çalışma sınırı ve istasyon kapsamı için kurallar belirlenmeli.
6. **Değişiklikler:** Vardiya değişimi, devir, geç kalma, erken çıkış, devamsızlık ve yöneticinin düzeltmesi ayrı neden/kayıtlarla izlenmeli.
7. **Onay ve audit:** Kim, ne zaman, hangi gerekçeyle planı/gerçekleşeni değiştirdi veya onayladı? Kritik değişiklikte önceki ve yeni değer saklanmalı.
8. **Takvim istisnaları:** İzin, rapor, resmi tatil ve kapanış gibi durumlar ilk sürümde yönetilecek mi; yönetilmeyecekse vardiya atamasını nasıl etkiler?
9. **Süre ve ücret kapsamı:** Fazla mesai, mola, gece çalışması ve ücret/prim hesabı ilk sürümün dışında mı? Dışarıdaysa veri yapısı bu hesapları yanlış varsaymamalı.

**Önemli ayrım:** Vardiya, çalışanın hangi zaman aralığında çalışmasının planlandığını; devam/punch kaydı ise fiilen ne zaman çalıştığını ifade eder. Bunları tek kayda indirgemek raporlama ve denetim sorunları doğurur.

### P1 — Personel ve vardiya ilişkisini sade ama genişleyebilir tasarlayın

`employees` için kişi kaydı, çalışan numarası, istihdam durumu ve geçerlilik tarihleri; istasyon/görev atamaları için ayrı ve tarih aralıklı ilişkiler düşünün. Bir çalışanın istasyon veya görev değiştirmesi geçmiş vardiyaların anlamını değiştirmemeli. `user_id` bağlantısı isteğe bağlı olmalı; sisteme giriş yapmayan personel de vardiya planında bulunabilmeli. İK lisans modülünün kapalı olması temel vardiya kaydını engellememeli.

### P1 — Veri bütünlüğü ve çok kiracılı izolasyonu somutlaştırın

Blueprint’te tenant izolasyonu hedef olarak yazılmış; bunu veritabanı ve servis katmanında nasıl zorlayacağınızı belirtin. İstasyon kimliği taşıyan kaydın aynı tenant’a ait istasyonu göstermesi garanti edilmeli. Kullanıcı erişimi, rol ataması ve istasyon kapsamı birlikte kontrol edilmeli; tenant sınırını yalnızca arayüz filtresine bırakmayın.

Başlangıçta netleştirilecek teknik kurallar:

- İş/operasyon tablolarında gereken `tenant_id` ve `station_id` alanlarının kapsamı ve tutarlılık kısıtları.
- Aynı çalışana çakışan vardiyaları önleyecek doğrulama (veritabanı veya güvenilir transaction tabanlı servis kuralı).
- İstasyon içinde çalışan numarası gibi alanların benzersizlik kapsamı.
- Tarih aralıklarında başlangıç/bitiş dahil-hariç semantiği ve geçerlilik çakışmaları.
- Kritik işlem ve düzeltmelerde transaction, idempotency ve tekrar istek davranışı.

### P1 — Zaman ve yerel takvim semantiğini tanımlayın

Vardiya başlangıç/bitişini mutlak zaman olarak saklayın; raporlama için istasyonun yerel takvim gününü ve saat dilimini açıkça belirleyin. Gece vardiyasının hangi iş gününe/aya yazılacağına karar verin. Veritabanında `Europe/Istanbul` varsayılanı bulunması yararlı; ancak tenant/istasyon saat dilimi değişikliği ve geçmiş kayıtların yorumu için kural da yazılmalı.

### P1 — Audit ve düzeltme yaklaşımını uygulanabilir hale getirin

Audit için yalnızca `created_at/updated_at` yeterli değil. Kritik vardiya ve kasa işlemlerinde aktör, işlem zamanı, hedef kayıt, işlem türü, gerekçe ve önceki/yeni değerlerin hangi formatta tutulacağı tanımlanmalı. Audit kayıtlarının uygulama kullanıcılarınca değiştirilememesi/silinmemesi sağlanmalı. Düzeltme, iptal ve yeniden onay akışları ayrıca tanımlanmalı.

### P2 — Yetkilendirmeyi erken test edin

Rol/izin taslağı güçlü; ancak `OWN`, `STATION`, `TENANT`, `ALL` kapsamlarının her işlem için nasıl çözümleneceği belirsiz kalırsa uygulama katmanında tutarsızlık çıkar. Önce vardiya kullanım senaryolarına göre yetki matrisi hazırlayın: çalışan kendi vardiyasını görür, vardiya amiri istasyon planını düzenler, işletme sahibi tüm istasyonları görür gibi. İstasyon erişimi olmayan veya modülü kapalı olan kullanıcı için varsayılan davranış açıkça **deny** olmalı.

## Kapsam ve yol haritası üzerine notlar

- Belge “Business Rules v1.0 dondurulmuştur” diyor; aynı zamanda sonraki aşamalarla temel kuralların tamamlanacağını belirtiyor. Vardiya kuralları henüz yazılmamışken dondurma ifadesi, değişiklik yönetimiyle çelişebilir. Bunu “Tenant/Station/User kararları v1.0 onaylıdır; diğer domainler tasarım aşamasındadır” diye daraltın veya kararların hangi bölümünün dondurulduğunu açıkça listeleyin.
- `Employee` aşamasını `Shift` öncesinde yapmak mantıklı; fakat vardiya tasarımı için önce temel personel alanları, aktif çalışma ilişkisi ve istasyon ataması yeterlidir. Maaş/prim ve tam İK süreçlerini vardiya MVP’sine bağlamayın.
- `Multi-Station` ayrı bir geç aşama olsa da tenant/istasyon sınırları ilk günden veri modelinde korunmalı; ilk sürümde tek istasyonla çalışmak, tek istasyona göre şemayı sabitlemek anlamına gelmemeli.
- Belge bir “Database Blueprint v1.0 — Plan Özeti”; tamamlanmış ERD veya onaylı, alanları kesinleştirilmiş şema olarak sunulmamalı. “Tamam” etiketli bölümler için de karar/inceleme kayıtları eklemek yararlı olur.

## Önerilen sonraki adım sırası

1. İlk sürüm kapsamı ve kullanıcı rollerini bir sayfalık ürün tanımında sabitleyin.
2. `Employee` için vardiya MVP’sine gereken asgari şemayı ve istasyon ataması tarihçesini belirleyin.
3. `Shift` için iş kuralları, durum diyagramı, aylık takvim senaryoları ve yetki matrisi hazırlayın.
4. Temsili senaryoları doğrulayın: gece vardiyası, ay sonu, çalışan değişimi, vardiya çakışması, son dakika değişikliği, devamsızlık, onay ve geriye dönük düzeltme.
5. Bu senaryolar onaylandıktan sonra ERD, indeksler, kısıtlar ve migration planını çıkarın.
6. Kasa/satış entegrasyonunun vardiya kapanışına gerçekten gerekli olan en küçük parçasını belirleyin; diğer modülleri sonraki fazlara ayırın.

## Sonuç

Mimari düşünce sağlam, ancak şu anki doküman **uygulama değil, erken aşama veri/mimari planıdır**. En doğru yatırım, bütün modülleri genişletmek değil; aylık plan, gerçekleşen çalışma, değişiklik/onay ve raporlama akışını netleştirip küçük bir istasyon senaryosunda uçtan uca doğrulamaktır. Bu yapılırsa çoklu istasyon ve ek modüller için tasarım kararları gerçek operasyon ihtiyaçlarına dayanır.
