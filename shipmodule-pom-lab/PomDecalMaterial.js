import * as THREE from 'three';
import { normalizePomReliefOptions } from './PomReliefProfile.js';

export const POM_PROGRAM_KEY = 'shipmodule-pom-decal-r180-v4:steps128:refine8:asymmetric-relief';
const finite = (value, fallback, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(value) ? value : fallback));

function declarations() {
  return /* glsl */`
#ifdef USE_MAP
uniform sampler2D pomHeightMap;
uniform float pomHeightScale, pomMinSteps, pomMaxSteps, pomRefinementSteps;
uniform float pomGrazingFadeStart, pomGrazingFadeEnd, pomMaxUvOffset;
uniform float pomNeutralLevel, pomRaiseScale, pomSinkScale;
uniform float pomStableGradients, pomJitterStrength;
vec2 pomBaseUv, pomUvDx, pomUvDy;

float pomSignedHeight(float h) {
  float d = h - pomNeutralLevel;
  return d * (d >= 0.0 ? pomRaiseScale : pomSinkScale);
}
float samplePomDepth(vec2 uv, float top, float span) {
  float h = textureGrad(pomHeightMap, uv, pomUvDx, pomUvDy).r;
  return (top - pomSignedHeight(h)) / span;
}
vec4 pomSampleMap(sampler2D tex, vec2 uv) {
  if (pomStableGradients > 0.5) return textureGrad(tex, uv, pomUvDx, pomUvDy);
  return texture2D(tex, uv);
}
float pomHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 resolvePomDecalUv(vec2 baseUv) {
  // Three.js vViewPosition points surface -> camera, not camera -> surface.
  vec3 viewDir = normalize(vViewPosition);
  vec3 surfacePositionView = -vViewPosition;
  vec3 dpdx = dFdx(surfacePositionView), dpdy = dFdy(surfacePositionView);
  float det = pomUvDx.x * pomUvDy.y - pomUvDx.y * pomUvDy.x;
  float detScale = max(length(pomUvDx) * length(pomUvDy), 1e-18);
  if (abs(det) <= 1e-6 * detScale) return baseUv;
  vec3 T = normalize((dpdx * pomUvDy.y - dpdy * pomUvDx.y) / det);
  vec3 B = normalize((-dpdx * pomUvDy.x + dpdy * pomUvDx.x) / det);
  vec3 N = normalize(cross(T, B));
  // Orient N only; flipping B would reverse mirrored UVs / the back face ray.
  if (dot(N, viewDir) < 0.0) N = -N;
  vec3 V = vec3(dot(viewDir,T), dot(viewDir,B), max(dot(viewDir,N), 0.0));
  float facing = clamp(V.z, 0.0, 1.0);
  float fade = smoothstep(pomGrazingFadeStart, pomGrazingFadeEnd, facing);
  float top = (1.0 - pomNeutralLevel) * pomRaiseScale;
  float bottom = -pomNeutralLevel * pomSinkScale;
  float span = top - bottom;
  if (pomHeightScale <= 0.0 || fade <= 1e-4 || span <= 1e-6) return baseUv;

  vec2 slope = V.xy / max(facing, 0.08) * pomHeightScale * fade;
  float bound = length(slope) * max(top, -bottom);
  if (bound > pomMaxUvOffset) slope *= pomMaxUvOffset / max(bound, 1e-8);
  // The actual polygon stays at z=0, raw h=neutralLevel. Trace from the top
  // envelope to the bottom. Raise and sink remain independent, without clipping.
  vec2 startUv = baseUv + slope * top;
  vec2 total = slope * span;
  float angleSteps = mix(pomMaxSteps, pomMinSteps, facing);
  float texelSteps = length(total * vec2(textureSize(pomHeightMap, 0))) / 0.75;
  float steps = ceil(clamp(max(angleSteps, texelSteps), pomMinSteps, pomMaxSteps));
  float before = 0.0;
  float beforeSurface = samplePomDepth(startUv, top, span);
  if (beforeSurface <= 1e-6) return startUv;
  float after = 1.0, afterSurface = 1.0;
  bool hit = false;
  // Fixed per-pixel jitter is optional and OFF by default: no temporal AA in lab.
  // Depth and UV use the same phase and the last sample always reaches t=1.
  float phase = mix(1.0, 0.05 + 0.95 * pomHash(gl_FragCoord.xy), pomJitterStrength);
  for (int i=0; i<128; ++i) {
    if (float(i) >= steps) break;
    float t = float(i) + 1.0 >= steps ? 1.0 : (float(i) + phase) / steps;
    float surface = samplePomDepth(startUv - total * t, top, span);
    if (t >= surface) { after=t; afterSurface=surface; hit=true; break; }
    before=t; beforeSurface=surface;
  }
  if (!hit) return startUv - total;
  for (int i=0; i<8; ++i) {
    if (float(i) >= pomRefinementSteps) break;
    float t=(before+after)*0.5;
    float surface=samplePomDepth(startUv-total*t, top, span);
    if (t<surface) { before=t; beforeSurface=surface; }
    else { after=t; afterSurface=surface; }
  }
  // Secant interpolation inside the last valid bracket removes layer snapping.
  float f0=beforeSurface-before, f1=afterSurface-after;
  float denom=f0-f1;
  float w=abs(denom)>1e-8?clamp(f0/denom,0.0,1.0):0.5;
  return startUv-total*mix(before,after,w);
}
#endif
`;
}

function decorate(shader) {
  const setup = /* glsl */`
#ifdef USE_MAP
  pomBaseUv = vMapUv;
  pomUvDx = dFdx(vMapUv);
  pomUvDy = dFdy(vMapUv);
  vec2 pomDecalUv = resolvePomDecalUv(vMapUv);
#endif
`;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n'+declarations());
  // Keep Three.js r180 lighting, ORM channel layout, color conversion and alpha.
  // Replace only texture lookups; normal TBN must use the ORIGINAL surface UV.
  for (const name of ['map_fragment','normal_fragment_begin','normal_fragment_maps','roughnessmap_fragment','metalnessmap_fragment','aomap_fragment','emissivemap_fragment','alphamap_fragment']) {
    const original = THREE.ShaderChunk[name];
    let enhanced = original.replace(/texture2D\(\s*(map|normalMap|roughnessMap|metalnessMap|aoMap|emissiveMap|alphaMap)\s*,\s*v\w*Uv\s*\)/g, 'pomSampleMap( $1, pomDecalUv )');
    if (name === 'normal_fragment_begin') enhanced = enhanced.replace(/vNormalMapUv/g, 'pomBaseUv');
    const wrapped = `\n#ifdef USE_MAP\n${enhanced}\n#else\n${original}\n#endif\n`;
    shader.fragmentShader = shader.fragmentShader.replace(`#include <${name}>`, (name === 'map_fragment' ? setup : '') + wrapped);
  }
}

export function createPbrDecalMaterial(layer, textures) {
  return new THREE.MeshPhysicalMaterial({
    color: layer.tint, map: textures.baseColor, normalMap: textures.normal,
    roughnessMap: textures.orm, metalnessMap: textures.orm, aoMap: textures.orm,
    aoMapIntensity: 1, emissive: 0xffffff, emissiveMap: textures.emissive,
    transparent: true, alphaTest: 0.025, depthTest: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.FrontSide,
  });
}

export function enablePomDecalMaterial(material, options = {}) {
  if (!options.heightMap) return material;
  const relief = normalizePomReliefOptions(options);
  const uniforms = {
    pomHeightMap:{value:options.heightMap}, pomHeightScale:{value:0.01},
    pomMinSteps:{value:8}, pomMaxSteps:{value:48}, pomRefinementSteps:{value:4},
    pomGrazingFadeStart:{value:0.06}, pomGrazingFadeEnd:{value:0.22}, pomMaxUvOffset:{value:0.35},
    pomNeutralLevel:{value:relief.neutralLevel}, pomRaiseScale:{value:relief.raiseScale}, pomSinkScale:{value:relief.sinkScale},
    pomStableGradients:{value:1}, pomJitterStrength:{value:0},
  };
  material.userData.pomUniforms=uniforms;
  material.userData.pomEnabled=true;
  material.userData.pomStability='asymmetric-relief-v4';
  material.userData.pomHeightConvention='WHITE_HIGH_BLACK_LOW';
  updatePomDecalMaterial(material, options);
  material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,uniforms);decorate(shader);};
  material.customProgramCacheKey=()=>POM_PROGRAM_KEY;
  material.needsUpdate=true;
  return material;
}
export function updatePomDecalMaterial(material, options = {}) {
  const u=material?.userData?.pomUniforms;
  if (!u) return;
  if (options.heightMap) u.pomHeightMap.value=options.heightMap;
  const fields={heightScale:['pomHeightScale',0,1],minSteps:['pomMinSteps',1,128],maxSteps:['pomMaxSteps',1,128],refinementSteps:['pomRefinementSteps',0,8],neutralLevel:['pomNeutralLevel',0,1],raiseScale:['pomRaiseScale',0,3],sinkScale:['pomSinkScale',0,3],grazingFadeStart:['pomGrazingFadeStart',0,0.95],grazingFadeEnd:['pomGrazingFadeEnd',0.001,1],maxUvOffset:['pomMaxUvOffset',0.001,1],jitterStrength:['pomJitterStrength',0,1]};
  for (const [key,[name,lo,hi]] of Object.entries(fields)) if (Number.isFinite(options[key])) u[name].value=finite(options[key],u[name].value,lo,hi);
  u.pomMinSteps.value=Math.round(Math.min(u.pomMinSteps.value,u.pomMaxSteps.value));
  u.pomMaxSteps.value=Math.round(u.pomMaxSteps.value);
  u.pomRefinementSteps.value=Math.round(u.pomRefinementSteps.value);
  u.pomGrazingFadeEnd.value=Math.max(u.pomGrazingFadeEnd.value,u.pomGrazingFadeStart.value+0.001);
  if (typeof options.stableGradients==='boolean') u.pomStableGradients.value=options.stableGradients?1:0;
}
