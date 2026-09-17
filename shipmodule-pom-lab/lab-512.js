import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createPbrDecalMaterial, enablePomDecalMaterial, updatePomDecalMaterial } from './PomDecalMaterial.js';
import { preparePomReliefMaps, getPomReliefBounds } from './PomReliefProfile.js';
import { fixture512 } from './fixture-512.js';

const $ = id => document.getElementById(id);
const state = window.__POM_LAB__ = { ready:false, errors:[], size:0, maps:{}, renderCount:0, version:'asymmetric-v4' };
const status=$('status');
function fail(error) {
  const text=error instanceof Error?error.message:typeof error==='string'?error:JSON.stringify(error);
  state.errors.push(text);state.ready=false;status.dataset.state='error';status.textContent=`Ошибка: ${text}`;console.error(error);
}
window.addEventListener('error',e=>fail(e.error||e.message));
window.addEventListener('unhandledrejection',e=>fail(e.reason));
const defaults={heightScale:.02,neutralLevel:.6,raiseScale:.35,sinkScale:1.25,wallSoftnessPx:1.25,minSteps:12,maxSteps:96,refinementSteps:6,maxUvOffset:.26,grazingFadeStart:.08,grazingFadeEnd:.22,jitterStrength:0,stableGradients:true};
const ids={heightScale:'height',neutralLevel:'neutralLevel',raiseScale:'raiseScale',sinkScale:'sinkScale',wallSoftnessPx:'wallSoftnessPx',minSteps:'minSteps',maxSteps:'maxSteps',refinementSteps:'refine',maxUvOffset:'maxUvOffset',grazingFadeStart:'grazingFadeStart',grazingFadeEnd:'grazingFadeEnd',jitterStrength:'jitterStrength'};
const outputs={height:'heightOut',minSteps:'minOut',maxSteps:'maxOut',refine:'refineOut'};
function readParameters(){const p=Object.fromEntries(Object.entries(ids).map(([k,id])=>[k,Number($(id).value)]));p.stableGradients=$('stableGradients').checked;return p;}
function assignParameters(p){for(const [k,v] of Object.entries(p)){if(ids[k])$(ids[k]).value=String(v);if(k==='stableGradients')$('stableGradients').checked=v;}}
async function decode(name,expected){
  const entry=fixture512.maps[name];
  if(!entry||entry.length!==expected||typeof entry.base64!=='string')throw new Error(`${name}: invalid fixture schema`);
  if(entry.base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.base64))throw new Error(`${name}: invalid base64 payload`);
  const s=atob(entry.base64),b=Uint8Array.from(s,c=>c.charCodeAt(0));
  if(b.length!==expected)throw new Error(`${name}: ${b.length} bytes, expected ${expected}`);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==entry.sha256)throw new Error(`${name}: SHA-256 mismatch`);
  state.maps[name]={bytes:b.length,sha256:hash,verified:true};return b;
}
function rgba(src,channels){if(channels===4)return src;const b=new Uint8Array(src.length/channels*4);for(let i=0;i<src.length/channels;i++){b[i*4]=src[i*channels];b[i*4+1]=src[i*channels+(channels===1?0:1)];b[i*4+2]=src[i*channels+(channels===1?0:2)];b[i*4+3]=255;}return b;}
function texture(src,channels,srgb=false){const t=new THREE.DataTexture(rgba(src,channels),512,512,THREE.RGBAFormat,THREE.UnsignedByteType);t.colorSpace=srgb?THREE.SRGBColorSpace:THREE.NoColorSpace;t.flipY=false;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
function solid(r,g,b){const t=new THREE.DataTexture(new Uint8Array([r,g,b,255]),1,1,THREE.RGBAFormat);t.needsUpdate=true;return t;}

async function start(){
  if(fixture512.schema!==1||fixture512.size!==512)throw new Error('Expected fixture schema 1 / 512×512');
  status.textContent='Проверка исходных карт 512×512…';
  const count=512*512;
  const [base,height,normal,orm,alpha]=await Promise.all([decode('base',count*4),decode('height',count),decode('normal',count*3),decode('orm',count*3),decode('alpha',count)]);
  state.size=512;state.heightSource=fixture512.heightSource;
  const maps={base:texture(base,4,true),normal:texture(normal,3),orm:texture(orm,3),alpha:texture(alpha,1)};
  // Filtering is done once on slider changes. Store the result as filterable
  // half-float data; do not quantize softened walls back to 8-bit each frame.
  const heightData=new Uint16Array(count*4);
  maps.height=new THREE.DataTexture(heightData,512,512,THREE.RGBAFormat,THREE.HalfFloatType);
  maps.height.colorSpace=THREE.NoColorSpace;maps.height.flipY=false;
  maps.height.wrapS=maps.height.wrapT=THREE.ClampToEdgeWrapping;
  maps.height.minFilter=THREE.LinearMipmapLinearFilter;maps.height.magFilter=THREE.LinearFilter;maps.height.generateMipmaps=true;
  const white=solid(200,204,210),black=solid(0,0,0);
  const renderer=new THREE.WebGLRenderer({canvas:$('canvas'),antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.debug.checkShaderErrors=true;
  renderer.debug.onShaderError=(gl,program,vertex,fragment)=>fail(new Error('GLSL: '+[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n')));
  const gl=renderer.getContext();state.webglVersion=gl.getParameter(gl.VERSION);
  const maxAnisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  for(const t of Object.values(maps))t.anisotropy=maxAnisotropy;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x131923);scene.add(new THREE.HemisphereLight(0xffffff,0x728091,1.15));
  const key=new THREE.DirectionalLight(0xffffff,2.6);scene.add(key,key.target);
  const camera=new THREE.PerspectiveCamera(42,1,.05,100),controls=new OrbitControls(camera,$('canvas'));
  controls.enableDamping=true;controls.minDistance=2.1;controls.maxDistance=15;
  const geometry=new THREE.PlaneGeometry(2.8,2.8);geometry.setAttribute('uv1',geometry.getAttribute('uv').clone());
  const layer={tint:'#ffffff'};
  function material(isPom){const m=createPbrDecalMaterial(layer,{baseColor:maps.base,normal:maps.normal,orm:maps.orm,emissive:black});m.transparent=false;m.opacity=1;m.alphaTest=0;m.blending=THREE.NoBlending;m.side=THREE.DoubleSide;m.depthWrite=true;m.polygonOffset=false;m.roughness=m.metalness=1;m.aoMapIntensity=.7;m.normalScale.set(1,1);if(isPom)enablePomDecalMaterial(m,{heightMap:maps.height,...defaults});return m;}
  const flat=material(false),pom=material(true),debug=new THREE.MeshBasicMaterial({map:maps.height,side:THREE.DoubleSide,toneMapped:false});
  const mesh=new THREE.Mesh(geometry,flat);scene.add(mesh);
  let width=1,screenHeight=1,lastFieldKey='',pending=0;
  function resize(){const b=$('view').getBoundingClientRect();width=Math.max(2,Math.floor(b.width));screenHeight=Math.max(1,Math.floor(b.height));renderer.setSize(width,screenHeight,false);camera.aspect=Math.floor(width/2)/screenHeight;camera.updateProjectionMatrix();}
  function cameraPreset(kind){const distance=Math.max(4.4,1.65/(Math.tan(THREE.MathUtils.degToRad(21))*camera.aspect));const dir=kind==='grazing'?new THREE.Vector3(.96,.06,.28):kind==='oblique'?new THREE.Vector3(.55,.17,1):new THREE.Vector3(0,0,1);camera.position.copy(dir.normalize().multiplyScalar(distance));controls.target.set(0,0,0);controls.update();}
  function parameters(){
    const p=readParameters();p.minSteps=Math.min(p.minSteps,p.maxSteps);p.grazingFadeEnd=Math.max(p.grazingFadeStart+.001,p.grazingFadeEnd);
    const fieldKey=JSON.stringify([p.heightScale,p.neutralLevel,p.raiseScale,p.sinkScale,p.wallSoftnessPx]);
    if(fieldKey!==lastFieldKey){
      const prepared=preparePomReliefMaps(height,512,512,p,alpha);
      for(let i=0;i<count;i++){const h=THREE.DataUtils.toHalfFloat(prepared.heightField[i]);heightData[i*4]=heightData[i*4+1]=heightData[i*4+2]=h;heightData[i*4+3]=15360;}
      maps.height.needsUpdate=true;maps.normal.image.data=rgba(prepared.normal,3);maps.normal.needsUpdate=true;lastFieldKey=fieldKey;state.fieldBuilds=(state.fieldBuilds||0)+1;
    }
    updatePomDecalMaterial(pom,p);
    for(const [key,id]of Object.entries(ids)){const e=$(outputs[id]||id+'Out');if(e)e.textContent=Number(p[key]).toFixed(['minSteps','maxSteps','refinementSteps'].includes(key)?0:key==='heightScale'?3:2);}
    state.parameters=p;state.bounds=getPomReliefBounds(p);state.programKey=pom.customProgramCacheKey();
    $('range').textContent=`+${(state.bounds.top*p.heightScale).toFixed(4)} / ${(state.bounds.bottom*p.heightScale).toFixed(4)}`;
  }
  function scheduleParameters(){cancelAnimationFrame(pending);pending=requestAnimationFrame(parameters);}
  function light(){const a=THREE.MathUtils.degToRad(Number($('az').value)),e=THREE.MathUtils.degToRad(Number($('el').value));key.position.set(Math.cos(e)*Math.sin(a)*5,Math.sin(e)*5,Math.cos(e)*Math.cos(a)*5);$('azOut').textContent=$('az').value+'°';$('elOut').textContent=$('el').value+'°';}
  function displayMode(){for(const m of[flat,pom]){m.map=$('mode').value==='clay'?white:maps.base;m.alphaMap=$('cutout').checked?maps.alpha:null;m.alphaTest=$('cutout').checked?.5:0;m.needsUpdate=true;}}
  function render(){renderer.setScissorTest(true);const s=Math.floor(width/2);mesh.material=$('mode').value==='height'?debug:flat;renderer.setViewport(0,0,s,screenHeight);renderer.setScissor(0,0,s,screenHeight);renderer.render(scene,camera);mesh.material=$('mode').value==='height'?debug:pom;renderer.setViewport(s,0,width-s,screenHeight);renderer.setScissor(s,0,width-s,screenHeight);renderer.render(scene,camera);renderer.setScissorTest(false);state.renderCount++;}
  function snapshot(){render();const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,b=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);let min=255,max=0,sum=0,sq=0,n=0,hash=2166136261;for(let y=Math.floor(h*.2);y<h*.8;y+=3)for(let x=Math.floor(w*.6);x<w*.9;x+=3){const v=b[(y*w+x)*4];min=Math.min(min,v);max=Math.max(max,v);sum+=v;sq+=v*v;n++;hash=Math.imul(hash^v,16777619)>>>0;}return{min,max,variance:sq/n-(sum/n)**2,hash,width:w,height:h,glError:gl.getError()};}
  state.snapshot=snapshot;state.render=render;state.cameraPreset=kind=>{cameraPreset(kind);render();};
  state.setParameters=p=>{assignParameters(p);parameters();render();};state.setHeight=h=>state.setParameters({heightScale:h});
  state.uniforms=()=>Object.fromEntries(Object.entries(pom.userData.pomUniforms).filter(([k])=>k!=='pomHeightMap').map(([k,v])=>[k,v.value]));
  assignParameters(defaults);new ResizeObserver(resize).observe($('view'));resize();cameraPreset('front');parameters();light();displayMode();
  for(const id of Object.values(ids))$(id).addEventListener('input',scheduleParameters);
  $('stableGradients').onchange=parameters;
  for(const id of['az','el'])$(id).addEventListener('input',light);
  for(const id of['front','oblique','grazing'])$(id).onclick=()=>cameraPreset(id);
  $('mode').onchange=displayMode;$('cutout').onchange=displayMode;
  $('legacy').onclick=()=>{assignParameters({...defaults,neutralLevel:1,raiseScale:1,sinkScale:1,wallSoftnessPx:0,minSteps:8,maxSteps:64,refinementSteps:5,stableGradients:false});parameters();};
  $('reset').onclick=()=>{assignParameters(defaults);$('az').value='35';$('el').value='55';$('mode').value='pbr';$('cutout').checked=false;parameters();light();displayMode();cameraPreset('front');};
  render();if(state.errors.length)throw new Error('POM shader compilation failed');
  const sample=snapshot();if(sample.glError!==gl.NO_ERROR||sample.variance<25||sample.max-sample.min<30)throw new Error('Проверка кадра: рельеф не отрисован');
  state.ready=true;$('resolution').textContent='512 × 512';$('integrity').textContent='5 / 5 SHA-256 OK';$('shader').textContent='POM v4';status.dataset.state='ready';status.textContent='Готово · POM v4 · независимые выступы / впадины · Normal синхронизирована с Height';
  let frames=0,t=performance.now();function frame(now){controls.update();render();frames++;if(now-t>=800){$('fps').textContent=String(Math.round(frames*1000/(now-t)));frames=0;t=now;}requestAnimationFrame(frame);}requestAnimationFrame(frame);
}
start().catch(fail);
