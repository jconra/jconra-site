import sys, json
from PIL import Image
from collections import deque
src_path, out_png, out_json, names = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split('|')
src=Image.open(src_path).convert('RGB'); W,H=src.size; px=src.load()
BG=[sum(c)/4 for c in zip(*[px[2,2],px[W-3,2],px[2,H-3],px[W-3,H-3]])]
a=Image.new('RGBA',(W,H)); o=a.load(); solid=bytearray(W*H)
for y in range(H):
    for x in range(W):
        r,g,b=px[x,y]
        # keyed by distance from the background's own green (sampled from the corner), so green
        # plants - moss, clover, fern - stay; only the soft edge is despilled
        d=((r-BG[0])**2+(g-BG[1])**2+(b-BG[2])**2)**0.5; al=min(1,max(0,(d-40)/45))
        o[x,y]=(r,g if al>0.99 else min(g,int(max(r,b)*1.05)),b,int(al*255))
        if al>0.15: solid[y*W+x]=1
# the edge band: a pixel within 3 of the background keeps only as much green as it has red or blue
# beyond a quarter (the green in the gaps of a grass tuft is the background's, mixed in), and the
# outermost ring is trimmed a little
from PIL import ImageFilter
A0=a.getchannel('A'); near=A0.filter(ImageFilter.MinFilter(7)).load(); ring=A0.filter(ImageFilter.MinFilter(3)).load()
for y in range(H):
    for x in range(W):
        if near[x,y] < 250:
            r,g,b,al=o[x,y]
            if g > max(r,b)*1.25: o[x,y]=(r,int(max(r,b)*1.25),b,al)
            if ring[x,y] < 250: o[x,y]=o[x,y][:3]+(int(o[x,y][3]*0.6),)
        r,g,b,al=o[x,y]
        if g > 195 and g > 2 * max(r, b): o[x,y]=(r,int(max(r,b)*1.3),b,int(al*0.35))   # neon: background green that got through, anywhere
# connected pieces (8-neighbour), each given to the grid square its centre is in
lab=[-1]*(W*H); pieces=[]
for s in range(W*H):
    if not solid[s] or lab[s]>=0: continue
    q=deque([s]); lab[s]=len(pieces); pts=[]
    while q:
        p=q.popleft(); pts.append(p); x,y=p%W,p//W
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                nx,ny=x+dx,y+dy
                if 0<=nx<W and 0<=ny<H:
                    n=ny*W+nx
                    if solid[n] and lab[n]<0: lab[n]=len(pieces); q.append(n)
    cx=sum(p%W for p in pts)/len(pts); cy=sum(p//W for p in pts)/len(pts)
    pieces.append((int(cy*4//H)*4+int(cx*4//W), pts))
out=Image.new('RGBA',(1024,1024),(0,0,0,0)); info=[]
for i in range(16):
    mine=[p for cell,pts in pieces if cell==i and len(pts)>30 for p in pts]
    if not mine: info.append({'name':names[i],'cell':i,'w':0,'h':0}); continue
    xs=[p%W for p in mine]; ys=[p//W for p in mine]; x0,x1,y0,y1=min(xs),max(xs)+1,min(ys),max(ys)+1
    keep=set(mine); sp=Image.new('RGBA',(x1-x0,y1-y0),(0,0,0,0)); sl=sp.load()
    # the object's own pixels, plus their soft edge (a pixel of fringe round each)
    for p in mine:
        x,y=p%W,p//W
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                nx,ny=x+dx,y+dy
                if x0<=nx<x1 and y0<=ny<y1 and lab[ny*W+nx]<0: sl[nx-x0,ny-y0]=o[nx,ny]
        sl[x-x0,y-y0]=o[x,y]
    w,h=sp.size; k=min(236/w,236/h,1.0); sp=sp.resize((max(1,round(w*k)),max(1,round(h*k))),Image.LANCZOS)
    gy,gx=divmod(i,4); out.alpha_composite(sp,(gx*256+(256-sp.size[0])//2, gy*256+(256-sp.size[1])//2))
    info.append({'name':names[i],'cell':i,'w':round(sp.size[0]/256,3),'h':round(sp.size[1]/256,3)})
out.save(out_png,optimize=True); json.dump({'grid':4,'sprites':info},open(out_json,'w'),indent=1)
bg=Image.new('RGBA',out.size,(74,58,40,255)); bg.alpha_composite(out); bg.convert('RGB').resize((512,512)).save(out_png.split('/')[-1].replace('.png','_preview.jpg'),quality=85)
print(out_png, [s['name'] for s in info if not s['w']] or 'all 16 found')
