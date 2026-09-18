import * as THREE from 'three';

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

function decodeBase64(text) {
  if (typeof text !== 'string' || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new Error('Повреждён embedded base64');
  }
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function flipRows(source, width, height, channels) {
  const result = new Uint8Array(source.length);
  const stride = width * channels;
  for (let y = 0; y < height; y++) {
    result.set(source.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  return result;
}

async function decodeMap(entry, width, height, channels) {
  const modules = await Promise.all(entry.chunks.map(url => import(url)));
  const bytes = decodeBase64(modules.map(module => module.default).join(''));
  if (bytes.length !== entry.length) throw new Error(`Embedded map: ${bytes.length} байт вместо ${entry.length}`);
  if (await sha256(bytes) !== entry.sha256) throw new Error('Embedded map: SHA-256 не совпала');

  const image = await createImageBitmap(new Blob([bytes], { type: entry.mime }));
  if (image.width !== width || image.height !== height) {
    throw new Error(`Embedded map: ${image.width}×${image.height} вместо ${width}×${height}`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  image.close();
  const pixels = context.getImageData(0, 0, width, height).data;
  const result = new Uint8Array(width * height * channels);
  for (let i = 0; i < width * height; i++) {
    if (channels === 4) result.set(pixels.subarray(i * 4, i * 4 + 4), i * 4);
    else result[i] = pixels[i * 4];
  }
  return flipRows(result, width, height, channels);
}

export function toRgba(source, channels) {
  if (channels === 4) return source;
  const result = new Uint8Array(source.length / channels * 4);
  for (let i = 0; i < source.length / channels; i++) {
    result[i * 4] = source[i * channels];
    result[i * 4 + 1] = source[i * channels + (channels === 1 ? 0 : 1)];
    result[i * 4 + 2] = source[i * channels + (channels === 1 ? 0 : 2)];
    result[i * 4 + 3] = 255;
  }
  return result;
}

function dataTexture(source, channels, width, height, srgb = false) {
  const texture = new THREE.DataTexture(toRgba(source, channels), width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function solidTexture(r, g, b) {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildOrm(base, height, alpha) {
  const result = new Uint8Array(height.length * 3);
  for (let i = 0; i < height.length; i++) {
    const r = base[i * 4], g = base[i * 4 + 1], b = base[i * 4 + 2], a = alpha[i];
    const luminance = .2126 * r + .7152 * g + .0722 * b;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const orange = r > 150 && r > g * 1.35 && r > b * 2;
    const dark = luminance < 82, light = luminance > 185 && saturation < 45;
    result[i * 3] = a < 16 ? 255 : Math.max(150, 255 - Math.max(0, 128 - height[i]) * .35);
    result[i * 3 + 1] = a < 16 ? 225 : orange ? 145 : light ? 205 : dark ? 165 : 182;
    result[i * 3 + 2] = a < 16 ? 0 : orange ? 8 : light ? 18 : dark ? 72 : 82;
  }
  return result;
}

export async function loadPullRailMaps(metadata, mapMetadata) {
  const { width, height } = metadata;
  const count = width * height;
  const [base, sourceHeight] = await Promise.all([
    decodeMap(mapMetadata.base, width, height, 4),
    decodeMap(mapMetadata.height, width, height, 1),
  ]);
  const alpha = Uint8Array.from({ length: count }, (_, index) => base[index * 4 + 3]);
  const orm = buildOrm(base, sourceHeight, alpha);
  const neutralNormal = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) neutralNormal.set([128, 128, 255], i * 3);

  const textures = {
    base: dataTexture(base, 4, width, height, true),
    normal: dataTexture(neutralNormal, 3, width, height),
    orm: dataTexture(orm, 3, width, height),
    alpha: dataTexture(alpha, 1, width, height),
  };
  const heightData = new Uint16Array(count * 4);
  textures.height = new THREE.DataTexture(heightData, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  Object.assign(textures.height, {
    colorSpace: THREE.NoColorSpace,
    flipY: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });
  return { base, sourceHeight, alpha, textures, heightData, width, height, count };
}
