"""Grafik renderer; Excel import/valör motoru değildir. Gerçek veri yoksa boş durumu çizer.
Kullanım: python3 likidite-v1.9-grafik-render.py --input veri.json --output grafik.png
JSON daily: date, scenario, closing_minor, buffer_minor, inflow_minor, outflow_minor.
Minor değerler integer veya integer string; null eksiktir. TL decimal float input yok.
"""
import argparse,json
from pathlib import Path
from decimal import Decimal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def minor(v):
    if v is None:return None
    if isinstance(v,bool) or not ((isinstance(v,int)) or (isinstance(v,str) and v.lstrip('-').isdigit())):
        raise ValueError('Tutar integer minor veya null olmalı')
    return Decimal(str(v))/Decimal(100)

def render(data,out):
    if data.get('currency')!='TRY':raise ValueError('Bu renderer TRY içindir; currencies toplanmaz')
    plt.rcParams.update({'font.family':'DejaVu Sans','font.size':11,'axes.spines.top':False,'axes.spines.right':False})
    fig,axes=plt.subplots(2,2,figsize=(15,9));fig.set_facecolor('#F8FAFC')
    fig.suptitle('AKARYAKIT V1 | Likidite grafik yapısı — v1.9',fontsize=20,fontweight='bold',x=.05,ha='left')
    titles=['7 günlük kapanış nakdi / tampon','Günlük giriş ve çıkışlar','Kart brüt → kesinti → banka neti','Hesap / istasyon açıkları']
    for ax,title in zip(axes.flat,titles):
        ax.set_title(title,loc='left',fontweight='bold',pad=12);ax.set_facecolor('white');ax.set_ylabel('TL');ax.grid(axis='y',color='#E2E8F0');ax.set_axisbelow(True)
    if data.get('status')!='VALIDATED' or not data.get('snapshot_at') or not data.get('daily'):
        for ax in axes.flat:
            ax.set_xticks([]);ax.set_yticks([]);ax.set_ylabel('')
            ax.text(.5,.56,'GERÇEK VERİ BEKLENİYOR',transform=ax.transAxes,ha='center',va='center',fontsize=15,color='#B45309',fontweight='bold')
            ax.text(.5,.38,'Boş veri sıfır değildir.\nDemo tutar / oran çizilmedi.',transform=ax.transAxes,ha='center',va='center',fontsize=12,color='#64748B')
    else:
        from collections import defaultdict
        by=defaultdict(list)
        for r in data['daily']:by[r['scenario']].append(r)
        ax=axes[0,0]
        for name,rows in by.items():
            rows=sorted(rows,key=lambda x:x['date']);ys=[minor(r.get('closing_minor')) for r in rows]
            ax.plot([r['date'] for r in rows],[float(y) if y is not None else float('nan') for y in ys],marker='o',label=name)
        base=sorted(by.get('BASE',[]),key=lambda x:x['date'])
        if base:
            ax.plot([r['date'] for r in base],[float(minor(r['buffer_minor'])) if r.get('buffer_minor') is not None else float('nan') for r in base],linestyle='--',color='#B45309',label='Tampon')
        ax.legend();ax.tick_params(axis='x',rotation=30)
        ax=axes[0,1]
        x=list(range(len(base)))
        ins=[minor(r.get('inflow_minor')) for r in base];outs=[minor(r.get('outflow_minor')) for r in base]
        ax.bar([i-.2 for i in x],[float(v) if v is not None else float('nan') for v in ins],width=.4,label='Giriş',color='#0F766E')
        ax.bar([i+.2 for i in x],[-float(v) if v is not None else float('nan') for v in outs],width=.4,label='Çıkış',color='#334155')
        ax.set_xticks(x,[r['date'] for r in base],rotation=30);ax.legend()
        for ax,field in [(axes[1,0],'card_bridge'),(axes[1,1],'account_risk')]:
            rows=data.get(field,[])
            if not rows:ax.text(.5,.5,'Bu grafik için doğrulanmış veri yok',transform=ax.transAxes,ha='center',color='#B45309');continue
            vals=[minor(r.get('amount_minor')) for r in rows]
            ax.bar([r['label'] for r in rows],[float(v) if v is not None else float('nan') for v in vals],color='#0F766E');ax.tick_params(axis='x',rotation=25)
    fig.text(.05,.02,'Veri: '+str(data.get('status'))+' | Snapshot: '+str(data.get('snapshot_at'))+' | Nakit projeksiyonu kâr değildir.',fontsize=11,color='#64748B')
    fig.tight_layout(rect=(0,.05,1,.93));fig.savefig(out,dpi=150);plt.close(fig)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',default='likidite-v1.9-grafik-verisi.json');p.add_argument('--output',default='likidite-v1.9-grafik-bos-durum.png');a=p.parse_args()
    data=json.loads(Path(a.input).read_text());render(data,a.output);print('Grafik:',Path(a.output).resolve())
