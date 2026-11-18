import sys, math
from PIL import Image, ImageDraw
out = sys.argv[1]
def hexrgb(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def light(name, size_dp, color, stops, scale):
    n = size_dp*scale; r,g,b = hexrgb(color)
    img = Image.new('RGBA',(n,n),(0,0,0,0)); px = img.load(); c=n/2
    pts=[(0,stops[0]),(0.45,stops[1]),(0.72,0.0),(1.0,0.0)]
    for y in range(n):
        for x in range(n):
            d=math.hypot(x+0.5-c,y+0.5-c)/c
            for (o0,a0),(o1,a1) in zip(pts,pts[1:]):
                if d<=o1:
                    t=(d-o0)/(o1-o0) if o1>o0 else 0; a=a0+(a1-a0)*t; break
            else: a=0
            px[x,y]=(r,g,b,round(a*255))
    img.save(f"{out}/{name}{'' if scale==1 else f'@{scale}x'}.png", optimize=True)
def tile(name, rgba, scale, spacing=26, radius=1.25, ss=8):
    n=spacing*scale; big=Image.new('RGBA',(n*ss,n*ss),(0,0,0,0)); dr=ImageDraw.Draw(big)
    c=n*ss/2; R=radius*scale*ss
    dr.ellipse([c-R,c-R,c+R,c+R],fill=rgba)
    big.resize((n,n),Image.LANCZOS).save(f"{out}/{name}{'' if scale==1 else f'@{scale}x'}.png", optimize=True)
for s in (1,2,3):
    tile('dots-light',(10,10,10,round(0.16*255)),s)
    tile('dots-dark',(255,255,255,round(0.11*255)),s)
for s in (1,2):
    light('glow-light',560,'#059669',(0.26,0.09),s)
    light('glow-dark',560,'#34D399',(0.26,0.09),s)
    light('echo-light',440,'#047857',(0.13,0.0),s)
    light('echo-dark',440,'#10B981',(0.13,0.0),s)
