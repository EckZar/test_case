#!/usr/bin/env python3
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
import pillow_avif
from scipy.ndimage import gaussian_filter, distance_transform_edt, sobel, binary_fill_holes

SRC=Path(sys.argv[1]); OUT=Path(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)

def alpha_from_rgba(a):
    alpha=a[...,3].astype(np.float32)/255.0
    if float(np.ptp(alpha)) > .01 or float(alpha.mean()) < .99:
        return alpha
    rgb=a[...,:3].astype(np.float32)/255.0
    vmax=rgb.max(2); vmean=rgb.mean(2)
    cand=(vmax < .05) & (vmean < .03)
    h,w=cand.shape; seen=np.zeros((h,w),bool); stack=[]
    for x in range(w):
        if cand[0,x]: stack.append((0,x))
        if cand[-1,x]: stack.append((h-1,x))
    for y in range(h):
        if cand[y,0]: stack.append((y,0))
        if cand[y,-1]: stack.append((y,w-1))
    while stack:
        y,x=stack.pop()
        if y<0 or y>=h or x<0 or x>=w or seen[y,x] or not cand[y,x]: continue
        seen[y,x]=1
        stack.extend(((y-1,x),(y+1,x),(y,x-1),(y,x+1)))
    fg=binary_fill_holes(~seen)
    return np.clip(gaussian_filter(fg.astype(np.float32),.8)*1.3,0,1)

def make_height(rgb,alpha):
    r,g,b=[rgb[...,i] for i in range(3)]
    lum=.2126*r+.7152*g+.0722*b
    vmax=rgb.max(2); vmin=rgb.min(2); chroma=vmax-vmin
    black=vmax<.16; dark=(vmax>=.16)&(vmax<.34); mid=(vmax>=.34)&(vmax<.68)
    light=(vmax>=.68)&(chroma<.18); beige=(vmax>=.76)&(chroma<.25)
    orange=(r>g*1.25)&(r>b*1.4)&(r>.45)
    z=np.full(lum.shape,.48,np.float32)
    z[black]=.08; z[dark]=.24; z[mid]=.56; z[light]=.70; z[beige]=.86; z[orange]=.40
    local=gaussian_filter(lum,3.5); delta=local-lum
    z-=np.clip(delta,0,.5)*.55; z+=np.clip(-delta,0,.5)*.10
    coarse=gaussian_filter(z,1.0); fine=z-gaussian_filter(z,2.0); z=coarse+fine*.35
    fg=alpha>.02; dist=distance_transform_edt(fg); z*=.18+.82*np.clip(dist/10,0,1)
    vals=z[fg]
    if vals.size:
        lo,hi=np.percentile(vals,[1,99]); z=(z-lo)/max(float(hi-lo),1e-5)
    z=(.05+.90*np.clip(z,0,1))*alpha
    return np.clip(z,0,1)

def make_normal(h,alpha,strength=7.0):
    q=gaussian_filter(h,1.0); gx=sobel(q,1)/8.0; gy=sobel(q,0)/8.0
    nx=-gx; ny=-gy; nz=np.ones_like(q)/strength
    d=np.sqrt(nx*nx+ny*ny+nz*nz)+1e-8; nx/=d; ny/=d; nz/=d
    return np.dstack((nx*.5+.5,ny*.5+.5,nz*.5+.5,alpha))

def save_rgba(x,p):
    Image.fromarray(np.uint8(np.clip(x,0,1)*255),'RGBA').save(p,compress_level=2)

stage=json.load(open(SRC/'manifest.json',encoding='utf-8'))
manifest={'schema':2,'set':'reference-pom-production-hd','sourceEncoding':'full-resolution AVIF staging','assets':[]}
for item in stage['assets']:
    rid=item['id']; im=Image.open(SRC/item['file']).convert('RGBA'); a=np.asarray(im)
    alpha=alpha_from_rgba(a); base=a.astype(np.float32)/255.0; base[...,3]=alpha
    rgb=base[...,:3]; height=make_height(rgb,alpha); normal=make_normal(height,alpha)
    dst=OUT/rid; dst.mkdir(parents=True,exist_ok=True)
    save_rgba(base,dst/'basecolor.png')
    save_rgba(np.dstack((height,height,height,alpha)),dst/'height.png')
    save_rgba(normal,dst/'normal.png')
    save_rgba(np.dstack((alpha,alpha,alpha,alpha)),dst/'alpha.png')
    orm=np.dstack((np.ones_like(alpha),np.full_like(alpha,.56),np.zeros_like(alpha),alpha))
    save_rgba(orm,dst/'orm.png')
    manifest['assets'].append({'id':rid,'width':im.width,'height':im.height,'files':{
      'baseColor':f'{rid}/basecolor.png','height':f'{rid}/height.png','normal':f'{rid}/normal.png','alpha':f'{rid}/alpha.png','orm':f'{rid}/orm.png'}})
with open(OUT/'manifest.json','w',encoding='utf-8') as f: json.dump(manifest,f,indent=2)
print('generated',len(manifest['assets']),'full-resolution POM decal sets')
