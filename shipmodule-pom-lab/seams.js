import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createPbrDecalMaterial, enablePomDecalMaterial, updatePomDecalMaterial } from './PomDecalMaterial.js';
import { preparePomReliefMaps, getPomReliefBounds } from './PomReliefProfile.js';
import { seamPackFixture } from './seam-pack-fixture.js';
import { loadSeamAsset, solidTexture, toRgba } from './seam-pack-codec.js';
import { CONTROL_IDS, readControls, assignControls, updateControlOutputs } from './pull-rail-controls.js';

const $ = id => document.getElementById(id);
const status = $('status');
const state = window.__POM_SEAM_LAB__ = { ready:false, errors:[], renderCount:0, version:'seam-pack-v1' };
function fail(error){const message=error instanceof Error?error.message:String(error);state.errors.push(message);state.ready=false;status.dataset.state='error';status.textContent=`Ошибка: ${message}`;console.error(error);}
addEventListener('error',event=>fail(event.error||event.message));
addEventListener('unhandledrejection',event=>fail(event.reason));

const pack=seamPackFixture.pack;
const assets=seamPackFixture.assets;
const byId=new Map(assets.map(asset=>[asset.id,asset]));
const resources=new Map();
const defaults={...pack.defaultProfile};
const active=[];
let activeResourceIds=new Set(), viewportWidth=1, viewportHeight=1, scheduled=0, lastPreset='front';

function degrees(value){return THREE.MathUtils.degToRad(value);}
function localPort(asset,id){const port=asset.ports.find(item=>item.id===id);if(!port)throw new Error(`${asset.id}: port ${id} not found`);return {point:new THREE.Vector2((port.uv[0]-.5)*asset.worldSize[0],(port.uv[1]-.5)*asset.worldSize[1]),angle:degrees(port.angleDeg),port};}
function attach(parent, parentAsset, parentPortId, childAsset, childPortId='S'){
  const pp=localPort(parentAsset,parentPortId), cp=localPort(childAsset,childPortId);
  const parentPoint=pp.point.clone().rotateAround(new THREE.Vector2(),parent.rotation).add(parent.position);
  const targetAngle=parent.rotation+pp.angle;
  const rotation=targetAngle+Math.PI-cp.angle;
  const childPoint=cp.point.clone().rotateAround(new THREE.Vector2(),rotation);
  return {rotation,position:parentPoint.sub(childPoint)};
}

async function resource(asset){
  if(resources.has(asset.id))return resources.get(asset.id);
  const promise=(async()=>{
    status.textContent=`Загрузка ${asset.label}…`;
    const fixture=await loadSeamAsset(asset);
    const {width,height,count,sourceHeight,alpha,textures,heightData}=fixture;
    const black=solidTexture(0,0,0), white=solidTexture(200,204,210);
    const geometry=new THREE.PlaneGeometry(asset.worldSize[0],asset.worldSize[1]);
    geometry.setAttribute('uv1',geometry.getAttribute('uv').clone());
    function material(pom){
      const result=createPbrDecalMaterial({tint:'#ffffff'},{baseColor:textures.base,normal:textures.normal,orm:textures.orm,emissive:black});
      Object.assign(result,{transparent:false,opacity:1,alphaTest:.34,blending:THREE.NoBlending,side:THREE.DoubleSide,depthWrite:true,polygonOffset:false,roughness:1,metalness:1,aoMapIntensity:.8});
      result.normalScale.set(1,1);
      if(pom)enablePomDecalMaterial(result,{heightMap:textures.height,...defaults});
      return result;
    }
    const result={...fixture,asset,geometry,flat:material(false),pom:material(true),heightMaterial:new THREE.MeshBasicMaterial({map:textures.height,side:THREE.DoubleSide,toneMapped:false}),white,fieldKey:''};
    const anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    for(const texture of Object.values(textures))texture.anisotropy=anisotropy;
    return result;
  })();
  resources.set(asset.id,promise);
  return promise;
}

const renderer=new THREE.WebGLRenderer({canvas:$('canvas'),antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.debug.checkShaderErrors=true;
renderer.debug.onShaderError=(gl,program,vertex,fragment)=>fail(new Error('GLSL: '+[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n')));
const gl=renderer.getContext();
const scene=new THREE.Scene();scene.background=new THREE.Color(0x101720);scene.add(new THREE.HemisphereLight(0xffffff,0x647386,1.2));
const keyLight=new THREE.DirectionalLight(0xffffff,2.8);scene.add(keyLight,keyLight.target);
const camera=new THREE.PerspectiveCamera(42,1,.05,200);const orbit=new OrbitControls(camera,$('canvas'));orbit.enableDamping=true;orbit.minDistance=2;orbit.maxDistance=80;

function clearInstances(){for(const instance of active)scene.remove(instance.mesh);active.length=0;activeResourceIds=new Set();}
async function addInstance(assetId, transform={rotation:0,position:new THREE.Vector2()}, z=0){
  const asset=byId.get(assetId);if(!asset)throw new Error(`Unknown seam asset ${assetId}`);const res=await resource(asset);
  const mesh=new THREE.Mesh(res.geometry,res.flat);mesh.position.set(transform.position.x,transform.position.y,z);mesh.rotation.z=transform.rotation;mesh.renderOrder=40+active.length;scene.add(mesh);active.push({asset,res,mesh,transform});activeResourceIds.add(assetId);return active[active.length-1];
}
async function buildLayout(){
  state.ready=false;status.dataset.state='';clearInstances();const selected=byId.get($('asset').value)||assets[0];const mode=$('layout').value;const root={rotation:0,position:new THREE.Vector2()};
  if(mode==='single')await addInstance(selected.id,root);
  else if(mode==='join'){
    const candidate=selected.id.startsWith('straight_')?selected:byId.get('straight_offset_a');
    await addInstance(candidate.id,root);const child=attach(root,candidate,candidate.ports[0].id,candidate,candidate.ports[1].id);await addInstance(candidate.id,child,.0002);
  }else{
    const config={cross:['cross_hub_a',['N','E','S','W']],t:['t_hub_a',['W','E','S']],y:['y_hub_a',['NW','NE','S']],corner:['corner_hub_a',['E','S']],angled:['angled_hub_a',['NE','S']]}[mode];
    const [hubId,ports]=config;const hub=byId.get(hubId),straight=byId.get('straight_offset_a');await addInstance(hubId,root);
    for(const portId of ports){const child=attach(root,hub,portId,straight,'S');await addInstance(straight.id,child,.0002+active.length*.00005);}
  }
  applyParameters();updateMode();fitCamera(lastPreset);state.ready=true;state.assetId=selected.id;state.layout=mode;state.activeCount=active.length;
  $('activeCount').textContent=String(active.length);$('resolution').textContent=`${selected.runtimeWidth} × ${selected.runtimeHeight}`;$('integrity').textContent=`${activeResourceIds.size*2} maps SHA-256 OK`;
  status.dataset.state='ready';status.textContent=`Готово · ${selected.label} · ${mode} · ${active.length} POM Decal`;
}

function bounds(){
  const box=new THREE.Box2();for(const item of active){const [w,h]=item.asset.worldSize;for(const x of [-w/2,w/2])for(const y of [-h/2,h/2]){const p=new THREE.Vector2(x,y).rotateAround(new THREE.Vector2(),item.transform.rotation).add(item.transform.position);box.expandByPoint(p);}}return box;
}
function fitCamera(kind='front'){
  lastPreset=kind;const box=bounds();if(box.isEmpty())return;const center=box.getCenter(new THREE.Vector2()),size=box.getSize(new THREE.Vector2());const splitAspect=Math.max(.15,Math.floor(viewportWidth/2)/Math.max(1,viewportHeight));const vertical=size.y*.62/Math.tan(degrees(camera.fov*.5));const horizontal=size.x*.62/(Math.tan(degrees(camera.fov*.5))*splitAspect);const distance=Math.max(3,vertical,horizontal);const direction=kind==='grazing'?new THREE.Vector3(.95,.04,.28):kind==='oblique'?new THREE.Vector3(.55,.15,1):new THREE.Vector3(0,0,1);camera.position.copy(direction.normalize().multiplyScalar(distance)).add(new THREE.Vector3(center.x,center.y,0));orbit.target.set(center.x,center.y,0);orbit.update();
}
function resize(){const b=$('view').getBoundingClientRect();viewportWidth=Math.max(2,Math.floor(b.width));viewportHeight=Math.max(1,Math.floor(b.height));renderer.setSize(viewportWidth,viewportHeight,false);camera.aspect=Math.floor(viewportWidth/2)/viewportHeight;camera.updateProjectionMatrix();}
function applyParameters(){
  if(!active.length)return;const parameters=readControls();for(const id of activeResourceIds){const promise=resources.get(id);promise.then(res=>{const key=JSON.stringify([parameters.heightScale,parameters.neutralLevel,parameters.raiseScale,parameters.sinkScale,parameters.wallSoftnessPx]);if(key!==res.fieldKey){const prepared=preparePomReliefMaps(res.sourceHeight,res.width,res.height,parameters,res.alpha);for(let i=0;i<res.count;i++){const value=THREE.DataUtils.toHalfFloat(prepared.heightField[i]);res.heightData.set([value,value,value,15360],i*4);}res.textures.height.needsUpdate=true;res.textures.normal.image.data=toRgba(prepared.normal,3);res.textures.normal.needsUpdate=true;res.fieldKey=key;}updatePomDecalMaterial(res.pom,parameters);});}
  updateControlOutputs(parameters);state.parameters=parameters;state.bounds=getPomReliefBounds(parameters);const first=active[0]?.res;state.programKey=first?.pom.customProgramCacheKey();$('range').textContent=`+${(state.bounds.top*parameters.heightScale).toFixed(4)} / ${(state.bounds.bottom*parameters.heightScale).toFixed(4)}`;
}
function scheduleParameters(){cancelAnimationFrame(scheduled);scheduled=requestAnimationFrame(applyParameters);}
function updateLight(){const az=degrees(Number($('az').value)),el=degrees(Number($('el').value));keyLight.position.set(Math.cos(el)*Math.sin(az)*8,Math.sin(el)*8,Math.cos(el)*Math.cos(az)*8);$('azOut').textContent=`${$('az').value}°`;$('elOut').textContent=`${$('el').value}°`;}
function updateMode(){for(const item of active){for(const material of [item.res.flat,item.res.pom]){material.map=$('mode').value==='clay'?item.res.white:item.res.textures.base;material.alphaTest=$('cutout').checked?.34:0;material.needsUpdate=true;}}}
function setPass(kind){for(const item of active)item.mesh.material=$('mode').value==='height'?item.res.heightMaterial:kind==='flat'?item.res.flat:item.res.pom;}
function render(){renderer.setScissorTest(true);const split=Math.floor(viewportWidth/2);setPass('flat');renderer.setViewport(0,0,split,viewportHeight);renderer.setScissor(0,0,split,viewportHeight);renderer.render(scene,camera);setPass('pom');renderer.setViewport(split,0,viewportWidth-split,viewportHeight);renderer.setScissor(split,0,viewportWidth-split,viewportHeight);renderer.render(scene,camera);renderer.setScissorTest(false);state.renderCount++;}
function snapshot(){render();const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let min=255,max=0,sum=0,square=0,samples=0,hash=2166136261;for(let y=Math.floor(h*.10);y<h*.90;y+=4)for(let x=Math.floor(w*.56);x<w*.96;x+=4){const value=pixels[(y*w+x)*4];min=Math.min(min,value);max=Math.max(max,value);sum+=value;square+=value*value;samples++;hash=Math.imul(hash^value,16777619)>>>0;}return{min,max,variance:square/samples-(sum/samples)**2,hash,width:w,height:h,glError:gl.getError()};}

async function start(){
  if(seamPackFixture.schema!==1||assets.length!==9)throw new Error('Expected Seam Pack v1 with 9 modules');
  for(const asset of assets){const option=document.createElement('option');option.value=asset.id;option.textContent=asset.label;$('asset').append(option);}
  $('asset').value='cross_hub_a';assignControls(defaults);new ResizeObserver(()=>{resize();fitCamera(lastPreset);}).observe($('view'));resize();updateLight();
  for(const id of Object.values(CONTROL_IDS))$(id).addEventListener('input',scheduleParameters);$('stableGradients').onchange=applyParameters;$('az').oninput=$('el').oninput=updateLight;$('mode').onchange=updateMode;$('cutout').onchange=updateMode;
  $('asset').onchange=buildLayout;$('layout').onchange=buildLayout;for(const id of ['front','oblique','grazing'])$(id).onclick=()=>fitCamera(id);
  $('legacy').onclick=()=>{assignControls({...defaults,neutralLevel:1,raiseScale:1,sinkScale:1,wallSoftnessPx:0,minSteps:8,maxSteps:64,refinementSteps:5,stableGradients:false});applyParameters();};
  $('reset').onclick=()=>{assignControls(defaults);$('az').value=35;$('el').value=55;$('mode').value='pbr';$('cutout').checked=true;applyParameters();updateLight();updateMode();fitCamera('front');};
  Object.assign(state,{snapshot,render,cameraPreset:kind=>{fitCamera(kind);render();},setLayout:async mode=>{$('layout').value=mode;await buildLayout();render();},setAsset:async id=>{$('asset').value=id;await buildLayout();render();},setParameters:parameters=>{assignControls(parameters);applyParameters();render();},uniforms:()=>{const first=active[0]?.res?.pom?.userData?.pomUniforms;return first?Object.fromEntries(Object.entries(first).filter(([key])=>key!=='pomHeightMap').map(([key,value])=>[key,value.value])):{};},pack:seamPackFixture});
  $('packName').textContent=pack.label;$('shader').textContent='POM v4';$('socket').textContent=pack.socketStandard.id;
  await buildLayout();render();const sample=snapshot();if(state.errors.length||sample.glError!==gl.NO_ERROR||sample.variance<15||sample.max-sample.min<20)throw new Error('Frame validation: seam pack did not render');
  let frames=0,time=performance.now();function frame(now){orbit.update();render();frames++;if(now-time>=800){$('fps').textContent=String(Math.round(frames*1000/(now-time)));frames=0;time=now;}requestAnimationFrame(frame);}requestAnimationFrame(frame);
}
start().catch(fail);
