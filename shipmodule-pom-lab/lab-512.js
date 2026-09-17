import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createPbrDecalMaterial, enablePomDecalMaterial, updatePomDecalMaterial } from './PomDecalMaterial.js';
import { fixture512 } from './fixture-512.js';

const $ = id => document.getElementById(id);
const state = window.__POM_LAB__ = { ready: false, errors: [], size: 0, maps: {}, renderCount: 0 };
const status = $('status');
function fail(error) {
  const text = error instanceof Error ? error.message : String(error);
  state.errors.push(text);
  state.ready = false;
  status.dataset.state = 'error';
  status.textContent = `Ошибка: ${text}`;
  console.error(error);
}
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
const value = id => Number($(id).value);

async function decode(name, expected) {
  const entry = fixture512.maps[name];
  if (!entry || entry.length !== expected || typeof entry.base64 !== 'string') {
    throw new Error(`${name}: неверная схема или длина ${entry?.length}; ожидается ${expected}`);
  }
  if (entry.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.base64)) {
    throw new Error(`${name}: повреждённая сериализация`);
  }
  const text = atob(entry.base64);
  const bytes = Uint8Array.from(text, c => c.charCodeAt(0));
  if (bytes.length !== expected) throw new Error(`${name}: ${bytes.length} байт вместо ${expected}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  if (actual !== entry.sha256) throw new Error(`${name}: контрольная сумма не совпала`);
  state.maps[name] = { bytes: bytes.length, sha256: actual, verified: true };
  return bytes;
}
function expand(bytes, channels) {
  if (channels === 4) return bytes;
  const out = new Uint8Array(512 * 512 * 4);
  for (let i = 0; i < 512 * 512; i++) {
    out[i * 4] = bytes[i * channels];
    out[i * 4 + 1] = bytes[i * channels + (channels === 1 ? 0 : 1)];
    out[i * 4 + 2] = bytes[i * channels + (channels === 1 ? 0 : 2)];
    out[i * 4 + 3] = 255;
  }
  return out;
}
function texture(bytes, channels, srgb = false) {
  const result = new THREE.DataTexture(expand(bytes, channels), 512, 512, THREE.RGBAFormat, THREE.UnsignedByteType);
  result.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.flipY = false;
  result.wrapS = result.wrapT = THREE.ClampToEdgeWrapping;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.magFilter = THREE.LinearFilter;
  result.generateMipmaps = true;
  result.needsUpdate = true;
  return result;
}
function solid(r, g, b) {
  const result = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  result.colorSpace = THREE.NoColorSpace;
  result.needsUpdate = true;
  return result;
}

async function start() {
  if (fixture512.schema !== 1 || fixture512.size !== 512) throw new Error('Ожидается fixture schema 1, 512×512');
  status.textContent = 'Проверка целостности карт 512×512…';
  const count = 512 * 512;
  const [base, height, normal, orm, alpha] = await Promise.all([
    decode('base', count * 4), decode('height', count), decode('normal', count * 3),
    decode('orm', count * 3), decode('alpha', count),
  ]);
  let hMin = 255, hMax = 0, bMin = 255, bMax = 0, opaque = 0;
  for (let i = 0; i < count; i++) {
    hMin = Math.min(hMin, height[i]); hMax = Math.max(hMax, height[i]);
    bMin = Math.min(bMin, base[i * 4]); bMax = Math.max(bMax, base[i * 4]);
    if (alpha[i] > 127) opaque++;
  }
  if (hMax - hMin < 32 || bMax - bMin < 32 || opaque < count / 4) throw new Error('Карты пустые или не содержат читаемого рельефа');
  state.size = 512;
  state.heightRange = [hMin, hMax];
  state.baseRange = [bMin, bMax];
  state.coverage = opaque / count;
  state.heightSource = fixture512.heightSource;

  const maps = { base: texture(base, 4, true), height: texture(height, 1), normal: texture(normal, 3), orm: texture(orm, 3), alpha: texture(alpha, 1) };
  const white = solid(200, 204, 210), black = solid(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ canvas: $('canvas'), antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    fail(new Error('GLSL: ' + [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n')));
  };
  const gl = renderer.getContext();
  state.webglVersion = gl.getParameter(gl.VERSION);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x131923);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x728091, 1.15));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  scene.add(key, key.target);
  const camera = new THREE.PerspectiveCamera(42, 1, .05, 100);
  const controls = new OrbitControls(camera, $('canvas'));
  controls.enableDamping = true;
  controls.minDistance = 2.1;
  controls.maxDistance = 15;
  controls.target.set(0, 0, 0);
  const geometry = new THREE.PlaneGeometry(2.8, 2.8);
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  const layer = { tint: '#ffffff', opacity: 1, roughness: 1, metalness: 1, normalStrength: 1, emissiveIntensity: 0, blendMode: 'normal' };
  function material(pom) {
    const result = createPbrDecalMaterial(layer, { baseColor: maps.base, normal: maps.normal, orm: maps.orm, emissive: black });
    result.transparent = false;
    result.opacity = 1;
    result.alphaTest = 0;
    result.blending = THREE.NoBlending;
    result.side = THREE.DoubleSide;
    result.depthWrite = true;
    result.polygonOffset = false;
    result.color.setHex(0xffffff);
    result.roughness = 1;
    result.metalness = 1;
    result.aoMapIntensity = .7;
    result.normalScale.set(1, 1);
    if (pom) enablePomDecalMaterial(result, { heightMap: maps.height, heightScale: .02, minSteps: 8, maxSteps: 64, refinementSteps: 5, grazingFadeStart: .06, grazingFadeEnd: .22, maxUvOffset: .35 });
    return result;
  }
  const flat = material(false), pom = material(true);
  const debug = new THREE.MeshBasicMaterial({ map: maps.height, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, flat);
  scene.add(mesh);
  let width = 1, screenHeight = 1;
  function resize() {
    const bounds = $('view').getBoundingClientRect();
    width = Math.max(2, Math.floor(bounds.width));
    screenHeight = Math.max(1, Math.floor(bounds.height));
    renderer.setSize(width, screenHeight, false);
    camera.aspect = Math.floor(width / 2) / screenHeight;
    camera.updateProjectionMatrix();
  }
  function cameraPreset(kind) {
    const distance = Math.max(4.4, 1.65 / (Math.tan(THREE.MathUtils.degToRad(21)) * camera.aspect));
    const direction = kind === 'grazing' ? new THREE.Vector3(.96, .06, .28) : kind === 'oblique' ? new THREE.Vector3(.55, .17, 1) : new THREE.Vector3(0, 0, 1);
    camera.position.copy(direction.normalize().multiplyScalar(distance));
    controls.target.set(0, 0, 0);
    controls.update();
  }
  function parameters() {
    const minSteps = Math.min(value('minSteps'), value('maxSteps'));
    const maxSteps = Math.max(value('minSteps'), value('maxSteps'));
    updatePomDecalMaterial(pom, { heightScale: value('height'), minSteps, maxSteps, refinementSteps: value('refine') });
    $('heightOut').textContent = value('height').toFixed(3);
    $('minOut').textContent = String(minSteps);
    $('maxOut').textContent = String(maxSteps);
    $('refineOut').textContent = String(value('refine'));
    state.parameters = { heightScale: value('height'), minSteps, maxSteps, refinement: value('refine') };
  }
  function light() {
    const az = THREE.MathUtils.degToRad(value('az')), el = THREE.MathUtils.degToRad(value('el'));
    key.position.set(Math.cos(el) * Math.sin(az) * 5, Math.sin(el) * 5, Math.cos(el) * Math.cos(az) * 5);
    $('azOut').textContent = `${value('az')}°`;
    $('elOut').textContent = `${value('el')}°`;
  }
  function displayMode() {
    for (const material of [flat, pom]) {
      material.map = $('mode').value === 'clay' ? white : maps.base;
      material.alphaTest = $('cutout').checked && $('mode').value !== 'clay' ? .5 : 0;
      material.needsUpdate = true;
    }
  }
  function render() {
    renderer.setScissorTest(true);
    const split = Math.floor(width / 2);
    mesh.material = $('mode').value === 'height' ? debug : flat;
    renderer.setViewport(0, 0, split, screenHeight);
    renderer.setScissor(0, 0, split, screenHeight);
    renderer.render(scene, camera);
    mesh.material = $('mode').value === 'height' ? debug : pom;
    renderer.setViewport(split, 0, width - split, screenHeight);
    renderer.setScissor(split, 0, width - split, screenHeight);
    renderer.render(scene, camera);
    renderer.setScissorTest(false);
    state.renderCount++;
    state.programKey = pom.customProgramCacheKey();
  }
  state.render = render;
  state.cameraPreset = kind => { cameraPreset(kind); render(); };
  state.setHeight = amount => { $('height').value = String(amount); parameters(); render(); };
  state.snapshot = () => {
    render();
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = 255, max = 0, nonBackground = 0, sum = 0, sum2 = 0;
    for (let y = Math.floor(h * .2); y < h * .8; y += 4) {
      for (let x = Math.floor(w * .6); x < w * .9; x += 4) {
        const offset = (y * w + x) * 4;
        const v = pixels[offset]; min = Math.min(min, v); max = Math.max(max, v);
        nonBackground++; sum += v; sum2 += v * v;
      }
    }
    return { width: w, height: h, min, max, variance: sum2 / nonBackground - (sum / nonBackground) ** 2, glError: gl.getError() };
  };
  new ResizeObserver(resize).observe($('view'));
  resize(); cameraPreset('front'); parameters(); light();
  ['height', 'minSteps', 'maxSteps', 'refine'].forEach(id => $(id).addEventListener('input', parameters));
  ['az', 'el'].forEach(id => $(id).addEventListener('input', light));
  $('front').onclick = () => cameraPreset('front');
  $('oblique').onclick = () => cameraPreset('oblique');
  $('grazing').onclick = () => cameraPreset('grazing');
  $('mode').onchange = displayMode;
  $('cutout').onchange = displayMode;
  $('reset').onclick = () => {
    $('height').value = '.02'; $('minSteps').value = '8'; $('maxSteps').value = '64'; $('refine').value = '5';
    $('az').value = '35'; $('el').value = '55'; $('mode').value = 'pbr'; $('cutout').checked = false;
    parameters(); light(); displayMode(); cameraPreset('front');
  };
  render();
  if (state.errors.length) throw new Error('POM shader compilation failed');
  const sample = state.snapshot();
  if (sample.glError !== gl.NO_ERROR) throw new Error(`WebGL error ${sample.glError}`);
  if (sample.max - sample.min < 30 || sample.variance < 25) throw new Error('Проверка кадра: поверхность не отрисована или однотонная');
  state.ready = true;
  $('resolution').textContent = '512 × 512';
  $('integrity').textContent = '5 / 5 SHA-256 OK';
  status.dataset.state = 'ready';
  status.textContent = 'Готово: 512×512 · BaseColor + Height + Normal + ORM · справа ShipModule POM';
  let frames = 0, time = performance.now();
  function frame(now) {
    controls.update(); render(); frames++;
    if (now - time >= 800) { $('fps').textContent = String(Math.round(frames * 1000 / (now - time))); frames = 0; time = now; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
start().catch(fail);
