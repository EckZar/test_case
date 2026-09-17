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
  out.az.textContent = `${Math.round(number(ui.az))}°`;
  out.el.textContent = `${Math.round(number(ui.el))}°`;
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function configureTexture(texture, colorSpace = THREE.NoColorSpace) {
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function solidTexture(r, g, b, a = 255) {
  const texture = new THREE.DataTexture(
    new Uint8Array([r, g, b, a]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

async function loadEmbeddedFixture() {
  const loader = new THREE.TextureLoader();
  const [baseColor, heightMap] = await Promise.all([
    loader.loadAsync(P07_HATCH_FIXTURE.baseColor),
    loader.loadAsync(P07_HATCH_FIXTURE.height),
  ]);

  configureTexture(baseColor, THREE.SRGBColorSpace);
  configureTexture(heightMap, THREE.NoColorSpace);

  const normalMap = solidTexture(128, 128, 255, 255);
  const orm = solidTexture(255, 190, 32, 255);
  const emissive = solidTexture(0, 0, 0, 255);

  return {
    label: P07_HATCH_FIXTURE.label,
    resolution: P07_HATCH_FIXTURE.resolution,
    heightConvention: P07_HATCH_FIXTURE.heightConvention,
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
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 0);
controls.minDistance = 2.4;
controls.maxDistance = 11;

scene.add(new THREE.HemisphereLight(0xb7d0ee, 0x11151c, 1.05));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
scene.add(keyLight);
scene.add(keyLight.target);

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

let fixture = null;
let flatMaterial = null;
let pomMaterial = null;
let flatMesh = null;
let pomMesh = null;

function panelGeometry() {
  const geometry = new THREE.PlaneGeometry(2.7, 2.7);
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  return geometry;
}

function createMaterial({ pom = false } = {}) {
  const material = createPbrDecalMaterial({ tint: 0xffffff }, {
    baseColor: fixture.baseColor,
    normal: fixture.normalMap,
    orm: fixture.orm,
    emissive: fixture.emissive,
  });

  // The P-07 hosted test does not need alpha cutout to validate POM.
  // Force the planes opaque so a bad/empty alpha channel cannot hide geometry.
  material.transparent = false;
  material.opacity = 1.0;
  material.alphaTest = 0.0;
  material.blending = THREE.NoBlending;
  material.depthTest = true;
  material.depthWrite = true;
  material.polygonOffset = false;
  material.side = THREE.DoubleSide;
  material.color.setHex(0xffffff);
  material.roughness = 0.74;
  material.metalness = 0.08;
  material.normalScale.setScalar(1.0);
  material.needsUpdate = true;

  if (pom) {
    enablePomDecalMaterial(material, {
      heightMap: fixture.heightMap,
      heightScale: number(ui.height),
      minSteps: number(ui.minSteps),
      maxSteps: number(ui.maxSteps),
      refinementSteps: number(ui.refine),
      grazingFadeStart: 0.06,
      grazingFadeEnd: 0.22,
      maxUvOffset: 0.35,
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

function resetControls() {
  ui.height.value = String(P07_HATCH_FIXTURE.defaultHeightScale ?? 0.035);
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

[ui.height, ui.minSteps, ui.maxSteps, ui.refine].forEach((element) => {
  element.addEventListener('input', () => {
    updateLabels();
    updatePom();
  });
});
[ui.az, ui.el].forEach((element) => {
  element.addEventListener('input', () => {
    updateLabels();
    updateLight();
  });
});
ui.front.addEventListener('click', () => setCamera(0, 0.15, 6.5));
ui.grazing.addEventListener('click', () => setCamera(5.7, 0.15, 1.55));
ui.reset.addEventListener('click', resetControls);

updateLabels();
updateLight();

async function init() {
  try {
    setStatus('Loading P-07 BaseColor + Height textures…');
    fixture = await loadEmbeddedFixture();

    flatMaterial = createMaterial({ pom: false });
    pomMaterial = createMaterial({ pom: true });
    flatMesh = new THREE.Mesh(panelGeometry(), flatMaterial);
    pomMesh = new THREE.Mesh(panelGeometry(), pomMaterial);
    flatMesh.position.x = -1.55;
    pomMesh.position.x = 1.55;
    scene.add(flatMesh, pomMesh);

    setStatus('Ready. P-07 planes are forced opaque; use Grazing to stress the ShipModule POM ray marcher.');
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error?.message || error}`, true);
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

window.addEventListener('beforeunload', () => {
  flatMesh?.geometry?.dispose?.();
  pomMesh?.geometry?.dispose?.();
  flatMaterial?.dispose?.();
  pomMaterial?.dispose?.();
  fixture?.dispose?.();
  floor.geometry.dispose();
  floor.material.dispose();
  dividerGeometry.dispose();
  renderer.dispose();
});
