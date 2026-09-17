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
  height: document.querySelector('#height'),
  minSteps: document.querySelector('#minSteps'),
  maxSteps: document.querySelector('#maxSteps'),
  refine: document.querySelector('#refine'),
  az: document.querySelector('#az'),
  el: document.querySelector('#el'),
  rotate: document.querySelector('#rotate'),
  front: document.querySelector('#front'),
  grazing: document.querySelector('#grazing'),
  reset: document.querySelector('#reset'),
};

const out = {
  height: document.querySelector('#heightOut'),
  minSteps: document.querySelector('#minOut'),
  maxSteps: document.querySelector('#maxOut'),
  refine: document.querySelector('#refineOut'),
  az: document.querySelector('#azOut'),
  el: document.querySelector('#elOut'),
};

const stats = {
  fixture: document.querySelector('#fixture'),
  resolution: document.querySelector('#resolution'),
  heightConvention: document.querySelector('#heightConvention'),
  fps: document.querySelector('#fps'),
  calls: document.querySelector('#calls'),
  triangles: document.querySelector('#triangles'),
};

const num = (el) => Number(el.value);

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function updateLabels() {
  out.height.textContent = num(ui.height).toFixed(3);
  out.minSteps.textContent = String(Math.round(num(ui.minSteps)));
  out.maxSteps.textContent = String(Math.round(num(ui.maxSteps)));
  out.refine.textContent = String(Math.round(num(ui.refine)));
  out.az.textContent = `${Math.round(num(ui.az))}°`;
  out.el.textContent = `${Math.round(num(ui.el))}°`;
}

function flattenChunks(chunks) {
  if (!Array.isArray(chunks)) throw new Error('P-07 numeric chunks are missing.');
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function takeExact(raw, expected, label) {
  if (raw.length < expected) {
    throw new Error(`P-07 ${label} length ${raw.length}, expected at least ${expected}.`);
  }
  return raw.length === expected ? raw : raw.subarray(0, expected);
}

function isOutside(mask, index) {
  return ((mask[index >>> 3] >>> (index & 7)) & 1) !== 0;
}

function dataTexture(bytes, size, colorSpace = THREE.NoColorSpace) {
  const texture = new THREE.DataTexture(
    bytes,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function solidTexture(r, g, b, a = 255) {
  const texture = new THREE.DataTexture(
    new Uint8Array([r, g, b, a]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildFixture() {
  const size = P07_HATCH_FIXTURE.resolution;
  const pixelCount = size * size;
  const expectedMaskBytes = Math.ceil(pixelCount / 8);

  const rawHeight = flattenChunks(P07_HATCH_FIXTURE.heightChunks);
  const rawMask = flattenChunks(P07_HATCH_FIXTURE.outsideMaskChunks);
  const height = takeExact(rawHeight, pixelCount, 'height');
  const mask = takeExact(rawMask, expectedMaskBytes, 'mask');

  const baseRGBA = new Uint8Array(pixelCount * 4);
  const heightRGBA = new Uint8Array(pixelCount * 4);
  const normalRGBA = new Uint8Array(pixelCount * 4);

  for (let i = 0; i < pixelCount; i += 1) {
    const h = height[i];
    const o = i * 4;

    heightRGBA[o] = h;
    heightRGBA[o + 1] = h;
    heightRGBA[o + 2] = h;
    heightRGBA[o + 3] = 255;

    if (isOutside(mask, i)) {
      baseRGBA[o] = 9;
      baseRGBA[o + 1] = 13;
      baseRGBA[o + 2] = 18;
    } else {
      const c = Math.max(48, Math.min(230, Math.round(48 + h * 0.72)));
      baseRGBA[o] = c;
      baseRGBA[o + 1] = c;
      baseRGBA[o + 2] = Math.min(238, c + 5);
    }
    baseRGBA[o + 3] = 255;
  }

  const sample = (x, y) => {
    const px = Math.max(0, Math.min(size - 1, x));
    const py = Math.max(0, Math.min(size - 1, y));
    return height[py * size + px] / 255;
  };

  const strength = size * 0.045;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let nx = -(sample(x + 1, y) - sample(x - 1, y)) * strength;
      let ny = -(sample(x, y + 1) - sample(x, y - 1)) * strength;
      const len = Math.hypot(nx, ny, 1) || 1;
      nx /= len;
      ny /= len;
      const nz = 1 / len;
      const o = (y * size + x) * 4;
      normalRGBA[o] = Math.round((nx * 0.5 + 0.5) * 255);
      normalRGBA[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalRGBA[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normalRGBA[o + 3] = 255;
    }
  }

  return {
    size,
    paddingInfo: `height ${rawHeight.length}→${pixelCount}, mask ${rawMask.length}→${expectedMaskBytes}`,
    baseColor: dataTexture(baseRGBA, size, THREE.SRGBColorSpace),
    heightMap: dataTexture(heightRGBA, size),
    normalMap: dataTexture(normalRGBA, size),
    orm: solidTexture(255, 190, 16),
    emissive: solidTexture(0, 0, 0),
  };
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d12);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
camera.position.set(0, 0.15, 6.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
controls.minDistance = 2.4;
controls.maxDistance = 11;

scene.add(new THREE.HemisphereLight(0xb7d0ee, 0x11151c, 1.05));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
scene.add(keyLight, keyLight.target);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 7),
  new THREE.MeshStandardMaterial({ color: 0x101720, roughness: 0.96, metalness: 0.02 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -1.8, -0.65);
scene.add(floor);

const dividerGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, -1.42, 0.13),
  new THREE.Vector3(0, 1.42, 0.13),
]);
scene.add(new THREE.Line(
  dividerGeometry,
  new THREE.LineBasicMaterial({ color: 0x38516c, transparent: true, opacity: 0.6 }),
));

let fixture;
let flatMaterial;
let pomMaterial;

function panelGeometry() {
  const geometry = new THREE.PlaneGeometry(2.7, 2.7);
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  return geometry;
}

function createMaterial(pom = false) {
  const material = createPbrDecalMaterial(
    { tint: 0xffffff },
    {
      baseColor: fixture.baseColor,
      normal: fixture.normalMap,
      orm: fixture.orm,
      emissive: fixture.emissive,
    },
  );

  material.transparent = false;
  material.alphaTest = 0;
  material.opacity = 1;
  material.blending = THREE.NoBlending;
  material.side = THREE.DoubleSide;
  material.depthTest = true;
  material.depthWrite = true;
  material.polygonOffset = false;
  material.roughness = 0.74;
  material.metalness = 0.06;

  if (pom) {
    enablePomDecalMaterial(material, {
      heightMap: fixture.heightMap,
      heightScale: num(ui.height),
      minSteps: num(ui.minSteps),
      maxSteps: num(ui.maxSteps),
      refinementSteps: num(ui.refine),
      grazingFadeStart: 0.06,
      grazingFadeEnd: 0.22,
      maxUvOffset: 0.35,
    });
  }
  return material;
}

function updatePom() {
  if (!pomMaterial) return;
  updatePomDecalMaterial(pomMaterial, {
    heightScale: num(ui.height),
    minSteps: Math.min(num(ui.minSteps), num(ui.maxSteps)),
    maxSteps: Math.max(num(ui.minSteps), num(ui.maxSteps)),
    refinementSteps: num(ui.refine),
  });
}

function updateLight() {
  const azimuth = THREE.MathUtils.degToRad(num(ui.az));
  const elevation = THREE.MathUtils.degToRad(num(ui.el));
  const radius = 5;
  keyLight.position.set(
    Math.cos(elevation) * Math.sin(azimuth) * radius,
    Math.sin(elevation) * radius,
    Math.cos(elevation) * Math.cos(azimuth) * radius,
  );
  keyLight.target.position.set(0, 0, 0);
}

function setCamera(x, y, z) {
  camera.position.set(x, y, z);
  controls.target.set(0, 0, 0);
  controls.update();
}

function reset() {
  ui.height.value = String(P07_HATCH_FIXTURE.defaultHeightScale);
  ui.minSteps.value = '8';
  ui.maxSteps.value = '48';
  ui.refine.value = '4';
  ui.az.value = '35';
  ui.el.value = '55';
  updateLabels();
  updatePom();
  updateLight();
  setCamera(0, 0.15, 6.5);
}

function resize() {
  const width = Math.max(1, view.clientWidth);
  const height = Math.max(1, view.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

[ui.height, ui.minSteps, ui.maxSteps, ui.refine].forEach((el) => {
  el.addEventListener('input', () => {
    updateLabels();
    updatePom();
  });
});
[ui.az, ui.el].forEach((el) => {
  el.addEventListener('input', () => {
    updateLabels();
    updateLight();
  });
});
ui.front.addEventListener('click', () => setCamera(0, 0.15, 6.5));
ui.grazing.addEventListener('click', () => setCamera(5.7, 0.15, 1.55));
ui.reset.addEventListener('click', reset);

updateLabels();
updateLight();

try {
  setStatus('Building P-07 from numeric byte chunks…');
  fixture = buildFixture();
  flatMaterial = createMaterial(false);
  pomMaterial = createMaterial(true);

  const flatMesh = new THREE.Mesh(panelGeometry(), flatMaterial);
  const pomMesh = new THREE.Mesh(panelGeometry(), pomMaterial);
  flatMesh.position.x = -1.55;
  pomMesh.position.x = 1.55;
  scene.add(flatMesh, pomMesh);

  if (stats.fixture) stats.fixture.textContent = P07_HATCH_FIXTURE.label;
  if (stats.resolution) stats.resolution.textContent = `${fixture.size}² (${fixture.paddingInfo})`;
  if (stats.heightConvention) {
    stats.heightConvention.textContent = P07_HATCH_FIXTURE.heightConvention.replaceAll('_', ' ');
  }
  setStatus('Ready. Numeric DataTexture path active; trailing serialization padding is safely trimmed.');
} catch (error) {
  console.error(error);
  setStatus(`Error: ${error?.message || String(error)}`, true);
}

let frames = 0;
let sampleStart = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  controls.autoRotate = ui.rotate.checked;
  controls.autoRotateSpeed = 0.7;
  controls.update();
  renderer.render(scene, camera);
  frames += 1;
  const elapsed = now - sampleStart;
  if (elapsed >= 500) {
    stats.fps.textContent = String(Math.round(frames * 1000 / elapsed));
    stats.calls.textContent = String(renderer.info.render.calls);
    stats.triangles.textContent = String(renderer.info.render.triangles);
    frames = 0;
    sampleStart = now;
  }
}
requestAnimationFrame(animate);
