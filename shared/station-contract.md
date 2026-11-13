# İstasyonOS iç REST sözleşmesi

## Tarih ve davet yanıtı sözleşmesi — Faz 1

Sunucu anları ISO 8601 `Z` olarak döndürür. İstemci vardiya ve slip anlarını
açık saat farkıyla gönderir; Türkiye gösterimi `Europe/Istanbul` kullanır.
Vade tarihleri `YYYY-MM-DD` takvim tarihi olarak kalır. `/shift` alanları
`startsAt` ve isteğe bağlı `endsAt` ile `/slip` alanı `transactionAt`, saniye
içeren ISO 8601/RFC 3339 biçiminde açık `Z` veya `±HH:MM` farkı taşımalıdır.
Örnek: `2026-10-28T15:30:00+03:00` = `2026-10-28T12:30:00Z`.
Saat dilimsiz, yalnız tarih içeren veya geçersiz takvim değerleri HTTP 400 ve
`INVALID_INPUT` koduyla, alan adını içeren Türkçe hata döndürür. Türkiye saatine
otomatik çevirme yapılmaz. Kontrol idempotency tekrarından önce de uygulanır;
eski başarılı yanıt, geçersiz yeni girdiyi kabul ettirmez. Geçerli tekrar
isteklerinde mevcut idempotency sözleşmesi korunur.

Kesirli saniyeler mevcut JavaScript/DATETIME(3) hassasiyetinde milisaniyeye
indirilir; daha küçük basamaklar yuvarlanmadan atılır. Saniye `60` (artık saniye)
ve MySQL DATETIME aralığı dışındaki yıllar desteklenmez. `/payable.dueDate`
gerçek ve geçerli `YYYY-MM-DD` takvim tarihi olmalı; tarih-saat gönderilmez.

Davet oluşturma yanıtı `{ok:true,result:{code,expiresAt}}` olarak kalır.
Yeni davetlerin idempotency yanıtları sunucuda AES-256-GCM ile şifrelenir;
tekrarda güncel tenant/rol/istasyon yetkisi kontrol edilir. Eski açık kayıtlar
bu geliştirmede dönüştürülmez. Anahtar kurulumu ve geri dönüş sınırlamaları
`docs/faz1-paket1-paket2-uygulama.md` dosyasında açıklanır.

Tüm alanlar camelCase; para integer `amountMinor` (kuruş), stok adet integer. `/api/stationos` altında gerçek SDK session auth. `POST` header `Content-Type: application/json`, `X-Stationos-Request: 1`, varsa CSRF token state'ten; actor/role client'tan alınmaz. Mutation body's `requestId` UUID unique ve payload hash ile idempotent. Yanıt `{ok:true,result?:any}` veya `{ok:false,error:{code,message}}`. GET state doğrudan aşağıdaki objeyi döner (ok alanı isteğe bağlı).

## State

`GET /state?stationId=ID`:

```
{
 user:{id:number,name:string,email:string|null}, canSetup:boolean,
 tenant:null|{id:string,name:string,isDemo:boolean},
 member:null|{role:'OWNER'|'MANAGER'|'ACCOUNTANT'|'FUEL_STAFF'|'MARKET_STAFF'|'PURCHASER',stationIds:string[]},
 csrfToken?:string,
 companies:[{id,name,taxNumber}], stations:[{id,companyId,name,code,address}],
 members:[{userId,name,email,role,stationIds}],
 shifts:[{id,stationId,label,startsAt,endsAt,status}],
 accounts:[{id,stationId,shiftId,userId,userName,status,revision,businessUnit,openingFloatMinor,sourceSalesMinor:null|number,sourceRef,cardTotalMinor,cashSalesMinor,ibanMinor,debtMinor,arCollectionMinor,expectedCashMinor,countedCashMinor:null|number,differenceMinor:null|number,cashReceiverUserId:null|number,signatureCount:number}],
payments:[{id,accountId,kind:'CASH'|'IBAN'|'FAST'|'DEBT'|'AR_COLLECTION',amountMinor,debtorId,reference,status}],
 slips:[{id,accountId,amountMinor,reference,terminalId,transactionAt,status:'VERIFIED'|'REJECTED',method:'MANUAL',note}],
 debtors:[{id,name,type:'PERSON'|'COMPANY',balanceMinor}],
 products:[{id,stationId,name,barcode,stockQty,minimumQty,purchasePriceMinor,salePriceMinor,supplierId}],
 suppliers:[{id,name,creditLimitMinor,balanceMinor,dueMinor}],
 payables:[{id,supplierId,supplierName,amountMinor,dueDate,status}],
 recommendations:[{productId,productName,supplierId,supplierName,averageDaily,stockQty,daysCover,recommendedQty,costMinor,availableCreditMinor,status}],
 audit:[{id,actorName,action,entityId,createdAt}],
 integrationStatus:{turpak:'DISABLED',ocr:'DISABLED',bank:'DISABLED'}
}
```

Arrays show only member-authorized station records; sensitive costs/debtors limited role. Unknown logged-in user member null; owner canSetup when not yet tenant. Data entirely real DB records; no implicit demo seed. Optional demo tenant only explicit create. GET empty state still includes arrays.

## Mutations

- `POST /setup {requestId,companyName,taxNumber,stationName,stationCode,isDemo:false}` owner only -> initial tenant/company/station/OWNER membership. isDemo=true explicit isolated sample workspace may add clearly labelled sample products, suppliers, shifts; no real balances claimed.
- `/company {requestId,name,taxNumber}` manager/owner
- `/station {requestId,companyId,name,code,address}` manager/owner
- `/invite {requestId,role,email,stationIds}` owner/manager -> result `{code,expiresAt,invitedEmail}`. The management UI selects one authorized station per invitation. New `v2` codes are bound to the normalized email address and can only be claimed by a logged-in user whose account email matches. The code is one-use and expires after seven days; the application does not send email. The invitee creates their own account/name/password. The code and response remain encrypted in the existing idempotency record; invitation table schema is unchanged. Legacy unprefixed invitations remain claimable under their existing rules. Invite acceptance does not activate a REVIEW_REQUIRED station membership or grant shift assignment.
- `/join {requestId,code}` authenticated unassigned -> safe invitation claim.
- `/shift {requestId,stationId,label,startsAt,endsAt}` manager/owner
- `/account/open {requestId,stationId,shiftId,businessUnit:'FUEL'|'MARKET',openingFloatMinor}` own account only.
- `/payment {requestId,accountId,expectedRevision,kind,amountMinor,debtorId?,reference?}` own open account (OWNER/MANAGER may open own; not edit others).
- `/slip {requestId,accountId,expectedRevision,amountMinor,reference,terminalId,transactionAt,note}` own open account; manual verified evidence, unique station+terminal+reference/date; no file upload.
- `/account/source {requestId,accountId,expectedRevision,sourceSalesMinor,sourceRef}` manager/owner separate from employee beyan; source manual and labelled. own-source allowed but cannot own approval.
- `/account/submit {requestId,accountId,expectedRevision,countedCashMinor}` own account, snapshot locks, reject unexplained payment/source/cash discrepancy; pending IBAN acknowledged.
- `/account/cash-receive {requestId,accountId,expectedRevision,receivedMinor,note}` manager/accountant, not account user; expected cash includes cash+AR collections, excludes retained float.
- `/account/approve {requestId,accountId,expectedRevision,note}` accountant/owner (MANAGER if assigned financial role? keep no financial MANAGER); own account prohibited, cash received, source matches. 2 distinct userIds then ACCEPTED or ACCEPTED_WITH_PENDING. first signature IN_REVIEW. Signature snapshot revision-bound; revisions change on each action.
- `/account/return {requestId,accountId,expectedRevision,note}` accountant/owner, own prohibited, -> OPEN reset signatures with audit/history. No editing original journal amounts in place; this first app can append additional records to returned account. No hidden automatic refunds.
- `/debtor {requestId,stationId,name,type}` own-role creation with minimal name only.
- `/collection {requestId,stationId,debtorId,amountMinor,reference}` owner/accountant -> separate AR decrease receipt, no ciro; limited to balance; use debt ledger.
- `/product {requestId,stationId,name,barcode,minimumQty,purchasePriceMinor,salePriceMinor,supplierId?}` manager/purchaser
- `/stock {requestId,stationId,productId,quantity,kind:'RECEIPT'|'SALE'|'ADJUSTMENT',reference}` manager/purchaser receipt, staff sale; immutable movement; don't silently add market sale to fuel account. SALE records market sale revenue; no fiscal YN ÖKC claim. Reject negative stock.
- `/supplier {requestId,stationId,name,creditLimitMinor}` owner/purchaser
- `/payable {requestId,stationId,supplierId,amountMinor,dueDate,reference}` owner/accountant/purchaser. No fake opening bank balances.
- `/terminal {requestId,stationId,accountId,deviceId,action:'ACQUIRE'|'RELEASE',kind:'DESKTOP'|'MOBILE'}` own scoped real account desktop max5 TTL lease; same device heartbeat renew no dup. Phones distinct participant no count.

Aggregate recommendations deterministic not LLM. Avoid auto ordering. APIs are own software contract, no real Turpak endpoint.

## Y-08 — Kalıcı işlem kurtarma (sürüm 2)

Tenant kapsamındaki mutasyonların mevcut URL, `requestId` UUID ve başarı yanıtları korunur. Yeni isteklerde kimlik; oturum aktörü, tenant, işlem yolu, sözleşme sürümü, güncel rol/istasyon kapsamı ve canonical payload SHA-256 ile bağlanır. Nesne anahtar sırası normalize edilir; açık saat farkı içeren tarih-saatler UTC anına çevrilir. Takvim tarihleri değişmez. Diğer payload farklılıkları ihtiyatlı olarak farklı içerik sayılır. Aynı kimlikle farklı içerik/işlem `409`, değişen tenant/yetki kapsamı `403` üretir.

`GET /requests/status?requestId=UUID&tenantId=ID&operation=%2Fpayment&version=2` oturum gerektirir. Aktör query'den alınmaz. Yanıt `{ok:true,state,message,response?,errorCode?,retryAfterMs?}` biçimindedir. Durumlar: `NOT_FOUND`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `UNCERTAIN`. Yalnız `COMPLETED` doğrulanmış `{ok:true,result}` döndürür. `FAILED` yalnız rollback doğrulandığında kaydedilir. Yakın tarihli niyet `IN_PROGRESS`; 30 saniyeyi aşan, bozuk veya çelişkili kayıt `UNCERTAIN` olur. Zaman aşımı işlemi iptal etmez. Başka kullanıcı/tenant/işlem/sürüm/yetki kapsamı, olmayan kayıtla aynı `NOT_FOUND` yanıtını alır. Bulunamama, mali etkinin yokluğuna kanıt değildir.

Tarayıcı isteği göndermeden metadata kaydeder. Hassas payload ve sonuç kalıcı depoya yazılmaz. Aynı kullanıcı/tenant için bir bekleyen işlem vardır; sekmeler Web Locks ile uzlaşır. Yenilemede ve belirsizlikte yalnız durum sorgulanır; otomatik POST veya yeni requestId yoktur. Başarılı doğrudan yanıt teslim edildikten sonra kayıt temizlenebilir; kurtarılan başarı/başarısızlık kullanıcı onayıyla kapatılır. Diğer durumlar yönetici incelemesi gerektirir.

Eski `st_requests` mali kayıtları otomatik dönüştürülmez: tekrar POST `409 LEGACY_REQUEST_REVIEW_REQUIRED` üretir, durum sorgusu `NOT_FOUND` döner. Eski davet yanıtının Y-01 creator/tenant/istasyon doğrulamalı salt okunur replay istisnası korunur. Tenant öncesi `/setup`, `/join` ve salt okunur `/assistant` kalıcı kurtarma kapsamı dışındadır. Yeni `0007_request_recovery.sql` ayrı dağıtım onayı gerektirir; migration otomatik çalışmaz. Ayrıntı: `docs/faz1-y08-kalici-islem-kurtarma.md`.
