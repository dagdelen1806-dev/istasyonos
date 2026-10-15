# Üretim maliyeti kaynak kaydı — 10 Ekim 2026

Bu dosya araştırma notudur, nihai bütçe değildir.

Cloud Vision: https://cloud.google.com/vision/pricing sayfası açıldı. TEXT_DETECTION ve DOCUMENT_TEXT_DETECTION aylık ilk 1000 birim ücretsiz; 1001–5 milyon arası 1000 birim $1.50, 5 milyon üstü $0.60. Her görüntüde her feature ayrı billable unit, PDF her sayfa görüntü. Son blok orantılı. Uygulama/storage ve outbound ayrıca.

Textract: https://aws.amazon.com/textract/pricing/ açıldı. Resmî Oregon örnekleri: DetectDocumentText ilk1m sayfa $0.0015/page; AnalyzeExpense ilk1m $0.01/page. AnalyzeExpense OCR dâhil; aynı belge için detect+expense iki kez çağrılmaz. Bölge fiyatı değişebilir. Kısa süreli yeni müşteri free tier kalıcı bütçeden çıkarılacak. Türkçe uygunluğu henüz doğrulanmadı.

DO Droplets: https://www.digitalocean.com/pricing/droplets açıldı. Regular Basic: 1vCPU/2GiB $12/mo; 2vCPU/2GiB $18/mo; 2vCPU/4GiB $24/mo; 4vCPU/8GiB $48/mo. Daily backup 30%, weekly20% compute. 2026 persecond min60sec/0.01. Admin/monitoring iş gücü fiyatı değil.

DO Spaces: https://www.digitalocean.com/pricing/spaces-object-storage açıldı. $5/mo account bundle, 250GiB storage,1TiB outbound; extra $0.02/GiB storage, $0.01/GiB transfer. Evidence private; CDN public defaults kullanılmamalı.

DO PostgreSQL: https://docs.digitalocean.com/products/databases/postgresql/details/pricing/ açıldı (verified30Sep2026). Single node preliminarydevelopment/testing, HA primary+matchingstandby. Advanced begins $130/node, standby same. Yeni hesaplar için15Oct2026; tüm hesaplar30Nov2026 yeni Standard cluster >4GiB veya standby/read-only eklenemeyecek. Bu değişiklik HA üretim önerisinin maliyetini değiştirir; detay duyuru açılmalı.

DO pricing table: https://www.digitalocean.com/pricing/managed-databases açıldı. Standard 1GiB15.15,2GiB30.45,4GiB60.90; storage .215/GiB. Ücret tablosundaki minimum storage dâhil/hariç açık değil; duyuru/pricing explanation ile netleştirilecek. Eski60USD HA önerisine güvenilmeyecek.

Turpak: https://turpak.com.tr/pompa-otomasyon-cozumleri/ açıldı: pompa satış, vardiya, personel raporlama/merkez yönetimi ve teklif formu. https://turpak.com.tr/urun-kategori/vision-pompa-yazar-kasa/ açıldı: bankalarla entegrePOS ürün seçenekleri ve satış teklifi. Kamuya açık kesin externalAPI endpoint/auth/ratecard bulunmadı. Entegrasyon erişim/lisans ücretine uydurma rakam verilmeyecek. Her cihaz/model için yetkili sağlayıcı yazılı dış arayüz teklifi gerekli.

## Netleşen kullanıcı kararı ve son bulgular

Kullanıcı 10Oct2026: ilkpilot1station; günlük500–1000slip; TurpakAPI/export için yazılım bittikten sonra dilekçe başvurusu. API erişimi varsayılmaz, belge/import/OCRkanıt yolu ilkmoddur.

https://docs.cloud.google.com/vision/docs/languages açıldı: Türkçe tr supported; DOCUMENT_TEXT_DETECTION otomatik full supported language set. https://docs.cloud.google.com/vision/docs/ocr açıldı: global default yer garantisi yok; eu-vision.googleapis.com ve /locations/eu uçları yalnızAB işleme/saklama. Dil hint default auto, tr ancak benchmarkta iyileşiyorsa.

https://aws.amazon.com/textract/faqs/ açıldı: text supported EN/DE/FR/ES/IT/PT; invoices/receipts extraction Englishonly. Türkçe slip üretimi için önerilmeyecek; fiyat yalnız ekonomik referans.

https://www.kvkk.gov.tr/Icerik/7997/The-Procedures-And-Principles-For-The-Transfer-Of-Personal-Data-Abroad açıldı: Article6 adequate/safeguards, Art14 standardcontract şartı ve imza sonrası5işgünü bildirim. ABendpoint KVKK otomatikuyum değil; hukuk/sözleşme gate.

https://www.digitalocean.com/pricing/managed-databases gerçek browser Advanced seçimi: 8GiB/2vCPU/disk50GiB default $135.75/mo (dokümandaki130başlangıç +50×.115=135.75). Additionalnodes1 seçimi toplam$271.50/mo gösterdi. Bu doğru diskdâhil HA bazfiyatı; .115/GiB extra yalnız varsayılandan artış. Standard default2GiB30GiB30.45,1GiB10GiB15.15 baz fiyatları. Dynamic table minstorage tekrar eklenmeyecek. 15Oct2026AdvancedBasic yeni tarifesi henüz teyit edilmedi; mevcutGeneralPurpose referansı kullanılacak.

https://www.digitalocean.com/pricing/load-balancers açıldı: regional başlangıç$12/mo.

https://docs.digitalocean.com/release-notes/upcoming/dbaas-plan-changes/ açıldı: 15Oct2026 daha öncePostgreSQL/MySQLclusteroluşturmamışhesaplar;30Nov2026tümhesaplarda yeniStandardstandby/read-only ve>4GiB yok. Mevcutcluster unaffected;15OctAdvancedshared8–64GiB seçeneğiyeni, fiyatteyidigerekiyor.

GİB İOS teknik kılavuz3.1.16 dosya/XMLdışaaktarım;3.1.8 veritabanına yetkisizerişimyok. https://ynokc.gib.gov.tr/UploadedFiles/Files/IstasyonOtomasyonSistemiTeknikKilavuzu1_0.pdf yeniden açıldı. API şartı değildir ve OCR resmî mali veri aktarımının yerine geçmez.
