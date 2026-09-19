import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createPbrDecalMaterial, enablePomDecalMaterial, updatePomDecalMaterial } from './PomDecalMaterial.js';
import { getPomReliefBounds } from './PomReliefProfile.js';

const $ = id => document.getElementById(id);
const ASSETS = Array.from({length:10},(_,i)=>({id:`ref-${String(i+1).padStart(2,'0')}`,url:`./reference-pom-assets/ref-${String(i+1).padStart(2,'0')}.webp`}));
const state = window.__REFERENCE_POM_LAB__ = {ready:false,errors:[],selected:null,renderCount:0,version:'gpu-direct-v2',canvasReads:0};

for(const a of ASSETS){const o=document.createElement('option');o.value=a.id;o.textContent=a.id.toUpperCase();$('decal').appendChild(o);}
const status=$('status');
function fail(error){const text=error instanceof Error?error.message:String(error);state.errors.push(text);state.ready=false;status.dataset.state='error';status.textContent='Ошибка: '+text;console.error(error);}
window.addEventListener('error',e=>fail(e.error||e.message));
window.addEventListener('unhandledrejection',e=>fail(e.reason));

const defaults={heightScale:.028,neutralLevel:.56,raiseScale:.55,sinkScale:1.35,minSteps:12,maxSteps:96,refinementSteps:6,maxUvOffset:.28,grazingFadeStart:.08,grazingFadeEnd:.22,jitterStrength:0,stableGradients:true};
const ids={heightScale:'height',neutralLevel:'neutralLevel',raiseScale:'raiseScale',sinkScale:'sinkScale',minSteps:'minSteps',maxSteps:'maxSteps',refinementSteps:'refine',maxUvOffset:'maxUvOffset',grazingFadeStart:'grazingFadeStart',grazingFadeEnd:'grazingFadeEnd',jitterStrength:'jitterStrength'};
const outs={heightScale:'heightOut',neutralLevel:'neutralLevelOut',raiseScale:'raiseScaleOut',sinkScale:'sinkScaleOut',minSteps:'minOut',maxSteps:'maxOut',refinementSteps:'refineOut',maxUvOffset:'maxUvOffsetOut',grazingFadeStart:'grazingFadeStartOut',grazingFadeEnd:'grazingFadeEndOut',jitterStrength:'jitterStrengthOut'};
function readParams(){const p=Object.fromEntries(Object.entries(ids).map(([k,id])=>[k,Number($(id).value)]));p.stableGradients=$('stableGradients').checked;p.minSteps=Math.min(p.minSteps,p.maxSteps);p.grazingFadeEnd=Math.max(p.grazingFadeEnd,p.grazingFadeStart+.001);return p;}
function assignParams(p){for(const[k,v]of Object.entries(p)){if(ids[k])$(ids[k]).value=String(v);} $('stableGradients').checked=p.stableGradients!==false;}
function updateOutputs(p){for(const[k,id]of Object.entries(outs)){const n=p[k];$(id).textContent=['minSteps','maxSteps','refinementSteps'].includes(k)?String(Math.round(n)):k==='heightScale'?n.toFixed(3):n.toFixed(2);}}

function solid(r,g,b,a=255,colorSpace=THREE.NoColorSpace){const t=new THREE.DataTexture(new Uint8Array([r,g,b,a]),1,1,THREE.RGBAFormat);t.colorSpace=colorSpace;t.needsUpdate=true;return t;}
const flatNormal=solid(128,128,255), orm=solid(255,210,20), black=solid(0,0,0);
const loader=new THREE.TextureLoader();loader.setCrossOrigin('anonymous');
function tuneTexture(t,colorSpace){t.colorSpace=colorSpace;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
async function loadPair(url){
  const absolute=new URL(url,location.href);absolute.searchParams.set('gpu','2');
  const [base,height]=await Promise.all([loader.loadAsync(absolute.href),loader.loadAsync(absolute.href)]);
  tuneTexture(base,THREE.SRGBColorSpace);tuneTexture(height,THREE.NoColorSpace);
  return {base,height};
}

const renderer=new THREE.WebGLRenderer({canvas:$('canvas'),antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x131923);scene.add(new THREE.HemisphereLight(0xffffff,0x728091,1.15));
const key=new THREE.DirectionalLight(0xffffff,2.7);scene.add(key,key.target);
const camera=new THREE.PerspectiveCamera(42,1,.05,100),controls=new OrbitControls(camera,$('canvas'));controls.enableDamping=true;controls.minDistance=2.1;controls.maxDistance=15;
const geometry=new THREE.PlaneGeometry(2.8,2.8);geometry.setAttribute('uv1',geometry.getAttribute('uv').clone());
const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x333333}));scene.add(mesh);

let width=1,screenHeight=1,current=null,flat=null,pom=null,heightDebug=null,normalDebug=null,alphaDebug=null,pending=0,loadingToken=0;
function disposeMaterial(m){if(m?.dispose)m.dispose();}
function makeDebug(kind,base,height){
  const frag=kind==='height'
    ? `uniform sampler2D tex;uniform sampler2D alphaTex;uniform float cutout;varying vec2 vUv;void main(){vec4 b=texture2D(alphaTex,vUv);if(cutout>.5&&b.a<.05)discard;float h=texture2D(tex,vUv).r;gl_FragColor=vec4(vec3(h),cutout>.5?b.a:1.0);}`
    : kind==='alpha'
    ? `uniform sampler2D alphaTex;varying vec2 vUv;void main(){float a=texture2D(alphaTex,vUv).a;gl_FragColor=vec4(vec3(a),1.0);}`
    : `uniform sampler2D alphaTex;uniform float cutout;varying vec2 vUv;void main(){vec4 b=texture2D(alphaTex,vUv);if(cutout>.5&&b.a<.05)discard;gl_FragColor=vec4(.5,.5,1.0,cutout>.5?b.a:1.0);}`;
  const uniforms={alphaTex:{value:base},cutout:{value:1},tex:{value:height}};
  return new THREE.ShaderMaterial({uniforms,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:frag,transparent:true,depthWrite:false,side:THREE.DoubleSide});
}
function makePbr(isPom){
  const m=createPbrDecalMaterial({tint:0xffffff},{baseColor:current.base,normal:flatNormal,orm,emissive:black});
  m.side=THREE.DoubleSide;
  if(isPom)enablePomDecalMaterial(m,{heightMap:current.height,...defaults});
  return m;
}
function rebuildMaterials(){
  for(const m of[flat,pom,heightDebug,normalDebug,alphaDebug])disposeMaterial(m);
  flat=makePbr(false);pom=makePbr(true);heightDebug=makeDebug('height',current.base,current.height);normalDebug=makeDebug('normal',current.base,current.height);alphaDebug=makeDebug('alpha',current.base,current.height);
  parameters();displayMode();
}
async function selectAsset(id){
  const token=++loadingToken;state.ready=false;status.dataset.state='';status.textContent='GPU-загрузка '+id.toUpperCase()+'…';
  const asset=ASSETS.find(a=>a.id===id);const pair=await loadPair(asset.url);if(token!==loadingToken){pair.base.dispose();pair.height.dispose();return;}
  if(current){current.base.dispose();current.height.dispose();}
  current={asset,...pair};state.selected=id;$('selected').textContent=id.toUpperCase();rebuildMaterials();
  status.dataset.state='ready';status.textContent=`Готово · ${id.toUpperCase()} · GPU-direct · canvas readback: 0\nBaseColor и Height загружаются напрямую в WebGL; getImageData()/canvas reconstruction отключены.`;
  state.ready=true;render();
}
function parameters(){if(!current||!pom)return;const p=readParams();updatePomDecalMaterial(pom,p);updateOutputs(p);state.parameters=p;state.bounds=getPomReliefBounds(p);$('shader').textContent='POM v4 GPU';$('range').textContent=`+${(state.bounds.top*p.heightScale).toFixed(4)} / ${(state.bounds.bottom*p.heightScale).toFixed(4)}`;}
function scheduleParameters(){cancelAnimationFrame(pending);pending=requestAnimationFrame(()=>{parameters();render();});}
function applyCutout(m,cut){if(!m)return;if(m.isShaderMaterial){if(m.uniforms.cutout)m.uniforms.cutout.value=cut?1:0;return;}m.transparent=cut;m.alphaTest=cut ? 0.035 : 0;m.depthWrite=!cut;m.needsUpdate=true;}
function displayMode(){
  if(!current||!flat||!pom)return;const mode=$('mode').value,cut=$('cutout').checked;for(const m of[flat,pom,heightDebug,normalDebug])applyCutout(m,cut);
  let left=flat,right=pom;
  if(mode==='clay'){left=flat;right=pom;flat.color.set(0xb9bec5);pom.color.set(0xb9bec5);}else{flat.color.set(0xffffff);pom.color.set(0xffffff);}
  if(mode==='height')left=right=heightDebug;else if(mode==='normal')left=right=normalDebug;else if(mode==='alpha')left=right=alphaDebug;
  state.left=left;state.right=right;render();
}
function resize(){const b=$('view').getBoundingClientRect();width=Math.max(2,Math.floor(b.width));screenHeight=Math.max(1,Math.floor(b.height));renderer.setSize(width,screenHeight,false);camera.aspect=Math.floor(width/2)/screenHeight;camera.updateProjectionMatrix();}
function cameraPreset(kind){const dist=Math.max(4.4,1.65/(Math.tan(THREE.MathUtils.degToRad(21))*camera.aspect));const dir=kind==='grazing'?new THREE.Vector3(.96,.06,.28):kind==='oblique'?new THREE.Vector3(.55,.17,1):new THREE.Vector3(0,0,1);camera.position.copy(dir.normalize().multiplyScalar(dist));controls.target.set(0,0,0);controls.update();}
function light(){const a=THREE.MathUtils.degToRad(Number($('az').value)),e=THREE.MathUtils.degToRad(Number($('el').value));key.position.set(Math.cos(e)*Math.sin(a)*5,Math.sin(e)*5,Math.cos(e)*Math.cos(a)*5);$('azOut').textContent=$('az').value+'°';$('elOut').textContent=$('el').value+'°';}
function render(){if(!state.left||!state.right)return;renderer.setScissorTest(true);const s=Math.floor(width/2);mesh.material=state.left;renderer.setViewport(0,0,s,screenHeight);renderer.setScissor(0,0,s,screenHeight);renderer.render(scene,camera);mesh.material=state.right;renderer.setViewport(s,0,width-s,screenHeight);renderer.setScissor(s,0,width-s,screenHeight);renderer.render(scene,camera);renderer.setScissorTest(false);state.renderCount++;}
assignParams(defaults);new ResizeObserver(()=>{resize();render();}).observe($('view'));resize();cameraPreset('front');light();
for(const id of Object.values(ids))$(id).addEventListener('input',scheduleParameters);$('stableGradients').onchange=scheduleParameters;$('mode').onchange=displayMode;$('cutout').onchange=displayMode;$('decal').onchange=()=>selectAsset($('decal').value).catch(fail);
for(const id of['az','el'])$(id).addEventListener('input',()=>{light();render();});for(const id of['front','oblique','grazing'])$(id).onclick=()=>{cameraPreset(id);render();};
$('reset').onclick=()=>{assignParams(defaults);$('az').value='35';$('el').value='55';$('mode').value='pbr';$('cutout').checked=true;parameters();light();displayMode();cameraPreset('front');};
state.select=id=>{$('decal').value=id;return selectAsset(id)};state.setParameters=p=>{assignParams({...readParams(),...p});parameters();render();};state.cameraPreset=k=>{cameraPreset(k);render();};state.render=render;
let frames=0,t=performance.now();function frame(now){controls.update();render();frames++;if(now-t>=800){$('fps').textContent=String(Math.round(frames*1000/(now-t)));frames=0;t=now;}requestAnimationFrame(frame);}requestAnimationFrame(frame);
selectAsset(ASSETS[0].id).catch(fail);