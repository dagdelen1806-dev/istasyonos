# v2.0 geliştirme hedefleri

- [x] Sunucu aksiyonları: demo kimliğine atanmış hesap, own-account, TRY integer para, immutable audit; revizyon ve aynı payload idempotency; workspace isolation ve sensitive upload yok.
- [x] Personel arayüzü: hesap açılışı, nakit/IBAN/borç/eski alacak tahsilatı, hazır sentetik OCR slip adayını onaylama/düzeltme/ret, tekil slip toplamı, count ve kaynak/payment farkları.
- [x] Dijital/fizikî teslim: submit sonrası edit kilidi, ayrı nakit teklif/alıcı sayımı, source ve IBAN pending açık; muhasebe 2 farklı demo kişi, ilk imza pending, eski sürüm reddi, bilgi iste/yeni sürüm.
- [x] Çok terminal: aynı DEMO kişi en çok 5 mantıksal masaüstü lease; telefon ayrı; release ve duplicate token tekil.
- [x] Entegre önizleme: eski firma/istasyon/finans sayfasına erişim, yeni akışa geri dönüş, mobil yerleşim; API/route manifests ve static serving.
- [x] Bu akışların kaynak kod ve sentetik test sonuçlarıyla doğrulanması; canlı OCR/auth/DB yapılmadığının ve gerçek veri beklemenin teslimatta açık belirtilmesi.

Doğrulama: 7 API test grubu ve 13 Chromium kontrolü geçti. Sınırlar test-sonuclari.md içinde.
