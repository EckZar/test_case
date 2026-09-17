import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPbrDecalMaterial, enablePomDecalMaterial, updatePomDecalMaterial } from './PomDecalMaterial.js';
import { P07_HATCH_FIXTURE } from './p07-fixture-data.js';

const canvas=document.querySelector('#canvas'), view=document.querySelector('#view'), status=document.querySelector('#status');
const ui={height:document.querySelector('#height'),minSteps:document.querySelector('#minSteps'),maxSteps:document.querySelector('#maxSteps'),refine:document.querySelector('#refine'),az:document.querySelector('#az'),el:document.querySelector('#el'),rotate:document.querySelector('#rotate'),front:document.querySelector('#front'),grazing:document.querySelector('#grazing'),reset:document.querySelector('#reset')};
const out={height:document.querySelector('#heightOut'),minSteps:document.querySelector('#minOut'),maxSteps:document.querySelector('#maxOut'),refine:document.querySelector('#refineOut'),az:document.querySelector('#azOut'),el:document.querySelector('#elOut')};
const stats={fixture:document.querySelector('#fixture'),resolution:document.querySelector('#resolution'),heightConvention:document.querySelector('#heightConvention'),fps:document.querySelector('#fps'),calls:document.querySelector('#calls'),triangles:document.querySelector('#triangles')};
const n=e=>Number(e.value); const setStatus=(m,e=false)=>{status.textContent=m;status.classList.toggle('error',e)};
function labels(){out.height.textContent=n(ui.height).toFixed(3);out.minSteps.textContent=Math.round(n(ui.minSteps));out.maxSteps.textContent=Math.round(n(ui.maxSteps));out.refine.textContent=Math.round(n(ui.refine));out.az.textContent=`${Math.round(n(ui.az))}°`;out.el.textContent=`${Math.round(n(ui.el))}°`;}
function flattenChunks(chunks){const total=chunks.reduce((s,c)=>s+c.length,0),a=new Uint8Array(total);let o=0;for(const c of chunks){a.set(c,o);o+=c.length}return a;}
function isOutside(mask,i){return ((mask[i>>>3] >>> (i&7)) & 1)!==0;}
function dataTexture(bytes,size,cs=THREE.NoColorSpace){const t=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat,THREE.UnsignedByteType);t.colorSpace=cs;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
function solid(r,g,b,a=255){const t=new THREE.DataTexture(new Uint8Array([r,g,b,a]),1,1,THREE.RGBAFormat);t.needsUpdate=true;t.colorSpace=THREE.NoColorSpace;return t;}
function buildFixture(){
 const size=P07_HATCH_FIXTURE.resolution, count=size*size;
 const h=flattenChunks(P07_HATCH_FIXTURE.heightChunks), mask=flattenChunks(P07_HATCH_FIXTURE.outsideMaskChunks);
 if(h.length!==count) throw new Error(`P-07 height length ${h.length}, expected ${count}.`);
 if(mask.length!==Math.ceil(count/8)) throw new Error(`P-07 mask length ${mask.length}, expected ${Math.ceil(count/8)}.`);
 const base=new Uint8Array(count*4), hr=new Uint8Array(count*4), nr=new Uint8Array(count*4);
 for(let i=0;i<count;i++){const v=h[i],o=i*4;hr[o]=hr[o+1]=hr[o+2]=v;hr[o+3]=255;if(isOutside(mask,i)){base[o]=9;base[o+1]=13;base[o+2]=18}else{const c=Math.max(48,Math.min(230,Math.round(48+v*.72)));base[o]=c;base[o+1]=c;base[o+2]=Math.min(238,c+5)}base[o+3]=255;}
 const sample=(x,y)=>h[Math.max(0,Math.min(size-1,y))*size+Math.max(0,Math.min(size-1,x))]/255, strength=size*.045;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let nx=-(sample(x+1,y)-sample(x-1,y))*strength,ny=-(sample(x,y+1)-sample(x,y-1))*strength;const l=Math.hypot(nx,ny,1)||1;nx/=l;ny/=l;const nz=1/l,o=(y*size+x)*4;nr[o]=Math.round((nx*.5+.5)*255);nr[o+1]=Math.round((ny*.5+.5)*255);nr[o+2]=Math.round((nz*.5+.5)*255);nr[o+3]=255;}
 return {size,baseColor:dataTexture(base,size,THREE.SRGBColorSpace),heightMap:dataTexture(hr,size),normalMap:dataTexture(nr,size),orm:solid(255,190,16),emissive:solid(0,0,0)};
}
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x090d12);const camera=new THREE.PerspectiveCamera(42,1,.05,100);camera.position.set(0,.15,6.5);const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.target.set(0,0,0);controls.minDistance=2.4;controls.maxDistance=11;
scene.add(new THREE.HemisphereLight(0xb7d0ee,0x11151c,1.05));const key=new THREE.DirectionalLight(0xffffff,3.8);scene.add(key,key.target);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,7),new THREE.MeshStandardMaterial({color:0x101720,roughness:.96,metalness:.02}));floor.rotation.x=-Math.PI/2;floor.position.set(0,-1.8,-.65);scene.add(floor);
const dg=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-1.42,.13),new THREE.Vector3(0,1.42,.13)]);scene.add(new THREE.Line(dg,new THREE.LineBasicMaterial({color:0x38516c,transparent:true,opacity:.6})));
let fixture,flatMaterial,pomMaterial;
function geom(){const g=new THREE.PlaneGeometry(2.7,2.7);g.setAttribute('uv1',g.getAttribute('uv').clone());return g;}
function material(pom=false){const m=createPbrDecalMaterial({tint:0xffffff},{baseColor:fixture.baseColor,normal:fixture.normalMap,orm:fixture.orm,emissive:fixture.emissive});m.transparent=false;m.alphaTest=0;m.opacity=1;m.blending=THREE.NoBlending;m.side=THREE.DoubleSide;m.depthTest=m.depthWrite=true;m.polygonOffset=false;m.roughness=.74;m.metalness=.06;if(pom)enablePomDecalMaterial(m,{heightMap:fixture.heightMap,heightScale:n(ui.height),minSteps:n(ui.minSteps),maxSteps:n(ui.maxSteps),refinementSteps:n(ui.refine),grazingFadeStart:.06,grazingFadeEnd:.22,maxUvOffset:.35});return m;}
function updatePom(){if(!pomMaterial)return;updatePomDecalMaterial(pomMaterial,{heightScale:n(ui.height),minSteps:Math.min(n(ui.minSteps),n(ui.maxSteps)),maxSteps:Math.max(n(ui.minSteps),n(ui.maxSteps)),refinementSteps:n(ui.refine)});}
function light(){const a=THREE.MathUtils.degToRad(n(ui.az)),e=THREE.MathUtils.degToRad(n(ui.el)),r=5;key.position.set(Math.cos(e)*Math.sin(a)*r,Math.sin(e)*r,Math.cos(e)*Math.cos(a)*r);key.target.position.set(0,0,0)}
function cam(x,y,z){camera.position.set(x,y,z);controls.target.set(0,0,0);controls.update()}
function reset(){ui.height.value=String(P07_HATCH_FIXTURE.defaultHeightScale);ui.minSteps.value='8';ui.maxSteps.value='48';ui.refine.value='4';ui.az.value='35';ui.el.value='55';labels();updatePom();light();cam(0,.15,6.5)}
function resize(){const w=Math.max(1,view.clientWidth),h=Math.max(1,view.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
[ui.height,ui.minSteps,ui.maxSteps,ui.refine].forEach(e=>e.addEventListener('input',()=>{labels();updatePom()}));[ui.az,ui.el].forEach(e=>e.addEventListener('input',()=>{labels();light()}));ui.front.onclick=()=>cam(0,.15,6.5);ui.grazing.onclick=()=>cam(5.7,.15,1.55);ui.reset.onclick=reset;labels();light();
try{setStatus('Building P-07 from numeric byte chunks…');fixture=buildFixture();flatMaterial=material(false);pomMaterial=material(true);const a=new THREE.Mesh(geom(),flatMaterial),b=new THREE.Mesh(geom(),pomMaterial);a.position.x=-1.55;b.position.x=1.55;scene.add(a,b);if(stats.fixture)stats.fixture.textContent=P07_HATCH_FIXTURE.label;if(stats.resolution)stats.resolution.textContent=`${fixture.size}² numeric bytes`;if(stats.heightConvention)stats.heightConvention.textContent=P07_HATCH_FIXTURE.heightConvention.replaceAll('_',' ');setStatus('Ready. Numeric DataTexture path: no images, Canvas2D, CORS, atob, or base64.');}catch(err){console.error(err);setStatus(`Error: ${err?.message||String(err)}`,true)}
let frames=0,start=performance.now();function animate(now){requestAnimationFrame(animate);controls.autoRotate=ui.rotate.checked;controls.autoRotateSpeed=.7;controls.update();renderer.render(scene,camera);frames++;const dt=now-start;if(dt>=500){stats.fps.textContent=Math.round(frames*1000/dt);stats.calls.textContent=renderer.info.render.calls;stats.triangles.textContent=renderer.info.render.triangles;frames=0;start=now}}requestAnimationFrame(animate);
