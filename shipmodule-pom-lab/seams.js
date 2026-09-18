import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createPbrDecalMaterial, enablePomDecalMaterial, updatePomDecalMaterial } from './PomDecalMaterial.js';
import { preparePomReliefMaps, getPomReliefBounds } from './PomReliefProfile.js';
import { CONTROL_IDS, readControls, assignControls, updateControlOutputs } from './pull-rail-controls.js';
import { loadSeamPackManifest, loadSeamAsset, solidTexture, toRgba } from './seam-pack-codec.js';

const $ = id => document.getElementById(id);
const status = $('status');
const state = window.__POM_SEAM_LAB__ = {
  ready: false, errors: [], renderCount: 0, version: 'seam-pack-v1', loadedAssets: [],
};
function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  state.errors.push(message);
  state.ready = false;
  status.dataset.state = 'error';
  status.textContent = `Ошибка: ${message}`;
  console.error(error);
}
addEventListener('error', event => fail(event.error || event.message));
addEventListener('unhandledrejection', event => fail(event.reason));

const deg = THREE.MathUtils.degToRad;
const rotate2 = (v, angle) => new THREE.Vector2(
  v.x * Math.cos(angle) - v.y * Math.sin(angle),
  v.x * Math.sin(angle) + v.y * Math.cos(angle),
);

async function start() {
  status.textContent = 'Загрузка каталога Seam Pack v1…';
  const manifest = await loadSeamPackManifest();
  state.manifest = manifest;
  const metadata = new Map(manifest.assets.map(asset => [asset.id, asset]));
  for (const asset of manifest.assets) {
    const option = document.createElement('option');
    option.value = asset.id;
    option.textContent = asset.label;
    $('asset').append(option);
  }
  $('asset').value = 'straight_frame_a';
  $('layout').value = 'join';

  const renderer = new THREE.WebGLRenderer({
    canvas: $('canvas'), antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => fail(new Error(
    'GLSL: ' + [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n'),
  ));
  const gl = renderer.getContext();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101720);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x647386, 1.15));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  scene.add(keyLight, keyLight.target);
  const fillLight = new THREE.DirectionalLight(0x8fb9e8, .55);
  fillLight.position.set(-3, 1, 4);
  scene.add(fillLight);

  const camera = new THREE.PerspectiveCamera(42, 1, .05, 200);
  const orbit = new OrbitControls(camera, $('canvas'));
  orbit.enableDamping = true;
  orbit.target.set(0, 0, 0);

  const black = solidTexture(0, 0, 0);
  const white = solidTexture(205, 208, 214);
  const runtimeCache = new Map();
  const geometryCache = new Map();
  let flatGroup = new THREE.Group();
  let pomGroup = new THREE.Group();
  scene.add(flatGroup, pomGroup);
  let assemblyBounds = { width: 4, height: 6 };
  let viewportWidth = 1, viewportHeight = 1;
  let parameterTimer = 0;
  let currentAssembly = [];

  function dimensions(asset) {
    const [width, height] = asset.runtimeResolution;
    const scale = asset.connectorWidthPx || manifest.connectorWidthPx || 192;
    return { width: width / scale, height: height / scale };
  }
  function localPort(asset, port) {
    const size = dimensions(asset);
    return new THREE.Vector2((port.x - .5) * size.width, (port.y - .5) * size.height);
  }
  function port(asset, id) {
    const result = asset.ports.find(value => value.id === id);
    if (!result) throw new Error(`${asset.id}: port ${id} not found`);
    return result;
  }
  function instance(assetId, x = 0, y = 0, rotation = 0) {
    return { assetId, position: new THREE.Vector2(x, y), rotation };
  }
  function attach(parent, parentPortId, childAssetId, childPortId) {
    const parentMeta = metadata.get(parent.assetId);
    const childMeta = metadata.get(childAssetId);
    const pp = port(parentMeta, parentPortId);
    const cp = port(childMeta, childPortId);
    const childRotation = parent.rotation + deg(pp.angle + 180 - cp.angle);
    const parentPoint = parent.position.clone().add(rotate2(localPort(parentMeta, pp), parent.rotation));
    const outward = new THREE.Vector2(Math.cos(parent.rotation + deg(pp.angle)), Math.sin(parent.rotation + deg(pp.angle)));
    const overlap = Math.min(parentMeta.connectorOverlap || .12, childMeta.connectorOverlap || .12);
    const target = parentPoint.clone().sub(outward.multiplyScalar(overlap));
    const childPoint = rotate2(localPort(childMeta, cp), childRotation);
    return instance(childAssetId, target.x - childPoint.x, target.y - childPoint.y, childRotation);
  }
  function computeBounds(instances) {
    const box = new THREE.Box2();
    for (const item of instances) {
      const size = dimensions(metadata.get(item.assetId));
      for (const x of [-size.width / 2, size.width / 2]) for (const y of [-size.height / 2, size.height / 2]) {
        box.expandByPoint(item.position.clone().add(rotate2(new THREE.Vector2(x, y), item.rotation)));
      }
    }
    const center = box.getCenter(new THREE.Vector2());
    for (const item of instances) item.position.sub(center);
    const size = box.getSize(new THREE.Vector2());
    return { width: size.x, height: size.y };
  }
  function makeAssembly(selected, layout) {
    let items;
    if (layout === 'network') {
      const root = instance('cross_hub_a');
      items = [root];
      for (const p of metadata.get(root.assetId).ports) items.push(attach(root, p.id, 'straight_frame_a', 'S'));
    } else if (layout === 'join') {
      const root = instance(selected);
      items = [root];
      const meta = metadata.get(selected);
      if (meta.category === 'straight') {
        items.push(attach(root, 'N', selected, 'S'));
        items.push(attach(root, 'S', selected, 'N'));
      } else {
        for (const p of meta.ports) items.push(attach(root, p.id, 'straight_frame_a', 'S'));
      }
    } else {
      items = [instance(selected)];
    }
    const bounds = computeBounds(items);
    return { items, bounds };
  }

  async function ensureRuntime(assetId) {
    if (runtimeCache.has(assetId)) return runtimeCache.get(assetId);
    const source = await loadSeamAsset(assetId);
    for (const texture of Object.values(source.textures)) texture.anisotropy = anisotropy;
    const geometry = new THREE.PlaneGeometry(...Object.values(dimensions(source.metadata)));
    geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
    geometryCache.set(assetId, geometry);
    const layer = { tint: '#ffffff', opacity: 1, roughness: 1, metalness: 1, normalStrength: 1, emissiveIntensity: 0, blendMode: 'normal' };
    function pbr(pomEnabled) {
      const material = createPbrDecalMaterial(layer, {
        baseColor: source.textures.base, normal: source.textures.normal,
        orm: source.textures.orm, emissive: source.textures.emissive || black,
      });
      Object.assign(material, {
        transparent: false, opacity: 1, alphaTest: .38, blending: THREE.NoBlending,
        side: THREE.DoubleSide, depthWrite: true, polygonOffset: false,
        roughness: 1, metalness: 1, aoMapIntensity: .8, alphaMap: source.textures.alpha,
        emissiveIntensity: .28,
      });
      material.normalScale.set(1, 1);
      if (pomEnabled) enablePomDecalMaterial(material, { heightMap: source.textures.height, ...source.metadata.profile });
      return material;
    }
    const runtime = {
      ...source,
      geometry,
      flatMaterial: pbr(false),
      pomMaterial: pbr(true),
      heightMaterial: new THREE.MeshBasicMaterial({
        map: source.textures.height, alphaMap: source.textures.alpha, alphaTest: .38,
        side: THREE.DoubleSide, toneMapped: false,
      }),
      fieldKey: '',
    };
    runtimeCache.set(assetId, runtime);
    return runtime;
  }

  function disposeGroup(group) {
    for (const child of [...group.children]) group.remove(child);
  }
  function addPortMarkers(group, item, asset) {
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x61c2ff, side: THREE.DoubleSide, depthTest: false });
    for (const p of asset.ports) {
      const position = item.position.clone().add(rotate2(localPort(asset, p), item.rotation));
      const marker = new THREE.Mesh(new THREE.RingGeometry(.055, .095, 24), markerMaterial);
      marker.position.set(position.x, position.y, .025);
      marker.userData.portMarker = true;
      group.add(marker);
    }
  }
  function populateGroup(group, materialKey) {
    disposeGroup(group);
    for (const item of currentAssembly) {
      const runtime = runtimeCache.get(item.assetId);
      const mesh = new THREE.Mesh(runtime.geometry, runtime[materialKey]);
      mesh.position.set(item.position.x, item.position.y, 0);
      mesh.rotation.z = item.rotation;
      mesh.userData.assetId = item.assetId;
      mesh.userData.assetMesh = true;
      group.add(mesh);
      if ($('ports').checked) addPortMarkers(group, item, runtime.metadata);
    }
  }
  function materialFor(runtime, side) {
    if ($('mode').value === 'height') return runtime.heightMaterial;
    return side === 'left' ? runtime.flatMaterial : runtime.pomMaterial;
  }
  function applyGroupMaterials(group, side) {
    for (const child of group.children) {
      if (!child.userData.assetMesh) continue;
      child.material = materialFor(runtimeCache.get(child.userData.assetId), side);
    }
  }

  function resize() {
    const bounds = $('view').getBoundingClientRect();
    viewportWidth = Math.max(2, Math.floor(bounds.width));
    viewportHeight = Math.max(1, Math.floor(bounds.height));
    renderer.setSize(viewportWidth, viewportHeight, false);
    camera.aspect = Math.max(1, Math.floor(viewportWidth / 2)) / viewportHeight;
    camera.updateProjectionMatrix();
  }
  function fitDistance() {
    const tan = Math.tan(deg(camera.fov * .5));
    return Math.max(assemblyBounds.height / (2 * tan), assemblyBounds.width / (2 * tan * camera.aspect)) * 1.22 + .35;
  }
  function cameraPreset(kind) {
    const distance = Math.max(3.2, fitDistance());
    const direction = kind === 'grazing'
      ? new THREE.Vector3(.95, .04, .3)
      : kind === 'oblique' ? new THREE.Vector3(.52, .12, 1) : new THREE.Vector3(0, 0, 1);
    camera.position.copy(direction.normalize().multiplyScalar(distance));
    orbit.target.set(0, 0, 0);
    orbit.minDistance = distance * .4;
    orbit.maxDistance = distance * 4;
    orbit.update();
    state.camera = kind;
  }
  function updateLight() {
    const azimuth = deg(Number($('az').value));
    const elevation = deg(Number($('el').value));
    keyLight.position.set(Math.cos(elevation) * Math.sin(azimuth) * 8, Math.sin(elevation) * 8, Math.cos(elevation) * Math.cos(azimuth) * 8);
    $('azOut').textContent = `${$('az').value}°`;
    $('elOut').textContent = `${$('el').value}°`;
  }
  function updateMode() {
    for (const runtime of runtimeCache.values()) {
      for (const material of [runtime.flatMaterial, runtime.pomMaterial]) {
        material.map = $('mode').value === 'clay' ? white : runtime.textures.base;
        material.alphaMap = $('cutout').checked ? runtime.textures.alpha : null;
        material.alphaTest = $('cutout').checked ? .38 : 0;
        material.needsUpdate = true;
      }
      runtime.heightMaterial.alphaMap = $('cutout').checked ? runtime.textures.alpha : null;
      runtime.heightMaterial.alphaTest = $('cutout').checked ? .38 : 0;
      runtime.heightMaterial.needsUpdate = true;
    }
    applyGroupMaterials(flatGroup, 'left');
    applyGroupMaterials(pomGroup, 'right');
  }

  function applyParameters() {
    const parameters = readControls();
    const unique = [...new Set(currentAssembly.map(item => item.assetId))];
    const nextFieldKey = JSON.stringify([
      parameters.heightScale, parameters.neutralLevel, parameters.raiseScale,
      parameters.sinkScale, parameters.wallSoftnessPx,
    ]);
    for (const id of unique) {
      const runtime = runtimeCache.get(id);
      if (runtime.fieldKey !== nextFieldKey) {
        const prepared = preparePomReliefMaps(runtime.sourceHeight, runtime.width, runtime.height, parameters, runtime.alpha);
        for (let i = 0; i < runtime.count; i++) {
          const value = THREE.DataUtils.toHalfFloat(prepared.heightField[i]);
          const o = i * 4;
          runtime.heightData[o] = value;
          runtime.heightData[o + 1] = value;
          runtime.heightData[o + 2] = value;
          runtime.heightData[o + 3] = 15360;
        }
        runtime.textures.height.needsUpdate = true;
        runtime.textures.normal.image.data = toRgba(prepared.normal, 3);
        runtime.textures.normal.needsUpdate = true;
        runtime.fieldKey = nextFieldKey;
      }
      updatePomDecalMaterial(runtime.pomMaterial, parameters);
    }
    updateControlOutputs(parameters);
    const relief = getPomReliefBounds(parameters);
    state.parameters = parameters;
    state.bounds = relief;
    state.programKey = runtimeCache.get(unique[0])?.pomMaterial.customProgramCacheKey();
    $('range').textContent = `+${(relief.top * parameters.heightScale).toFixed(4)} / ${(relief.bottom * parameters.heightScale).toFixed(4)}`;
  }
  function scheduleParameters() {
    clearTimeout(parameterTimer);
    parameterTimer = setTimeout(() => { applyParameters(); render(); }, 55);
  }

  async function build() {
    state.ready = false;
    status.dataset.state = '';
    const selected = $('asset').value;
    const layout = $('layout').value;
    status.textContent = `Загрузка ${metadata.get(selected).label} · ${layout}…`;
    const assembly = makeAssembly(selected, layout);
    currentAssembly = assembly.items;
    assemblyBounds = assembly.bounds;
    const unique = [...new Set(currentAssembly.map(item => item.assetId))];
    await Promise.all(unique.map(ensureRuntime));
    populateGroup(flatGroup, 'flatMaterial');
    populateGroup(pomGroup, 'pomMaterial');
    applyParameters();
    updateMode();
    cameraPreset('front');
    render();
    const sample = snapshot();
    if (state.errors.length || sample.glError !== gl.NO_ERROR || sample.variance < 12 || sample.max - sample.min < 20) {
      throw new Error('Проверка кадра: seam assembly не отрисована');
    }
    const selectedMeta = metadata.get(selected);
    Object.assign(state, {
      ready: true, assetId: selected, layout, loadedAssets: unique,
      resolution: selectedMeta.runtimeResolution, connectorProfile: selectedMeta.connectorProfile,
      assemblyBounds,
    });
    $('assetName').textContent = selectedMeta.label;
    $('resolution').textContent = selectedMeta.runtimeResolution.join(' × ');
    $('connector').textContent = selectedMeta.connectorProfile;
    $('loaded').textContent = unique.length === 1 ? unique[0] : `${unique.length}: ${unique.join(', ')}`;
    $('shader').textContent = 'POM v4 / asymmetric relief';
    status.dataset.state = 'ready';
    status.textContent = `Готово · ${selectedMeta.label} · ${layout} · ${unique.length} fixture(s)`;
  }

  function render() {
    renderer.setScissorTest(true);
    const split = Math.floor(viewportWidth / 2);
    flatGroup.visible = true;
    pomGroup.visible = false;
    renderer.setViewport(0, 0, split, viewportHeight);
    renderer.setScissor(0, 0, split, viewportHeight);
    renderer.render(scene, camera);
    flatGroup.visible = false;
    pomGroup.visible = true;
    renderer.setViewport(split, 0, viewportWidth - split, viewportHeight);
    renderer.setScissor(split, 0, viewportWidth - split, viewportHeight);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    flatGroup.visible = pomGroup.visible = true;
    state.renderCount++;
  }
  function snapshot() {
    render();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = 255, max = 0, sum = 0, square = 0, samples = 0, hash = 2166136261;
    for (let y = Math.floor(h * .08); y < h * .92; y += 3) for (let x = Math.floor(w * .55); x < w * .96; x += 3) {
      const value = pixels[(y * w + x) * 4];
      min = Math.min(min, value); max = Math.max(max, value); sum += value; square += value * value; samples++;
      hash = Math.imul(hash ^ value, 16777619) >>> 0;
    }
    return { min, max, variance: square / samples - (sum / samples) ** 2, hash, width: w, height: h, glError: gl.getError() };
  }

  Object.assign(state, {
    snapshot, render,
    cameraPreset: kind => { cameraPreset(kind); render(); },
    setAsset: async id => { $('asset').value = id; await build(); },
    setLayout: async value => { $('layout').value = value; await build(); },
    setParameters: parameters => { assignControls(parameters); applyParameters(); render(); },
    uniforms: () => {
      const first = runtimeCache.get(state.loadedAssets[0]);
      return first ? Object.fromEntries(Object.entries(first.pomMaterial.userData.pomUniforms)
        .filter(([key]) => key !== 'pomHeightMap').map(([key, value]) => [key, value.value])) : {};
    },
  });

  new ResizeObserver(resize).observe($('view'));
  resize();
  assignControls(metadata.get($('asset').value).profile);
  updateLight();
  for (const id of Object.values(CONTROL_IDS)) $(id).addEventListener('input', scheduleParameters);
  $('stableGradients').onchange = scheduleParameters;
  $('az').oninput = $('el').oninput = updateLight;
  for (const id of ['front', 'oblique', 'grazing']) $(id).onclick = () => { cameraPreset(id); render(); };
  $('mode').onchange = () => { updateMode(); render(); };
  $('cutout').onchange = () => { updateMode(); render(); };
  $('ports').onchange = build;
  $('asset').onchange = () => {
    assignControls(metadata.get($('asset').value).profile);
    build().catch(fail);
  };
  $('layout').onchange = () => build().catch(fail);
  $('legacy').onclick = () => {
    const defaults = metadata.get($('asset').value).profile;
    assignControls({ ...defaults, neutralLevel: 1, raiseScale: 1, sinkScale: 1, wallSoftnessPx: 0, minSteps: 8, maxSteps: 64, refinementSteps: 5, stableGradients: false });
    applyParameters(); render();
  };
  $('reset').onclick = () => {
    assignControls(metadata.get($('asset').value).profile);
    $('az').value = 35; $('el').value = 55; $('mode').value = 'pbr'; $('cutout').checked = true; $('ports').checked = false;
    updateLight(); build().catch(fail);
  };

  await build();
  let frames = 0, sampleTime = performance.now();
  function frame(now) {
    orbit.update(); render(); frames++;
    if (now - sampleTime >= 800) {
      $('fps').textContent = String(Math.round(frames * 1000 / (now - sampleTime)));
      frames = 0; sampleTime = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
start().catch(fail);
