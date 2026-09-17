import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  createPbrDecalMaterial,
  enablePomDecalMaterial,
  updatePomDecalMaterial,
} from './PomDecalMaterial.js';

const canvas = document.querySelector('#canvas');
const view = document.querySelector('#view');
const status = document.querySelector('#status');

const FIXTURES = Object.freeze({
  p07: {
    id: 'p07',
    label: 'P-07 Maintenance Hatch',
    source: 'ShipModule P-07 authored fixture',
    baseColorUrl: './fixtures/p07_hatch/BaseColorAlpha.webp',
    heightUrl: './fixtures/p07_hatch/Height.webp',
    defaultHeightScale: 0.035,
    repeatable: false,
    hasAlpha: true,
    heightConvention: 'WHITE_HIGH_BLACK_LOW',
  },
  rock: {
    id: 'rock',
    label: 'Rock Wall 10',
    source: 'mfagerlund / rock_wall_10',
    defaultHeightScale: 0.12,
    repeatable: true,
    hasAlpha: false,
    heightConvention: 'WHITE_HIGH_BLACK_LOW',
  },
});

const ui = {
  fixtureSelect: document.querySelector('#fixtureSelect'),
  height: document.querySelector('#height'),
  minSteps: document.querySelector('#minSteps'),
  maxSteps: document.querySelector('#maxSteps'),
  refine: document.querySelector('#refine'),
  tile: document.querySelector('#tile'),
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
  tile: document.querySelector('#tileOut'),
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

const number = (element) => Number(element.value);

function activeFixtureDefinition() {
  return FIXTURES[ui.fixtureSelect.value] || FIXTURES.p07;
}

function updateLabels() {
  out.height.textContent = number(ui.height).toFixed(3);
  out.minSteps.textContent = String(Math.round(number(ui.minSteps)));
  out.maxSteps.textContent = String(Math.round(number(ui.maxSteps)));
  out.refine.textContent = String(Math.round(number(ui.refine)));
  out.tile.textContent = `${number(ui.tile).toFixed(2)}×`;
  out.az.textContent = `${Math.round(number(ui.az))}°`;
  out.el.textContent = `${Math.round(number(ui.el))}°`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to decode fixture image: ${src}`));
    image.src = src;
  });
}

function pixelsFrom(image, size) {
  const surface = document.createElement('canvas');
  surface.width = size;
  surface.height = size;
  const context = surface.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);
  return { surface, context, pixels: context.getImageData(0, 0, size, size) };
}

function setTextureAddressing(texture, repeatable) {
  texture.wrapS = repeatable ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = repeatable ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.repeat.set(1, 1);
  texture.needsUpdate = true;
  return texture;
}

function makeBaseColorTexture(surface, repeatable) {
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  return setTextureAddressing(texture, repeatable);
}

function makeHeightTexture(imageData, size, repeatable) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const value = imageData.data[i * 4];
    const o = i * 4;
    data[o] = value;
    data[o + 1] = value;
    data[o + 2] = value;
    data[o + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return setTextureAddressing(texture, repeatable);
}

function makeNormalTexture(heightPixels, size, repeatable) {
  const source = heightPixels.data;
  const data = new Uint8Array(size * size * 4);
  const h = (x, y) => {
    const px = repeatable ? (x + size) % size : Math.max(0, Math.min(size - 1, x));
    const py = repeatable ? (y + size) % size : Math.max(0, Math.min(size - 1, y));
    return source[(py * size + px) * 4] / 255;
  };
  const bump = 0.10 * size * 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let nx = -(h(x + 1, y) - h(x - 1, y)) * bump;
      let ny = -(h(x, y + 1) - h(x, y - 1)) * bump;
      const length = Math.hypot(nx, ny, 1) || 1;
      nx /= length;
      ny /= length;
      const nz = 1 / length;
      const o = (y * size + x) * 4;
      data[o] = Math.round((nx * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return setTextureAddressing(texture, repeatable);
}

function solidTexture(r, g, b, a = 255) {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// The authored P-07 height image has a black exterior background. POM interprets
// black as a deep recess, so leaving it untouched would create a false moat around
// the hatch. Flood-fill only dark pixels connected to the texture border and turn
// those pixels into the high/source surface. The same mask becomes BaseColor alpha.
function sanitizeP07Exterior(base, height, size) {
  const outside = new Uint8Array(size * size);
  const queue = new Int32Array(size * size);
  let head = 0;
  let tail = 0;
  const threshold = 18;
  const heightData = height.pixels.data;
  const isExteriorCandidate = (index) => heightData[index * 4] <= threshold;
  const enqueue = (index) => {
    if (outside[index] || !isExteriorCandidate(index)) return;
    outside[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < size; x += 1) {
    enqueue(x);
    enqueue((size - 1) * size + x);
  }
  for (let y = 0; y < size; y += 1) {
    enqueue(y * size);
    enqueue(y * size + size - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % size;
    const y = Math.floor(index / size);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < size) enqueue(index + 1);
    if (y > 0) enqueue(index - size);
    if (y + 1 < size) enqueue(index + size);
  }

  const baseData = base.pixels.data;
  for (let i = 0; i < outside.length; i += 1) {
    const o = i * 4;
    if (outside[i]) {
      heightData[o] = 255;
      heightData[o + 1] = 255;
      heightData[o + 2] = 255;
      heightData[o + 3] = 255;
      baseData[o + 3] = 0;
    } else {
      baseData[o + 3] = 255;
    }
  }
  base.context.putImageData(base.pixels, 0, 0);
  height.context.putImageData(height.pixels, 0, 0);
}

async function createP07Fixture() {
  const definition = FIXTURES.p07;
  const [albedoImage, heightImage] = await Promise.all([
    loadImage(definition.baseColorUrl),
    loadImage(definition.heightUrl),
  ]);
  const nativeSize = Math.min(
    albedoImage.naturalWidth || albedoImage.width,
    heightImage.naturalWidth || heightImage.width,
  );
  const size = Math.min(nativeSize, 1024);
  const albedo = pixelsFrom(albedoImage, size);
  const height = pixelsFrom(heightImage, size);
  sanitizeP07Exterior(albedo, height, size);

  const baseColor = makeBaseColorTexture(albedo.surface, false);
  const heightMap = makeHeightTexture(height.pixels, size, false);
  const normalMap = makeNormalTexture(height.pixels, size, false);
  // Online POM validation focuses on relief accuracy. Use a neutral PBR response
  // while the full authored AO/Roughness/Metallic pack remains the source asset.
  const orm = solidTexture(255, 190, 24, 255);
  const emissive = solidTexture(0, 0, 0, 255);
  return {
    ...definition,
    nativeSize,
    size,
    baseColor,
    heightMap,
    normalMap,
    orm,
    emissive,
    dispose() {
      [baseColor, heightMap, normalMap, orm, emissive].forEach((texture) => texture.dispose());
    },
  };
}

async function createRockFixture() {
  const definition = FIXTURES.rock;
  const source = window.ROCKWALL;
  if (!source?.albedo || !source?.height) {
    throw new Error('Pinned mfagerlund ROCKWALL fixture was not loaded.');
  }
  const [albedoImage, heightImage] = await Promise.all([
    loadImage(source.albedo),
    loadImage(source.height),
  ]);
  const nativeSize = Math.min(
    albedoImage.naturalWidth || albedoImage.width,
    heightImage.naturalWidth || heightImage.height,
  );
  const size = Math.min(nativeSize, 2048);
  const albedo = pixelsFrom(albedoImage, size);
  const height = pixelsFrom(heightImage, size);
  const baseColor = makeBaseColorTexture(albedo.surface, true);
  const heightMap = makeHeightTexture(height.pixels, size, true);
  const normalMap = makeNormalTexture(height.pixels, size, true);
  const orm = solidTexture(255, 184, 0, 255);
  const emissive = solidTexture(0, 0, 0, 255);
  return {
    ...definition,
    nativeSize,
    size,
    baseColor,
    heightMap,
    normalMap,
    orm,
    emissive,
    dispose() {
      [baseColor, heightMap, normalMap, orm, emissive].forEach((texture) => texture.dispose());
    },
  };
}

async function createFixture(id) {
  return id === 'rock' ? createRockFixture() : createP07Fixture();
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d12);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
camera.position.set(0, 0.2, 6.5);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 0);
controls.minDistance = 2.4;
controls.maxDistance = 11;

scene.add(new THREE.HemisphereLight(0xb7d0ee, 0x11151c, 1.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 4.2);
scene.add(keyLight);
scene.add(keyLight.target);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 7),
  new THREE.MeshStandardMaterial({ color: 0x101720, roughness: 0.96, metalness: 0.02 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -1.8, -0.6);
scene.add(floor);

const dividerGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, -1.4, 0.12),
  new THREE.Vector3(0, 1.4, 0.12),
]);
scene.add(new THREE.Line(
  dividerGeometry,
  new THREE.LineBasicMaterial({ color: 0x38516c, transparent: true, opacity: 0.6 }),
));

let fixture = null;
let normalMaterial = null;
let pomMaterial = null;
let normalMesh = null;
let pomMesh = null;
let fixtureRevision = 0;

function makePanelGeometry() {
  const geometry = new THREE.PlaneGeometry(2.7, 2.7);
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  return geometry;
}

function makeMaterial({ pom = false } = {}) {
  const material = createPbrDecalMaterial({ tint: 0xffffff }, {
    baseColor: fixture.baseColor,
    normal: fixture.normalMap,
    orm: fixture.orm,
    emissive: fixture.emissive,
  });
  material.transparent = fixture.hasAlpha === true;
  material.alphaTest = fixture.hasAlpha === true ? 0.02 : 0;
  material.depthWrite = true;
  material.polygonOffset = false;
  material.roughness = 0.72;
  material.metalness = 0;
  material.normalScale.setScalar(1);
  if (pom) {
    enablePomDecalMaterial(material, {
      heightMap: fixture.heightMap,
      heightScale: number(ui.height),
      minSteps: number(ui.minSteps),
      maxSteps: number(ui.maxSteps),
      refinementSteps: number(ui.refine),
    });
  }
  return material;
}

function rebuildMaterials() {
  const previousNormal = normalMaterial;
  const previousPom = pomMaterial;
  normalMaterial = makeMaterial({ pom: false });
  pomMaterial = makeMaterial({ pom: true });
  if (!normalMesh) {
    normalMesh = new THREE.Mesh(makePanelGeometry(), normalMaterial);
    normalMesh.position.x = -1.55;
    scene.add(normalMesh);
  } else {
    normalMesh.material = normalMaterial;
  }
  if (!pomMesh) {
    pomMesh = new THREE.Mesh(makePanelGeometry(), pomMaterial);
    pomMesh.position.x = 1.55;
    scene.add(pomMesh);
  } else {
    pomMesh.material = pomMaterial;
  }
  previousNormal?.dispose?.();
  previousPom?.dispose?.();
}

function updatePom() {
  if (!pomMaterial) return;
  const minimum = Math.min(number(ui.minSteps), number(ui.maxSteps));
  const maximum = Math.max(number(ui.minSteps), number(ui.maxSteps));
  updatePomDecalMaterial(pomMaterial, {
    heightScale: number(ui.height),
    minSteps: minimum,
    maxSteps: maximum,
    refinementSteps: number(ui.refine),
  });
}

function updateTiling() {
  if (!fixture) return;
  const repeat = fixture.repeatable ? number(ui.tile) : 1;
  ui.tile.disabled = !fixture.repeatable;
  [fixture.baseColor, fixture.heightMap, fixture.normalMap].forEach((texture) => {
    texture.repeat.set(repeat, repeat);
    texture.needsUpdate = true;
  });
  if (!fixture.repeatable) {
    ui.tile.value = '1';
    updateLabels();
  }
}

function updateLight() {
  const azimuth = THREE.MathUtils.degToRad(number(ui.az));
  const elevation = THREE.MathUtils.degToRad(number(ui.el));
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

function resize() {
  const width = Math.max(1, view.clientWidth);
  const height = Math.max(1, view.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

async function switchFixture(id, { resetView = true } = {}) {
  const revision = ++fixtureRevision;
  const definition = FIXTURES[id] || FIXTURES.p07;
  status.style.color = '';
  status.textContent = `Loading ${definition.label}…`;
  ui.fixtureSelect.disabled = true;
  try {
    const nextFixture = await createFixture(definition.id);
    if (revision !== fixtureRevision) {
      nextFixture.dispose();
      return;
    }
    fixture?.dispose?.();
    fixture = nextFixture;
    ui.height.value = String(definition.defaultHeightScale);
    ui.tile.value = '1';
    updateLabels();
    updateTiling();
    rebuildMaterials();
    updatePom();
    stats.fixture.textContent = definition.label;
    stats.resolution.textContent = `${fixture.size}² (source ${fixture.nativeSize}²)`;
    stats.heightConvention.textContent = definition.heightConvention;
    status.textContent = `${definition.label} ready. Compare left PBR with right ShipModule POM; use Grazing to stress the ray marcher.`;
    if (resetView) setCamera(0, 0.2, 6.5);
  } catch (error) {
    console.error(error);
    status.textContent = `Error: ${error?.message || error}`;
    status.style.color = '#ffb0a5';
  } finally {
    if (revision === fixtureRevision) ui.fixtureSelect.disabled = false;
  }
}

[ui.height, ui.minSteps, ui.maxSteps, ui.refine].forEach((element) => {
  element.addEventListener('input', () => {
    updateLabels();
    updatePom();
  });
});
ui.tile.addEventListener('input', () => {
  updateLabels();
  updateTiling();
});
[ui.az, ui.el].forEach((element) => {
  element.addEventListener('input', () => {
    updateLabels();
    updateLight();
  });
});
ui.fixtureSelect.addEventListener('change', () => switchFixture(ui.fixtureSelect.value));
ui.front.addEventListener('click', () => setCamera(0, 0.15, 6.5));
ui.grazing.addEventListener('click', () => setCamera(5.7, 0.15, 1.55));
ui.reset.addEventListener('click', () => {
  const definition = activeFixtureDefinition();
  ui.height.value = String(definition.defaultHeightScale);
  ui.minSteps.value = '8';
  ui.maxSteps.value = '48';
  ui.refine.value = '4';
  ui.tile.value = '1';
  ui.az.value = '35';
  ui.el.value = '55';
  updateLabels();
  updatePom();
  updateTiling();
  updateLight();
  setCamera(0, 0.2, 6.5);
});

updateLabels();
updateLight();
switchFixture(ui.fixtureSelect.value, { resetView: false });

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
