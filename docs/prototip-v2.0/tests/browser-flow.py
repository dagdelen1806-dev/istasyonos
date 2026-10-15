"""Yalnız sentetik v2.0 demo; gerçek servis/veri/fotoğraf kullanmaz.
Önce node server.mjs başlatılır, ardından python3 tests/browser-flow.py.
"""
from playwright.sync_api import sync_playwright
import os,json
from pathlib import Path
BASE=os.getenv('DEMO_BASE_URL','http://127.0.0.1:8766')
results=[]
def ok(label):results.append(label);print('PASS',label,flush=True)
def ready(p):p.wait_for_function("document.querySelector('#actor').disabled === false")
def tab(p,key):p.locator(f'#navigation [data-tab="{key}"]').click()
def change_actor(p,key):p.select_option('#actor',key);p.wait_for_timeout(350);ready(p)
def review_first(p):
 p.locator('#app [data-action="review-slip"]:not([disabled])').first.click()
 p.locator('#review-form textarea[name="reason"]').fill('Sentetik belgedeki tutarı ve kaynak alanlarını teyit ettim.')
 p.locator('#review-form button[type="submit"]').click()
 p.wait_for_function("document.querySelector('#review-dialog').open === false")
 ready(p)
def server_state(p):
 return p.evaluate("""async () => (await fetch('/api/demo/state', {headers:{'X-Demo-Workspace':sessionStorage.getItem('stationos-v20-workspace'),'X-Demo-Actor':document.querySelector('#actor').value}})).json()""")['state']

with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1365,'height':900})
 p=context.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.goto(BASE);p.wait_for_selector('form[data-form="open-account"]');ready(p)
 p.locator('form[data-form="open-account"]').first.locator('button[type="submit"]').click();p.wait_for_selector('[data-action="load-sample"]');ready(p)
 ok('Kendi atanmış vardiyası 100 TL float ile açıldı')
 p.locator('[data-action="load-sample"]').click();p.wait_for_timeout(250);ready(p)
 s=server_state(p);a=s['accounts'][0];assert a['summary']['expectedCashMinor']=='360000',a
 assert a['summary']['verifiedCardMinor']=='0'
 ok('Eski tahsilat/float yeni satış dışında; beklenen kasa 3.600 TL')
 tab(p,'slips');review_first(p);review_first(p)
 s=server_state(p);assert s['accounts'][0]['summary']['verifiedCardMinor']=='600000'
 ok('İki slip personel teyidiyle 6.000 TL tekil toplama alındı')
 tab(p,'handover');p.locator('[data-action="submit"]').click();p.wait_for_timeout(250);ready(p)
 a=server_state(p)['accounts'][0];assert a['status']=='SUBMITTED';assert a['cashHandover']['offeredMinor']=='350000'
 tab(p,'payments');assert p.locator('form[data-form="declaration"] button').is_disabled()
 ok('Dijital teslimde veri kilitlendi, 3.500 TL fizikî teklif oluştu')
 change_actor(p,'mehmet');p.wait_for_selector('form[data-form="receive-cash"]')
 p.locator('form[data-form="receive-cash"] input[name="reason"]').fill('Sentetik 3.500 TL nakit sayımı ve alıcı teyidi eşleşti.')
 p.locator('form[data-form="receive-cash"] button').click();p.wait_for_timeout(250);ready(p)
 assert server_state(p)['accounts'][0]['cashHandover']['status']=='ACCEPTED'
 ok('Saha alıcısı ayrı kimlikle fizikî teslimi kabul etti')
 change_actor(p,'elif');p.fill('#accounting-reason','Slip ve sayım incelendi; IBAN bankada eşleşme bekliyor.')
 p.locator('[data-action="stale-approve"]').click();p.wait_for_timeout(250);ready(p)
 assert p.locator('#feedback').get_attribute('class').endswith('error')
 assert len(server_state(p)['accounts'][0]['approvals'])==0
 ok('Eski sürüm mali imza oluşturmadı')
 p.fill('#accounting-reason','Slip ve sayım incelendi; IBAN bankada eşleşme bekliyor.')
 p.locator('[data-action="approve"]').click();p.wait_for_timeout(250);ready(p)
 a=server_state(p)['accounts'][0];assert a['status']=='IN_REVIEW';assert len(a['approvals'])==1
 ok('İlk mali imza kaydedildi; ikinci kişi bekleniyor')
 change_actor(p,'zeynep');p.fill('#accounting-reason','İkinci mali inceleme tamam; 700 TL IBAN banka eşleşmesi bekleniyor.')
 p.locator('[data-action="approve"]').click();p.wait_for_timeout(250);ready(p)
 a=server_state(p)['accounts'][0];assert a['status']=='ACCEPTED_WITH_PENDING';assert a['summary']['pendingIban'] is True
 ok('İkinci kişi kabulü; pending IBAN kesin nakde dönüştürülmedi')
 p.reload();ready(p);assert server_state(p)['accounts'][0]['status']=='ACCEPTED_WITH_PENDING'
 ok('Sayfa yenilemede demo sunucu durumu korundu')
 p.goto(BASE+'/yonetim.html');p.wait_for_selector('#role-select');p.locator('a[href="/personel/"]').click();ready(p)
 ok('Eski firma/raporlama modülünden yeni personel akışına dönüş çalışıyor')
 change_actor(p,'can');assert server_state(p)['accounts']==[]
 assert p.locator('#navigation [data-tab="accounting"]').count()==0
 ok('İkinci personel başka çalışanın hesabını veya mali kuyruğu görmüyor')
 assert not errors,errors
 ok('Akış boyunca tarayıcı JavaScript hatası yok')
 context.close()
 mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 m=mobile.new_page();m.goto(BASE);m.wait_for_selector('form[data-form="open-account"]');ready(m)
 assert m.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobil yatay taşma'
 m.screenshot(path='/tmp/istasyon-v20-mobil.png',full_page=True)
 ok('390 px mobil açılışta yatay taşma yok')
 mobile.close();browser.close()
print(json.dumps({'tests':len(results),'passed':len(results),'results':results},ensure_ascii=False,indent=2))
