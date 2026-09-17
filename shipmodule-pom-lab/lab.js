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

const ui = {
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
  fps: document.querySelector('#fps'),
  calls: document.querySelector('#calls'),
  triangles: document.querySelector('#triangles'),
};

const number = (element) => Number(element.value);

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
    image.onerror = () => reject(new Error('Unable to decode the rock_wall_10 reference image.'));
    image.src = src;
  });
}

function pixelsFrom(image, size) {
  const surface = document.createElement('canvas');
  surface.width = size;
  surface.height = size;
  const context = surface.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  return { surface, pixels: context.getImageData(0, 0, size, size) };
}

function makeBaseColorTexture(surface) {
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  return texture;
}

function makeHeightTexture(imageData, size) {
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
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function makeNormalTexture(heightPixels, size) {
  const source = heightPixels.data;
  const data = new Uint8Array(size * size * 4);
  const h = (x, y) => {
    const px = (x + size) % size;
    const py = (y + size) % size;
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
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function solidTexture(r, g, b, a = 255) {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

async function createReferenceFixture() {
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
    heightImage.naturalWidth || heightImage.width,
  );
  const size = Math.min(nativeSize, 2048);
  const albedo = pixelsFrom(albedoImage, size);
  const height = pixelsFrom(heightImage, size);
  const baseColor = makeBaseColorTexture(albedo.surface);
  const heightMap = makeHeightTexture(height.pixels, size);
  const normalMap = makeNormalTexture(height.pixels, size);
  const orm = solidTexture(255, 184, 0, 255);
  const emissive = solidTexture(0, 0, 0, 255);
  return {
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
  material.transparent = false;
  material.alphaTest = 0;
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
  const repeat = number(ui.tile);
  [fixture.baseColor, fixture.heightMap, fixture.normalMap].forEach((texture) => {
    texture.repeat.set(repeat, repeat);
    texture.needsUpdate = true;
  });
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
ui.front.addEventListener('click', () => setCamera(0, 0.15, 6.5));
ui.grazing.addEventListener('click', () => setCamera(5.7, 0.15, 1.55));
ui.reset.addEventListener('click', () => {
  ui.height.value = '0.12';
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

async function init() {
  try {
    status.textContent = 'Decoding pinned rock_wall_10 fixture and deriving the normal map…';
    fixture = await createReferenceFixture();
    stats.fixture.textContent = 'rock_wall_10 / pinned';
    stats.resolution.textContent = `${fixture.size}² (source ${fixture.nativeSize}²)`;
    updateTiling();

    normalMaterial = makeMaterial({ pom: false });
    pomMaterial = makeMaterial({ pom: true });
    normalMesh = new THREE.Mesh(makePanelGeometry(), normalMaterial);
    pomMesh = new THREE.Mesh(makePanelGeometry(), pomMaterial);
    normalMesh.position.x = -1.55;
    pomMesh.position.x = 1.55;
    scene.add(normalMesh, pomMesh);
    status.textContent = 'Ready. Use Grazing view, then increase Height scale to stress the ShipModule ray marcher.';
  } catch (error) {
    console.error(error);
    status.textContent = `Error: ${error?.message || error}`;
    status.style.color = '#ffb0a5';
  }
}
init();

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
