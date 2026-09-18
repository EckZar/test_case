import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createPbrDecalMaterial, enablePomDecalMaterial, updatePomDecalMaterial } from './PomDecalMaterial.js';
import { preparePomReliefMaps, getPomReliefBounds } from './PomReliefProfile.js';
import { pullRailMetadata as metadata, pullRailMapMeta } from './pull-rail-fixture.js';
import { loadPullRailMaps, solidTexture, toRgba } from './pull-rail-codec.js';
import { CONTROL_IDS, readControls, assignControls, updateControlOutputs } from './pull-rail-controls.js';

const $ = id => document.getElementById(id);
const status = $('status');
const state = window.__POM_ASSET_LAB__ = { ready: false, errors: [], renderCount: 0, version: 'pull-rail-v1' };
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

async function start() {
  status.textContent = `Проверка embedded-карт ${metadata.width} × ${metadata.height}…`;
  const fixture = await loadPullRailMaps(metadata, pullRailMapMeta);
  const { width, height, count, sourceHeight, alpha, textures, heightData } = fixture;
  const black = solidTexture(0, 0, 0), white = solidTexture(200, 204, 210);

  const renderer = new THREE.WebGLRenderer({ canvas: $('canvas'), antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => fail(new Error('GLSL: ' + [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n')));
  const gl = renderer.getContext();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const texture of Object.values(textures)) texture.anisotropy = anisotropy;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101720);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x647386, 1.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  scene.add(keyLight, keyLight.target);

  const camera = new THREE.PerspectiveCamera(42, 1, .05, 100);
  const orbit = new OrbitControls(camera, $('canvas'));
  orbit.enableDamping = true;
  orbit.minDistance = 4;
  orbit.maxDistance = 18;
  const modelHeight = 4.9, modelWidth = modelHeight * width / height;
  const geometry = new THREE.PlaneGeometry(modelWidth, modelHeight);
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  const defaults = { ...metadata.profile };

  function createMaterial(pomEnabled) {
    const material = createPbrDecalMaterial({ tint: '#ffffff' }, { baseColor: textures.base, normal: textures.normal, orm: textures.orm, emissive: black });
    Object.assign(material, { transparent: false, opacity: 1, alphaTest: .38, blending: THREE.NoBlending, side: THREE.DoubleSide, depthWrite: true, polygonOffset: false, roughness: 1, metalness: 1, aoMapIntensity: .8 });
    material.normalScale.set(1, 1);
    if (pomEnabled) enablePomDecalMaterial(material, { heightMap: textures.height, ...defaults });
    return material;
  }

  const flatMaterial = createMaterial(false);
  const pomMaterial = createMaterial(true);
  const heightMaterial = new THREE.MeshBasicMaterial({ map: textures.height, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, flatMaterial);
  scene.add(mesh);

  let viewportWidth = 1, viewportHeight = 1, fieldKey = '', scheduled = 0;
  function resize() {
    const bounds = $('view').getBoundingClientRect();
    viewportWidth = Math.max(2, Math.floor(bounds.width));
    viewportHeight = Math.max(1, Math.floor(bounds.height));
    renderer.setSize(viewportWidth, viewportHeight, false);
    camera.aspect = Math.floor(viewportWidth / 2) / viewportHeight;
    camera.updateProjectionMatrix();
  }
  function cameraPreset(kind) {
    const distance = Math.max(7, modelHeight * .54 / Math.tan(THREE.MathUtils.degToRad(camera.fov * .5)));
    const direction = kind === 'grazing' ? new THREE.Vector3(.94, .04, .34) : kind === 'oblique' ? new THREE.Vector3(.55, .1, 1) : new THREE.Vector3(0, 0, 1);
    camera.position.copy(direction.normalize().multiplyScalar(distance));
    orbit.target.set(0, 0, 0);
    orbit.update();
  }
  function applyParameters() {
    const parameters = readControls();
    const nextFieldKey = JSON.stringify([parameters.heightScale, parameters.neutralLevel, parameters.raiseScale, parameters.sinkScale, parameters.wallSoftnessPx]);
    if (nextFieldKey !== fieldKey) {
      const prepared = preparePomReliefMaps(sourceHeight, width, height, parameters, alpha);
      for (let i = 0; i < count; i++) {
        const value = THREE.DataUtils.toHalfFloat(prepared.heightField[i]);
        heightData.set([value, value, value, 15360], i * 4);
      }
      textures.height.needsUpdate = true;
      textures.normal.image.data = toRgba(prepared.normal, 3);
      textures.normal.needsUpdate = true;
      fieldKey = nextFieldKey;
      state.fieldBuilds = (state.fieldBuilds || 0) + 1;
    }
    updatePomDecalMaterial(pomMaterial, parameters);
    updateControlOutputs(parameters);
    state.parameters = parameters;
    state.bounds = getPomReliefBounds(parameters);
    state.programKey = pomMaterial.customProgramCacheKey();
    $('range').textContent = `+${(state.bounds.top * parameters.heightScale).toFixed(4)} / ${(state.bounds.bottom * parameters.heightScale).toFixed(4)}`;
  }
  function scheduleParameters() {
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(applyParameters);
  }
  function updateLight() {
    const azimuth = THREE.MathUtils.degToRad(Number($('az').value));
    const elevation = THREE.MathUtils.degToRad(Number($('el').value));
    keyLight.position.set(Math.cos(elevation) * Math.sin(azimuth) * 5, Math.sin(elevation) * 5, Math.cos(elevation) * Math.cos(azimuth) * 5);
    $('azOut').textContent = `${$('az').value}°`;
    $('elOut').textContent = `${$('el').value}°`;
  }
  function updateMode() {
    for (const material of [flatMaterial, pomMaterial]) {
      material.map = $('mode').value === 'clay' ? white : textures.base;
      material.alphaTest = $('cutout').checked ? .38 : 0;
      material.needsUpdate = true;
    }
  }
  function render() {
    renderer.setScissorTest(true);
    const split = Math.floor(viewportWidth / 2);
    mesh.material = $('mode').value === 'height' ? heightMaterial : flatMaterial;
    renderer.setViewport(0, 0, split, viewportHeight);
    renderer.setScissor(0, 0, split, viewportHeight);
    renderer.render(scene, camera);
    mesh.material = $('mode').value === 'height' ? heightMaterial : pomMaterial;
    renderer.setViewport(split, 0, viewportWidth - split, viewportHeight);
    renderer.setScissor(split, 0, viewportWidth - split, viewportHeight);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    state.renderCount++;
  }
  function snapshot() {
    render();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = 255, max = 0, sum = 0, square = 0, samples = 0, hash = 2166136261;
    for (let y = Math.floor(h * .12); y < h * .88; y += 3) for (let x = Math.floor(w * .58); x < w * .94; x += 3) {
      const value = pixels[(y * w + x) * 4];
      min = Math.min(min, value); max = Math.max(max, value); sum += value; square += value * value; samples++;
      hash = Math.imul(hash ^ value, 16777619) >>> 0;
    }
    return { min, max, variance: square / samples - (sum / samples) ** 2, hash, width: w, height: h, glError: gl.getError() };
  }

  Object.assign(state, {
    snapshot, render,
    cameraPreset: kind => { cameraPreset(kind); render(); },
    setParameters: parameters => { assignControls(parameters); applyParameters(); render(); },
    uniforms: () => Object.fromEntries(Object.entries(pomMaterial.userData.pomUniforms).filter(([key]) => key !== 'pomHeightMap').map(([key, value]) => [key, value.value])),
    manifest: metadata,
    maps: Object.fromEntries(Object.entries(pullRailMapMeta).map(([key, value]) => [key, { length: value.length, sha256: value.sha256, verified: true }])),
  });

  assignControls(defaults);
  new ResizeObserver(resize).observe($('view'));
  resize(); cameraPreset('front'); applyParameters(); updateLight(); updateMode();
  for (const id of Object.values(CONTROL_IDS)) $(id).addEventListener('input', scheduleParameters);
  $('stableGradients').onchange = applyParameters;
  $('az').oninput = $('el').oninput = updateLight;
  for (const id of ['front', 'oblique', 'grazing']) $(id).onclick = () => cameraPreset(id);
  $('mode').onchange = updateMode;
  $('cutout').onchange = updateMode;
  $('legacy').onclick = () => { assignControls({ ...defaults, neutralLevel: 1, raiseScale: 1, sinkScale: 1, wallSoftnessPx: 0, minSteps: 8, maxSteps: 64, refinementSteps: 5, stableGradients: false }); applyParameters(); };
  $('reset').onclick = () => { assignControls(defaults); $('az').value = 35; $('el').value = 55; $('mode').value = 'pbr'; $('cutout').checked = true; applyParameters(); updateLight(); updateMode(); cameraPreset('front'); };

  render();
  const sample = snapshot();
  if (state.errors.length || sample.glError !== gl.NO_ERROR || sample.variance < 20 || sample.max - sample.min < 25) throw new Error('Проверка кадра: ассет не отрисован');
  Object.assign(state, { ready: true, assetId: metadata.id, resolution: [width, height] });
  $('assetName').textContent = metadata.label;
  $('resolution').textContent = `${width} × ${height}`;
  $('integrity').textContent = '2 / 2 SHA-256 OK';
  $('shader').textContent = 'POM v4';
  status.dataset.state = 'ready';
  status.textContent = 'Готово · Pull Rail Panel 01 · embedded maps · POM v4';

  let frames = 0, sampleTime = performance.now();
  function frame(now) {
    orbit.update(); render(); frames++;
    if (now - sampleTime >= 800) { $('fps').textContent = String(Math.round(frames * 1000 / (now - sampleTime))); frames = 0; sampleTime = now; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
start().catch(fail);
