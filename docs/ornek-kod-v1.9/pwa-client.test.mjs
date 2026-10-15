import test from 'node:test';
import assert from 'node:assert/strict';
import { submitHandover } from './pwa-client.mjs';
const input = { accountId: 'acc-1', revision: 3, snapshotHash: 'h3', clientEventId: 'event-1', idempotencyKey: 'key-1', csrfToken: 'csrf-test' };
const response = (status, data={}) => ({ status, ok: status>=200&&status<300, json: async () => data });
test('PWA ağ exception teslim başarısız varsaymaz; ACK belirsiz',async()=>{
 assert.deepEqual(await submitHandover(input,async()=>{throw Error('network');}),{state:'ACK_UNKNOWN',retryWithSameKey:true});
});
test('PWA eski revision refresh ister',async()=>{
 assert.equal((await submitHandover(input,async()=>response(409))).state,'REFRESH_CONFLICT');
});
test('PWA yetkisiz istek otomatik retry olmaz',async()=>{
 assert.equal((await submitHandover(input,async()=>response(403))).state,'REAUTH_OR_DENIED');
});
test('PWA 202 OCR queued gerçek teslim ACK sayılmaz',async()=>{
 assert.equal((await submitHandover(input,async()=>response(202,{state:'OCR_PENDING'}))).state,'ACK_UNVERIFIED');
});
test('PWA SUBMITTED ID revision doğru ise teslim',async()=>{
 let captured;
 const out=await submitHandover(input,async(url,options)=>{captured={url,options};return response(201,{state:'SUBMITTED',handoverId:'ho-1',revision:3});});
 assert.equal(out.state,'SUBMITTED');assert.equal(captured.options.cache,'no-store');assert.equal(captured.options.credentials,'include');
 assert.equal(captured.options.headers['Idempotency-Key'],'key-1');assert.equal(captured.options.headers['If-Match'],'"3"');
 const body=JSON.parse(captured.options.body);assert.equal(body.policy,undefined);assert.equal(body.role,undefined);assert.equal(body.clientEventId,'event-1');
});
test('PWA 503 visible pending aynı key ile',async()=>{
 const out=await submitHandover(input,async()=>response(503));assert.equal(out.state,'SERVER_PENDING');assert.equal(out.retryWithSameKey,true);
});
test('PWA eksik CSRF veya revision doğrulanmaz',async()=>{
 await assert.rejects(submitHandover({...input,csrfToken:null},async()=>response(200)),/TESLIM_GIRDISI_EKSIK/);
});
