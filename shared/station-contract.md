# İstasyonOS iç REST sözleşmesi

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
 payments:[{id,accountId,kind:'CASH'|'IBAN'|'DEBT'|'AR_COLLECTION',amountMinor,debtorId,reference,status}],
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
- `/invite {requestId,role,stationIds}` owner/manager -> result `{code,expiresAt}` one-time binding membership, must not assign OWNER.
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
