import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createPbrDecalMaterial,
  enablePomDecalMaterial,
  updatePomDecalMaterial,
} from './PomDecalMaterial.js';
import { P07_HATCH_FIXTURE } from './p07-fixture-data.js';

const canvas = document.querySelector('#canvas');
const view = document.querySelector('#view');
const status = document.querySelector('#status');
const ui = {
  height: document.querySelector('#height'), minSteps: document.querySelector('#minSteps'),
  maxSteps: document.querySelector('#maxSteps'), refine: document.querySelector('#refine'),
  az: document.querySelector('#az'), el: document.querySelector('#el'), rotate: document.querySelector('#rotate'),
  front: document.querySelector('#front'), grazing: document.querySelector('#grazing'), reset: document.querySelector('#reset'),
};
const out = {
  height: document.querySelector('#heightOut'), minSteps: document.querySelector('#minOut'),
  maxSteps: document.querySelector('#maxOut'), refine: document.querySelector('#refineOut'),
  az: document.querySelector('#azOut'), el: document.querySelector('#elOut'),
};
const stats = { fps: document.querySelector('#fps'), calls: document.querySelector('#calls'), triangles: document.querySelector('#triangles') };
const n = (e) => Number(e.value);
const setStatus = (m, err=false) => { status.textContent=m; status.classList.toggle('error',err); };
function updateLabels(){ out.height.textContent=n(ui.height).toFixed(3); out.minSteps.textContent=String(Math.round(n(ui.minSteps))); out.maxSteps.textContent=String(Math.round(n(ui.maxSteps))); out.refine.textContent=String(Math.round(n(ui.refine))); out.az.textContent=`${Math.round(n(ui.az))}°`; out.el.textContent=`${Math.round(n(ui.el))}°`; }
function dataTexture(bytes,size,colorSpace=THREE.NoColorSpace){ const t=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat); t.colorSpace=colorSpace; t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping; t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter; t.generateMipmaps=true; t.needsUpdate=true; return t; }
function solidTexture(r,g,b,a=255){ const t=new THREE.DataTexture(new Uint8Array([r,g,b,a]),1,1,THREE.RGBAFormat); t.needsUpdate=true; t.colorSpace=THREE.NoColorSpace; return t; }
function loadImage(src){ return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=()=>reject(new Error(`Unable to load same-origin Height fixture: ${src}`)); img.src=src; }); }
async function makeFixture(){
  const img=await loadImage(P07_HATCH_FIXTURE.height);
  const size=Math.min(img.naturalWidth||img.width,512);
  const c=document.createElement('canvas'); c.width=c.height=size;
  const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(img,0,0,size,size);
  const im=ctx.getImageData(0,0,size,size); const src=im.data;
  const heightRGBA=new Uint8Array(size*size*4), normalRGBA=new Uint8Array(size*size*4), baseRGBA=new Uint8Array(size*size*4);
  const h8=new Uint8Array(size*size);
  for(let i=0;i<h8.length;i++){ const v=src[i*4]; h8[i]=v; const o=i*4; heightRGBA[o]=heightRGBA[o+1]=heightRGBA[o+2]=v; heightRGBA[o+3]=255; const metal=Math.round(35+v*0.70); baseRGBA[o]=Math.min(230,metal); baseRGBA[o+1]=Math.min(230,metal); baseRGBA[o+2]=Math.min(235,metal+4); baseRGBA[o+3]=255; }
  const sample=(x,y)=>{ x=Math.max(0,Math.min(size-1,x)); y=Math.max(0,Math.min(size-1,y)); return h8[y*size+x]/255; };
  const strength=size*0.035;
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){ let nx=-(sample(x+1,y)-sample(x-1,y))*strength; let ny=-(sample(x,y+1)-sample(x,y-1))*strength; const len=Math.hypot(nx,ny,1)||1; nx/=len; ny/=len; const nz=1/len; const o=(y*size+x)*4; normalRGBA[o]=Math.round((nx*.5+.5)*255); normalRGBA[o+1]=Math.round((ny*.5+.5)*255); normalRGBA[o+2]=Math.round((nz*.5+.5)*255); normalRGBA[o+3]=255; }
  return { size, baseColor:dataTexture(baseRGBA,size,THREE.SRGBColorSpace), heightMap:dataTexture(heightRGBA,size), normalMap:dataTexture(normalRGBA,size), orm:solidTexture(255,190,32,255), emissive:solidTexture(0,0,0,255) };
}

const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'}); renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1;
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x090d12); const camera=new THREE.PerspectiveCamera(42,1,.05,100); camera.position.set(0,.15,6.5);
const controls=new OrbitControls(camera,canvas); controls.enableDamping=true; controls.dampingFactor=.06; controls.target.set(0,0,0); controls.minDistance=2.4; controls.maxDistance=11;
scene.add(new THREE.HemisphereLight(0xb7d0ee,0x11151c,1.05)); const keyLight=new THREE.DirectionalLight(0xffffff,3.8); scene.add(keyLight,keyLight.target);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,7),new THREE.MeshStandardMaterial({color:0x101720,roughness:.96,metalness:.02})); floor.rotation.x=-Math.PI/2; floor.position.set(0,-1.8,-.65); scene.add(floor);
const dividerGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,-1.42,.13),new THREE.Vector3(0,1.42,.13)]); scene.add(new THREE.Line(dividerGeometry,new THREE.LineBasicMaterial({color:0x38516c,transparent:true,opacity:.6})));
let fixture,flatMaterial,pomMaterial,flatMesh,pomMesh;
function panelGeometry(){ const g=new THREE.PlaneGeometry(2.7,2.7); g.setAttribute('uv1',g.getAttribute('uv').clone()); return g; }
function createMaterial(pom=false){ const m=createPbrDecalMaterial({tint:0xffffff},{baseColor:fixture.baseColor,normal:fixture.normalMap,orm:fixture.orm,emissive:fixture.emissive}); m.transparent=false; m.alphaTest=0; m.opacity=1; m.blending=THREE.NoBlending; m.side=THREE.DoubleSide; m.depthTest=m.depthWrite=true; m.polygonOffset=false; m.roughness=.74; m.metalness=.08; if(pom) enablePomDecalMaterial(m,{heightMap:fixture.heightMap,heightScale:n(ui.height),minSteps:n(ui.minSteps),maxSteps:n(ui.maxSteps),refinementSteps:n(ui.refine),grazingFadeStart:.06,grazingFadeEnd:.22,maxUvOffset:.35}); return m; }
function updatePom(){ if(!pomMaterial)return; updatePomDecalMaterial(pomMaterial,{heightScale:n(ui.height),minSteps:Math.min(n(ui.minSteps),n(ui.maxSteps)),maxSteps:Math.max(n(ui.minSteps),n(ui.maxSteps)),refinementSteps:n(ui.refine)}); }
function updateLight(){ const az=THREE.MathUtils.degToRad(n(ui.az)),el=THREE.MathUtils.degToRad(n(ui.el)),r=5; keyLight.position.set(Math.cos(el)*Math.sin(az)*r,Math.sin(el)*r,Math.cos(el)*Math.cos(az)*r); keyLight.target.position.set(0,0,0); }
function setCamera(x,y,z){ camera.position.set(x,y,z); controls.target.set(0,0,0); controls.update(); }
function reset(){ ui.height.value=String(P07_HATCH_FIXTURE.defaultHeightScale); ui.minSteps.value='8'; ui.maxSteps.value='48'; ui.refine.value='4'; ui.az.value='35'; ui.el.value='55'; updateLabels(); updatePom(); updateLight(); setCamera(0,.15,6.5); }
function resize(){ const w=Math.max(1,view.clientWidth),h=Math.max(1,view.clientHeight); renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); } window.addEventListener('resize',resize); resize();
[ui.height,ui.minSteps,ui.maxSteps,ui.refine].forEach(e=>e.addEventListener('input',()=>{updateLabels();updatePom();})); [ui.az,ui.el].forEach(e=>e.addEventListener('input',()=>{updateLabels();updateLight();})); ui.front.addEventListener('click',()=>setCamera(0,.15,6.5)); ui.grazing.addEventListener('click',()=>setCamera(5.7,.15,1.55)); ui.reset.addEventListener('click',reset); updateLabels(); updateLight();
(async()=>{ try{ setStatus('Loading same-origin P-07 Height and building neutral BaseColor + Normal…'); fixture=await makeFixture(); flatMaterial=createMaterial(false); pomMaterial=createMaterial(true); flatMesh=new THREE.Mesh(panelGeometry(),flatMaterial); pomMesh=new THREE.Mesh(panelGeometry(),pomMaterial); flatMesh.position.x=-1.55; pomMesh.position.x=1.55; scene.add(flatMesh,pomMesh); setStatus(`Ready. Height-only authored fixture ${fixture.size}²; BaseColor/Normal are derived locally from the same height field.`);}catch(error){ console.error(error); setStatus(`Error: ${error?.message||String(error)}`,true);} })();
let frames=0,start=performance.now(); function animate(now){ requestAnimationFrame(animate); controls.autoRotate=ui.rotate.checked; controls.autoRotateSpeed=.7; controls.update(); renderer.render(scene,camera); frames++; const dt=now-start; if(dt>=500){ stats.fps.textContent=String(Math.round(frames*1000/dt)); stats.calls.textContent=String(renderer.info.render.calls); stats.triangles.textContent=String(renderer.info.render.triangles); frames=0; start=now; }} requestAnimationFrame(animate);
