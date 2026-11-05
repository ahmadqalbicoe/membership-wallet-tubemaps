# Builds src/map.json (tube-map layout) from src/master_rows.json (master centre list incl. Batch 1 updates).
# Run from the src folder: python3 build_layout.py   then: python3 build_site.py
import openpyxl,json,re,math,collections,random
from statistics import mean
rows=json.load(open('master_rows.json'))
H=['name','type','town','la','nation','postcode','size','owner','pension','evidence','region','website','manager']
def short(la):
    s=la
    for p in [' London Borough Council',' City and District Council',' and District Council','London Borough of ','Royal Borough of ','City of ','Royal ',' Metropolitan Borough Council',' Metropolitan District Council',' Borough Council',' District Council',' City Council',' County Borough Council',' County Council',' London Borough Council',' Council',' Borough',' (London)']:
        s=s.replace(p,'')
    s=s.replace(' Islands','').strip()
    s=re.sub(r' County$','',s).replace('Borough of ','').replace('City and County of ','')
    if la.startswith('City of London'): s='City of London'
    if s.startswith('To confirm'): s=s.split('(',1)[-1].rstrip(')').replace(' City','')+' (TBC)'
    return s
LINES={'Greater London':'#DC241F','South East':'#0098D4','East of England':'#9B0056','South West':'#00782A','West Midlands':'#F3A9BB',
 'East Midlands':'#B36305','North West':'#003688','North East':'#E86A10','Yorkshire and the Humber':'#95CDBA','Wales':'#A0A5A9','Scotland':'#6950A1','Northern Ireland':'#00A4A7'}
LINE_NAMES={'Greater London':'Capital line','South East':'Downs line','East of England':'Fenland line','South West':'Peninsula line','West Midlands':'Heartland line',
 'East Midlands':'Shires line','North West':'Pennine line','North East':'Tyne line','Yorkshire and the Humber':'Ridings line','Wales':'Cymru line','Scotland':'Highland line','Northern Ireland':'Lagan line'}
las=collections.OrderedDict()
for r in rows:
    k=r['la']
    if k not in las: las[k]={'id':len(las),'la':k,'name':short(k),'region':r['region'],'nation':r['nation'],'centres':[]}
    las[k]['centres'].append({h:v for h,v in r.items() if h not in('la','region','nation','ll')})
st=list(las.values())
for s in st:
    pts=[r['ll'] for r in rows if r['la']==s['la']]
    s['lat']=mean(p[0] for p in pts); s['lon']=mean(p[1] for p in pts)
# project
for s in st:
    s['x']=(s['lon']+8.3)*math.cos(math.radians(54.5)); lat=s['lat']; lat=lat if lat<55.3 else 55.3+(lat-55.3)*0.6
    s['y']=(60.9-lat)
# fisheye around London + Birmingham + Manchester
def fish(cx,cy,A,sc):
    for s in st:
        dx,dy=s['x']-cx,s['y']-cy; r=math.hypot(dx,dy)
        if r==0: continue
        f=1+A*math.exp(-r/sc)
        s['x']=cx+dx*f; s['y']=cy+dy*f
L=((-0.12+8.3)*math.cos(math.radians(54.5)),60.9-51.51)
fish(*L,4.0,0.25)
fish(*L,1.3,2.2)
B=((-1.9+8.3)*math.cos(math.radians(54.5)),60.9-52.48)
fish(*B,0.8,0.25)
M=((-2.24+8.3)*math.cos(math.radians(54.5)),60.9-53.48)
fish(*M,0.8,0.25)
K=26  # grid units per projected unit
for s in st: s['x']*=K; s['y']*=K; s['ox'],s['oy']=s['x'],s['y']
# relaxation
MIN=3.6
for it in range(400):
    for s in st:
        s['fx']=(s['ox']-s['x'])*0.02; s['fy']=(s['oy']-s['y'])*0.02
    for i,a in enumerate(st):
        for b in st[i+1:]:
            dx,dy=b['x']-a['x'],b['y']-a['y']; d=math.hypot(dx,dy) or 0.01
            if d<MIN:
                p=(MIN-d)/d*0.5
                a['fx']-=dx*p; a['fy']-=dy*p; b['fx']+=dx*p; b['fy']+=dy*p
    for s in st: s['x']+=s['fx']; s['y']+=s['fy']
# snap
occ=set()
for s in sorted(st,key=lambda s:-len(s['centres'])):
    gx,gy=round(s['x']/2)*2,round(s['y']/2)*2
    best=None
    for rr in range(0,12):
        for dx in range(-rr,rr+1):
            for dy in range(-rr,rr+1):
                if max(abs(dx),abs(dy))!=rr: continue
                c=(gx+dx*2,gy+dy*2)
                if c in occ: continue
                d=math.hypot(c[0]-s['x'],c[1]-s['y'])
                if best is None or d<best[0]: best=(d,c)
        if best: break
    s['gx'],s['gy']=best[1]; occ.add(best[1])
# order each line: TSP-ish nearest neighbour from extreme + 2-opt
def dist(a,b): return math.hypot(a['gx']-b['gx'],a['gy']-b['gy'])
lines={}
for g in LINES:
    S=[s for s in st if s['region']==g]
    # start at point farthest from centroid
    cx=mean(s['gx'] for s in S); cy=mean(s['gy'] for s in S)
    best=None
    for start in S:
        path=[start]; rest=[s for s in S if s is not start]
        while rest:
            n=min(rest,key=lambda s:dist(path[-1],s)); path.append(n); rest.remove(n)
        imp=True
        while imp:
            imp=False
            for i in range(1,len(path)-1):
                for j in range(i+1,len(path)):
                    a,b=path[i-1],path[i]; c=path[j]; d=path[j+1] if j+1<len(path) else None
                    old=dist(a,b)+(dist(c,d) if d else 0); new=dist(a,c)+(dist(b,d) if d else 0)
                    if new<old-1e-9: path[i:j+1]=path[i:j+1][::-1]; imp=True
        L_=sum(dist(path[i],path[i+1]) for i in range(len(path)-1))
        if best is None or L_<best[0]: best=(L_,path)
    lines[g]=[s['id'] for s in best[1]]
# interchanges: closest pair between region lines if close
inter=[]
gs=list(LINES)
for i,g in enumerate(gs):
    for h in gs[i+1:]:
        A=[st[k] for k in lines[g]]; B=[st[k] for k in lines[h]]
        d,a,b=min(((dist(a,b),a,b) for a in A for b in B),key=lambda t:t[0])
        if d<=13: inter.append([a['id'],b['id'],round(d,1)])
A=[st[k] for k in lines['Northern Ireland']]; B=[st[k] for k in lines['Scotland']]
d,a,b2=min(((dist(a,b),a,b) for a in A for b in B),key=lambda t:t[0])
inter.append([a['id'],b2['id'],-1])
minx=min(s['gx'] for s in st); miny=min(s['gy'] for s in st)
for s in st: s['gx']-=minx-6; s['gy']-=miny-6
out={'stations':[{k:s[k] for k in('id','la','name','region','nation','gx','gy','centres')} for s in st],
     'lines':[{'region':g,'name':LINE_NAMES[g],'color':LINES[g],'stops':lines[g]} for g in LINES],'interchanges':inter}
json.dump(out,open('map.json','w'),default=str,ensure_ascii=False)
print(len(st),max(s['gx'] for s in st),max(s['gy'] for s in st),len(inter))
