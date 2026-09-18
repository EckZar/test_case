import * as THREE from 'three';

const CONNECTOR_PX = 128;
const PROFILE = Object.freeze({
  heightScale:.016, neutralLevel:.58, raiseScale:.32, sinkScale:1.35,
  wallSoftnessPx:.75, minSteps:12, maxSteps:96, refinementSteps:6,
  maxUvOffset:.22, grazingFadeStart:.08, grazingFadeEnd:.22,
  jitterStrength:0, stableGradients:true,
});

const DEFINITIONS = [
  { id:'cross_hub_a', label:'Cross Hub A', category:'junction', hub:'cross', paths:[[[0,0],[0,3]],[[0,0],[0,-3]],[[0,0],[3,0]],[[0,0],[-3,0]]], ports:[['N',0,3,90],['S',0,-3,-90],['E',3,0,0],['W',-3,0,180]] },
  { id:'straight_offset_a', label:'Straight Offset A', category:'straight', paths:[[[0,3],[0,1.65],[-.34,1.25],[-.34,.15],[0,-.25],[0,-3]]], ports:[['N',0,3,90],['S',0,-3,-90]] },
  { id:'straight_reinforced_a', label:'Straight Reinforced A', category:'straight', reinforced:true, paths:[[[0,3],[0,1.45],[-.18,1.05],[-.18,-1.05],[0,-1.45],[0,-3]]], ports:[['N',0,3,90],['S',0,-3,-90]] },
  { id:'straight_frame_a', label:'Straight Frame A', category:'straight', frame:true, paths:[[[0,3],[0,1.5],[.28,1.05],[.28,-1.05],[0,-1.5],[0,-3]]], ports:[['N',0,3,90],['S',0,-3,-90]] },
  { id:'straight_offset_b', label:'Straight Offset B', category:'straight', paths:[[[0,3],[0,1.35],[.30,.95],[.30,-.15],[0,-.55],[0,-3]]], ports:[['N',0,3,90],['S',0,-3,-90]] },
  { id:'y_hub_a', label:'Y Hub A', category:'junction', hub:'y', paths:[[[0,0],[-2.5,2.5]],[[0,0],[2.5,2.5]],[[0,0],[0,-3]]], ports:[['NW',-2.5,2.5,135],['NE',2.5,2.5,45],['S',0,-3,-90]] },
  { id:'t_hub_a', label:'T Hub A', category:'junction', hub:'t', paths:[[[0,0],[-3,0]],[[0,0],[3,0]],[[0,0],[0,-3]]], ports:[['W',-3,0,180],['E',3,0,0],['S',0,-3,-90]] },
  { id:'t_hub_b', label:'T Hub B', category:'junction', hub:'t2', paths:[[[0,0],[-3,0]],[[0,0],[3,0]],[[0,0],[0,-3]]], ports:[['W',-3,0,180],['E',3,0,0],['S',0,-3,-90]] },
  { id:'angled_hub_a', label:'Angled Hub A', category:'junction', hub:'angle', paths:[[[0,-3],[0,-.45],[.25,0],[2.55,2.55]]], ports:[['S',0,-3,-90],['NE',2.55,2.55,45]] },
];

function boundsFor(definition) {
  const points = definition.paths.flat();
  const xs = points.map(p=>p[0]), ys = points.map(p=>p[1]);
  const margin = definition.hub ? 1.15 : .62;
  return { minX:Math.min(...xs)-margin, maxX:Math.max(...xs)+margin, minY:Math.min(...ys)-margin, maxY:Math.max(...ys)+margin };
}
function metadataFor(definition) {
  const b=boundsFor(definition), width=Math.ceil((b.maxX-b.minX)*CONNECTOR_PX), height=Math.ceil((b.maxY-b.minY)*CONNECTOR_PX);
  const ports=definition.ports.map(([id,x,y,angle])=>({ id, x:(x-b.minX)/(b.maxX-b.minX), y:(y-b.minY)/(b.maxY-b.minY), angle }));
  return {
    schema:1, id:definition.id, label:definition.label, category:definition.category,
    authoringResolution:[width*2,height*2], runtimeResolution:[width,height],
    heightConvention:'WHITE_HIGH_BLACK_LOW', heightSource:'procedural-seam-profile-v1',
    connectorProfile:'shipmodule-seam-standard-v1', connectorWidthPx:CONNECTOR_PX,
    connectorOverlap:.12, ports, profile:{...PROFILE},
    limitations:['Procedural production preview, not a source-mesh bake.','Use connectorOverlap when snapping adjacent decals.','POM does not alter true geometry silhouette.'],
  };
}
const METADATA = DEFINITIONS.map(metadataFor);
export const SEAM_PACK_MANIFEST = Object.freeze({ schema:1, id:'shipmodule-seam-pack-v1', label:'ShipModule Seam Pack v1', connectorProfile:'shipmodule-seam-standard-v1', connectorWidthPx:CONNECTOR_PX, assets:METADATA });

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function roundedRect(ctx,x,y,w,h,r){r=Math.min(r,w/2,h/2);ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function polygon(ctx,points){ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);for(const p of points.slice(1))ctx.lineTo(p[0],p[1]);ctx.closePath();}
function hash(x,y,seed=0){let n=Math.imul(x+seed*1013,374761393)+Math.imul(y+seed*733,668265263);n=(n^(n>>>13))*1274126177;return ((n^(n>>>16))>>>0)/4294967295;}

function drawStroke(ctx,points,width,color,worldToPixel){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='miter';ctx.lineCap='butt';ctx.beginPath();const p0=worldToPixel(points[0]);ctx.moveTo(...p0);for(const p of points.slice(1))ctx.lineTo(...worldToPixel(p));ctx.stroke();}
function drawRail(base,height,points,toPx) {
  const p=CONNECTOR_PX;
  drawStroke(base,points,p*1.00,'#eee8dc',toPx); drawStroke(height,points,p*1.00,'rgb(182,182,182)',toPx);
  drawStroke(base,points,p*.91,'#f4efe6',toPx); drawStroke(height,points,p*.91,'rgb(205,205,205)',toPx);
  drawStroke(base,points,p*.72,'#171b20',toPx); drawStroke(height,points,p*.72,'rgb(62,62,62)',toPx);
  drawStroke(base,points,p*.55,'#272b31',toPx); drawStroke(height,points,p*.55,'rgb(82,82,82)',toPx);
  drawStroke(base,points,p*.43,'#747a80',toPx); drawStroke(height,points,p*.43,'rgb(158,158,158)',toPx);
  drawStroke(base,points,p*.36,'#858b91',toPx); drawStroke(height,points,p*.36,'rgb(170,170,170)',toPx);
  drawStroke(base,points,p*.018,'#d8dde0',toPx); drawStroke(height,points,p*.018,'rgb(188,188,188)',toPx);
}
function drawBolt(base,height,x,y,r=16) {
  base.fillStyle='#101317';base.beginPath();base.arc(x,y,r,0,Math.PI*2);base.fill();
  base.strokeStyle='#d5d8da';base.lineWidth=Math.max(2,r*.18);base.stroke();base.fillStyle='#090b0e';base.beginPath();base.arc(x,y,r*.42,0,Math.PI*2);base.fill();
  height.fillStyle='rgb(190,190,190)';height.beginPath();height.arc(x,y,r,0,Math.PI*2);height.fill();height.fillStyle='rgb(45,45,45)';height.beginPath();height.arc(x,y,r*.48,0,Math.PI*2);height.fill();
}
function drawSlot(base,height,x,y,w,h,rotation=0){base.save();height.save();base.translate(x,y);height.translate(x,y);base.rotate(rotation);height.rotate(rotation);roundedRect(base,-w/2,-h/2,w,h,Math.min(w,h)*.45);base.fillStyle='#090c10';base.fill();base.strokeStyle='#aeb3b7';base.lineWidth=2;base.stroke();roundedRect(height,-w/2,-h/2,w,h,Math.min(w,h)*.45);height.fillStyle='rgb(35,35,35)';height.fill();base.restore();height.restore();}
function drawHub(base,height,definition,toPx) {
  if(!definition.hub)return;
  const [cx,cy]=toPx([0,0]), p=CONNECTOR_PX;
  const radius=definition.hub==='cross'?p*.92:definition.hub==='angle'?p*.72:p*.82;
  const sides=definition.hub==='t2'?6:8;
  const pts=[];for(let i=0;i<sides;i++){const a=Math.PI*2*i/sides+Math.PI/sides;pts.push([cx+Math.cos(a)*radius,cy+Math.sin(a)*radius]);}
  polygon(base,pts);base.fillStyle='#4b5056';base.fill();base.strokeStyle='#11151a';base.lineWidth=p*.13;base.stroke();
  polygon(height,pts);height.fillStyle='rgb(168,168,168)';height.fill();height.strokeStyle='rgb(52,52,52)';height.lineWidth=p*.13;height.stroke();
  base.beginPath();base.arc(cx,cy,p*.34,0,Math.PI*2);base.fillStyle='#171a1f';base.fill();base.strokeStyle='#ff7800';base.lineWidth=p*.055;base.stroke();
  height.beginPath();height.arc(cx,cy,p*.34,0,Math.PI*2);height.fillStyle='rgb(110,110,110)';height.fill();height.strokeStyle='rgb(184,184,184)';height.lineWidth=p*.055;height.stroke();
  base.beginPath();base.arc(cx,cy,p*.20,0,Math.PI*2);base.fillStyle='#30343a';base.fill();base.strokeStyle='#cbd0d3';base.lineWidth=p*.035;base.stroke();
  height.beginPath();height.arc(cx,cy,p*.20,0,Math.PI*2);height.fillStyle='rgb(174,174,174)';height.fill();height.strokeStyle='rgb(198,198,198)';height.lineWidth=p*.035;height.stroke();
  for(let i=0;i<4;i++){const a=i*Math.PI/2;const x=cx+Math.cos(a)*p*.48,y=cy+Math.sin(a)*p*.48;base.save();base.translate(x,y);base.rotate(a);base.fillStyle='#ff7800';base.fillRect(-p*.055,-p*.12,p*.11,p*.24);base.restore();height.save();height.translate(x,y);height.rotate(a);height.fillStyle='rgb(184,184,184)';height.fillRect(-p*.055,-p*.12,p*.11,p*.24);height.restore();}
  for(let i=0;i<4;i++){const a=Math.PI/4+i*Math.PI/2;drawBolt(base,height,cx+Math.cos(a)*p*.64,cy+Math.sin(a)*p*.64,p*.055);}
}
function drawReinforcement(base,height,definition,toPx) {
  if(!definition.reinforced&&!definition.frame)return;
  const p=CONNECTOR_PX,[cx,cy]=toPx([definition.frame?.16:-.10,0]);
  const w=definition.frame?p*.88:p*1.12,h=p*1.85;
  const pts=[[cx-w/2,cy-h/2+p*.2],[cx-w*.28,cy-h/2],[cx+w*.28,cy-h/2],[cx+w/2,cy-h/2+p*.2],[cx+w/2,cy+h/2-p*.2],[cx+w*.28,cy+h/2],[cx-w*.28,cy+h/2],[cx-w/2,cy+h/2-p*.2]];
  polygon(base,pts);base.fillStyle=definition.frame?'#e9e4da':'#777c81';base.fill();base.strokeStyle='#15191e';base.lineWidth=p*.07;base.stroke();
  polygon(height,pts);height.fillStyle=definition.frame?'rgb(204,204,204)':'rgb(174,174,174)';height.fill();height.strokeStyle='rgb(52,52,52)';height.lineWidth=p*.07;height.stroke();
  drawBolt(base,height,cx,cy-h*.30,p*.045);drawBolt(base,height,cx,cy+h*.30,p*.045);
}
function addDetails(base,height,definition,toPx) {
  const p=CONNECTOR_PX;
  for(const path of definition.paths){
    const length=path.slice(1).reduce((sum,q,i)=>sum+Math.hypot(q[0]-path[i][0],q[1]-path[i][1]),0);
    const count=Math.max(1,Math.floor(length/1.45));
    for(let i=1;i<=count;i++){
      const t=i/(count+1);let remaining=t*length,pos=path[0],angle=0;
      for(let j=1;j<path.length;j++){const a=path[j-1],b=path[j],seg=Math.hypot(b[0]-a[0],b[1]-a[1]);if(remaining<=seg){const u=remaining/seg;pos=[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u];angle=Math.atan2(b[1]-a[1],b[0]-a[0]);break;}remaining-=seg;}
      const [x,y]=toPx(pos);const side=i%2?1:-1;const nx=-Math.sin(angle),ny=Math.cos(angle);
      if(i%2===0)drawBolt(base,height,x+nx*p*.24*side,y-ny*p*.24*side,p*.038);
      else drawSlot(base,height,x+nx*p*.36*side,y-ny*p*.36*side,p*.10,p*.25,Math.PI/2-angle);
    }
  }
}
function applyWear(canvas) {
  const ctx=canvas.getContext('2d'), image=ctx.getImageData(0,0,canvas.width,canvas.height), d=image.data;
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(d[i+3]<20)continue;const white=d[i]>190&&d[i+1]>180&&d[i+2]>165;const n=hash(x,y,17);if(white&&n>.994){d[i]=168;d[i+1]=103;d[i+2]=52;}else if(n>.9992){const k=.82;d[i]*=k;d[i+1]*=k;d[i+2]*=k;}}
  ctx.putImageData(image,0,0);
}
function flipRows(source,width,height,channels){const out=new Uint8Array(source.length),stride=width*channels;for(let y=0;y<height;y++)out.set(source.subarray(y*stride,(y+1)*stride),(height-1-y)*stride);return out;}
function toRgba(source,channels){if(channels===4)return source;const out=new Uint8Array(source.length/channels*4);for(let i=0;i<source.length/channels;i++){out[i*4]=source[i*channels];out[i*4+1]=source[i*channels+(channels===1?0:1)];out[i*4+2]=source[i*channels+(channels===1?0:2)];out[i*4+3]=255;}return out;}
export { toRgba };
function texture(source,channels,width,height,srgb=false){const t=new THREE.DataTexture(toRgba(source,channels),width,height,THREE.RGBAFormat,THREE.UnsignedByteType);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.flipY=false;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
export function solidTexture(r,g,b){const t=new THREE.DataTexture(new Uint8Array([r,g,b,255]),1,1,THREE.RGBAFormat);t.needsUpdate=true;return t;}
function buildOrm(base,height,alpha){const out=new Uint8Array(height.length*3);for(let i=0;i<height.length;i++){const r=base[i*4],g=base[i*4+1],b=base[i*4+2],a=alpha[i],lum=.2126*r+.7152*g+.0722*b,sat=Math.max(r,g,b)-Math.min(r,g,b),orange=r>180&&g>55&&g<165&&b<80,white=lum>180&&sat<70,dark=lum<90;out[i*3]=a<16?255:clamp(220+(height[i]-128)*.18,145,255);out[i*3+1]=a<16?225:orange?125:white?205:dark?158:175;out[i*3+2]=a<16?0:orange?15:white?25:dark?145:205;}return out;}
function buildEmissive(base,alpha){const out=new Uint8Array(alpha.length*3);for(let i=0;i<alpha.length;i++){const r=base[i*4],g=base[i*4+1],b=base[i*4+2];if(alpha[i]>16&&r>180&&g>55&&g<165&&b<80)out.set([255,105,12],i*3);}return out;}

const CACHE=new Map();
export async function loadSeamPackManifest(){return SEAM_PACK_MANIFEST;}
export async function loadSeamAsset(assetId){
  if(CACHE.has(assetId))return CACHE.get(assetId);
  const promise=(async()=>{
    const definition=DEFINITIONS.find(x=>x.id===assetId), metadata=METADATA.find(x=>x.id===assetId);
    if(!definition||!metadata)throw new Error(`Unknown seam asset: ${assetId}`);
    const [width,height]=metadata.runtimeResolution,b=boundsFor(definition);
    const baseCanvas=document.createElement('canvas'),heightCanvas=document.createElement('canvas');baseCanvas.width=heightCanvas.width=width;baseCanvas.height=heightCanvas.height=height;
    const base=baseCanvas.getContext('2d'),hctx=heightCanvas.getContext('2d');base.clearRect(0,0,width,height);hctx.fillStyle=`rgb(${Math.round(PROFILE.neutralLevel*255)},${Math.round(PROFILE.neutralLevel*255)},${Math.round(PROFILE.neutralLevel*255)})`;hctx.fillRect(0,0,width,height);
    const toPx=([x,y])=>[(x-b.minX)*CONNECTOR_PX,(b.maxY-y)*CONNECTOR_PX];
    for(const path of definition.paths)drawRail(base,hctx,path,toPx);
    drawReinforcement(base,hctx,definition,toPx);drawHub(base,hctx,definition,toPx);addDetails(base,hctx,definition,toPx);applyWear(baseCanvas);
    const baseData=base.getImageData(0,0,width,height).data,heightImage=hctx.getImageData(0,0,width,height).data,count=width*height;
    const rgba=flipRows(new Uint8Array(baseData),width,height,4),heightRgba=flipRows(new Uint8Array(heightImage),width,height,4),sourceHeight=new Uint8Array(count),alpha=new Uint8Array(count);
    for(let i=0;i<count;i++){sourceHeight[i]=heightRgba[i*4];alpha[i]=rgba[i*4+3];}
    const orm=buildOrm(rgba,sourceHeight,alpha),emissive=buildEmissive(rgba,alpha),normal=new Uint8Array(count*3);for(let i=0;i<count;i++)normal.set([128,128,255],i*3);
    const textures={base:texture(rgba,4,width,height,true),normal:texture(normal,3,width,height),orm:texture(orm,3,width,height),emissive:texture(emissive,3,width,height,true),alpha:texture(alpha,1,width,height)};
    const heightData=new Uint16Array(count*4);textures.height=new THREE.DataTexture(heightData,width,height,THREE.RGBAFormat,THREE.HalfFloatType);Object.assign(textures.height,{colorSpace:THREE.NoColorSpace,flipY:false,wrapS:THREE.ClampToEdgeWrapping,wrapT:THREE.ClampToEdgeWrapping,minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:true});
    return {metadata,base:rgba,sourceHeight,alpha,textures,heightData,width,height,count};
  })();CACHE.set(assetId,promise);return promise;
}
