// Pure height-field helpers shared by the hosted lab and ShipModule material tests.
// neutralLevel=1 with both gains=1 preserves the original top-anchored POM.
export const POM_RELIEF_DEFAULTS = Object.freeze({
  neutralLevel: 1, raiseScale: 1, sinkScale: 1, wallSoftnessPx: 0,
});
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function normalizePomReliefOptions(options = {}) {
  const read = (key, hi) => clamp(Number.isFinite(options[key]) ? options[key] : POM_RELIEF_DEFAULTS[key], 0, hi);
  return { neutralLevel: read('neutralLevel', 1), raiseScale: read('raiseScale', 3), sinkScale: read('sinkScale', 3), wallSoftnessPx: read('wallSoftnessPx', 4) };
}
export function remapPomHeight(height, options = {}) {
  const p = normalizePomReliefOptions(options);
  const d = clamp(height, 0, 1) - p.neutralLevel;
  // Do NOT clamp the output to [0,1]: that would crush deep recesses.
  return d * (d >= 0 ? p.raiseScale : p.sinkScale);
}
export function getPomReliefBounds(options = {}) {
  const p = normalizePomReliefOptions(options);
  const top = (1 - p.neutralLevel) * p.raiseScale;
  const bottom = -p.neutralLevel * p.sinkScale;
  return { top, bottom, span: top - bottom };
}

// Optional authoring/preprocessing operation, not five extra fetches per ray step.
// Rows here increase with UV.v (bottom-up), as in the hosted raw DataTextures.
export function preparePomReliefMaps(source, width, height, options = {}, alpha = null) {
  if (!(source instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || source.length !== width * height) {
    throw new Error('POM relief: expected an exact width × height Uint8Array.');
  }
  if (alpha && (!(alpha instanceof Uint8Array) || alpha.length !== source.length)) throw new Error('POM relief: invalid opacity array.');
  const p = normalizePomReliefOptions(options), count = width * height;
  const heightField = new Float32Array(count), normal = new Uint8Array(count * 3);
  const covered = i => !alpha || alpha[i] > 127;
  const at = (x, y, fallback) => {
    const i = clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1);
    return covered(i) ? source[i] / 255 : fallback;
  };
  const sample = (x, y, fallback) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    return (at(ix, iy, fallback) * (1 - fx) + at(ix + 1, iy, fallback) * fx) * (1 - fy)
      + (at(ix, iy + 1, fallback) * (1 - fx) + at(ix + 1, iy + 1, fallback) * fx) * fy;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, h = source[i] / 255;
    if (!covered(i)) { heightField[i] = p.neutralLevel; continue; }
    if (p.wallSoftnessPx === 0) { heightField[i] = h; continue; }
    const r = p.wallSoftnessPx;
    const a = sample(x-r,y,h), b = sample(x+r,y,h), c = sample(x,y-r,h), d = sample(x,y+r,h);
    const range = Math.max(h,a,b,c,d) - Math.min(h,a,b,c,d);
    const t = clamp((range - 0.06) / 0.14, 0, 1), blend = t*t*(3-2*t) * 0.65;
    heightField[i] = h + (((4*h+a+b+c+d)/8) - h) * blend;
  }
  const signed = h => { const d=h-p.neutralLevel; return d*(d>=0?p.raiseScale:p.sinkScale); };
  const hs = Number.isFinite(options.heightScale) ? Math.max(0, options.heightScale) : 0.02;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i=y*width+x, h=heightField[i];
    const get = (xx,yy) => {
      const j=clamp(yy,0,height-1)*width+clamp(xx,0,width-1);
      return signed(covered(j)?heightField[j]:h);
    };
    const nx=covered(i)?-(get(x+1,y)-get(x-1,y))*width*0.5*hs:0;
    const ny=covered(i)?-(get(x,y+1)-get(x,y-1))*height*0.5*hs:0;
    const inv=1/Math.hypot(nx,ny,1);
    normal[i*3]=Math.round((nx*inv*.5+.5)*255);
    normal[i*3+1]=Math.round((ny*inv*.5+.5)*255);
    normal[i*3+2]=Math.round((inv*.5+.5)*255);
  }
  return { heightField, normal };
}
