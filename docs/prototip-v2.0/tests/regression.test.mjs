import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoServer} from '../server.mjs';
async function fixture(fn) {
 const server=createDemoServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const boot=await (await fetch(base+'/api/demo/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
  let i=0;
  const get=async(actor='ay')=>(await (await fetch(base+'/api/demo/state',{headers:{'X-Demo-Workspace':boot.workspaceId,'X-Demo-Actor':actor}})).json()).state;
  const act=async(actor,type,accountId,payload={},expectedRevision)=>{
   const response=await fetch(base+'/api/demo/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Workspace':boot.workspaceId,'X-Demo-Actor':actor},body:JSON.stringify({type,accountId,payload,expectedRevision,idempotencyKey:'reg-'+(++i)})});
   return {status:response.status,...await response.json()};
  };
  await fn({base,get,act});
 } finally {await new Promise(r=>server.close(r));}
}
test('Minor alanları kuruştur; yönetici edit, sıfır beyan ve sessiz slip düzeltmesi reddedilir',()=>fixture(async({get,act})=>{
 const opened=await act('ay','OPEN_ACCOUNT',undefined,{assignmentId:'assignment-ay-s02',float:'100.00'});const id=opened.result.accountId;
 assert.equal(opened.state.accounts[0].openingFloatMinor,'10000');
 const denied=await act('mehmet','ADD_DECLARATION',id,{kind:'CASH',amount:'1.00',sourceRef:'ROLE-TEST'});assert.equal(denied.status,403);
 const zero=await act('ay','ADD_DECLARATION',id,{kind:'CASH',amount:'0.00',sourceRef:'ZERO-TEST'});assert.equal(zero.status,400);
 assert.equal((await get()).accounts[0].revision,1);
 await act('ay','LOAD_SAMPLE',id);let a=(await get()).accounts[0];assert.equal(a.declarations[0].amountMinor,'300000');
 const changed=await act('ay','REVIEW_SLIP',id,{slipId:a.slips[0].id,action:'VERIFY',amount:'3501.00',reason:'Farklı tutar sessizce uygulanamaz'},a.revision);assert.equal(changed.error.code,'CORRECTION_REVIEW_REQUIRED');
 a=(await get()).accounts[0];assert.equal(a.summary.verifiedCardMinor,'0');assert.equal(a.slips[0].status,'PENDING_REVIEW');
 await act('ay','ADD_SLIP',id,{scenario:'SALE_3500'});a=(await get()).accounts[0];assert.equal(a.slips.at(-1).status,'REJECTED');
}));
test('Ödeme toplamı eşit olsa da kart/POS farkı teslimi bloklar; iki eski sürüm yazımı tek sonuç üretir',()=>fixture(async({get,act})=>{
 const opened=await act('ay','OPEN_ACCOUNT',undefined,{assignmentId:'assignment-ay-s02',float:'0.00'}),id=opened.result.accountId;
 await act('ay','ADD_DECLARATION',id,{kind:'CASH',amount:'10000.00',sourceRef:'ALL-CASH'});let a=(await get()).accounts[0];
 const attempts=await Promise.all([act('ay','COUNT_CASH',id,{amount:'10000.00'},a.revision),act('ay','COUNT_CASH',id,{amount:'9999.00'},a.revision)]);
 assert.deepEqual(attempts.map(x=>x.status).sort(),[200,409]);a=(await get()).accounts[0];
 assert.equal(a.summary.paymentDifferenceMinor,'0');
 const submit=await act('ay','SUBMIT',id,{},a.revision);assert.equal(submit.error.code,'CARD_SOURCE_DIFFERENCE');
}));
test('Bilgi talebi sonrası önceden alınmış fizikî nakit korunur; yeni mali sürüm eski imzayı saymaz',()=>fixture(async({get,act})=>{
 const opened=await act('can','OPEN_ACCOUNT',undefined,{assignmentId:'assignment-can-s02',float:'100.00'}),id=opened.result.accountId;
 await act('can','LOAD_SAMPLE',id);let a=(await get('can')).accounts[0];
 await act('can','SUBMIT',id,{},a.revision);a=(await get('can')).accounts[0];
 await act('mehmet','RECEIVE_CASH',id,{amount:'5000.00',reason:'Nakit fizikî alıcı tarafından sayıldı'});a=(await get('can')).accounts[0];const originalCashId=a.cashHandover.id;
 await act('elif','APPROVE',id,{snapshotHash:a.snapshotHash,reason:'İlk sürüm mali inceleme sentetik testi'},a.revision);
 await act('zeynep','ASK_INFO',id,{reason:'Notların revize edilmesi ve yeniden teslimi gerekli'});
 a=(await get('can')).accounts[0];await act('can','REVISE',id,{},a.revision);a=(await get('can')).accounts[0];
 await act('can','SUBMIT',id,{},a.revision);a=(await get('can')).accounts[0];
 assert.equal(a.cashHandover.id,originalCashId);assert.equal(a.cashHandover.status,'ACCEPTED');assert.equal(a.cashHandover.receivedMinor,'500000');
 const newSig=await act('zeynep','APPROVE',id,{snapshotHash:a.snapshotHash,reason:'Yeni sürüm ilk güncel imza eskiyi saymaz'},a.revision);
 assert.equal(newSig.result.status,'IN_REVIEW');assert.equal(newSig.result.approvalCount,1);
}));
