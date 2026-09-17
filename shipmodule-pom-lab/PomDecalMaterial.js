import * as THREE from 'three';

const POM_PROGRAM_KEY = 'shipmodule-pom-decal-r180-v3:steps96:refine8:view-frame-sign';

function pomDeclarations() {
  return /* glsl */`
    #ifdef USE_MAP
      uniform sampler2D pomHeightMap;
      uniform float pomHeightScale;
      uniform float pomMinSteps;
      uniform float pomMaxSteps;
      uniform float pomRefinementSteps;
      uniform float pomGrazingFadeStart;
      uniform float pomGrazingFadeEnd;
      uniform float pomMaxUvOffset;

      float samplePomDepth( vec2 uv, vec2 uvDx, vec2 uvDy ) {
        // Reference convention: white = high, black = deep.
        return 1.0 - textureGrad( pomHeightMap, uv, uvDx, uvDy ).r;
      }

      vec2 resolvePomDecalUv( vec2 baseUv ) {
        // vViewPosition is -mvPosition. Use its direction for the camera ray,
        // but negate it before taking surface derivatives; otherwise the
        // tangent/bitangent frame reverses the UV ray and inverts the relief.
        vec3 viewDir = normalize( vViewPosition );
        vec3 surfacePositionView = -vViewPosition;
        vec3 dpdx = dFdx( surfacePositionView );
        vec3 dpdy = dFdy( surfacePositionView );
        vec2 duvdx = dFdx( baseUv );
        vec2 duvdy = dFdy( baseUv );
        float determinant = duvdx.x * duvdy.y - duvdx.y * duvdy.x;
        if ( abs( determinant ) < 1e-8 ) return baseUv;

        float inverseDeterminant = 1.0 / determinant;
        vec3 tangent = normalize(
          ( dpdx * duvdy.y - dpdy * duvdx.y ) * inverseDeterminant
        );
        vec3 bitangent = normalize(
          ( -dpdx * duvdy.x + dpdy * duvdx.x ) * inverseDeterminant
        );
        vec3 surfaceNormal = normalize( cross( tangent, bitangent ) );
        if ( dot( surfaceNormal, viewDir ) < 0.0 ) {
          bitangent = -bitangent;
          surfaceNormal = -surfaceNormal;
        }

        vec3 viewTangent = vec3(
          dot( viewDir, tangent ),
          dot( viewDir, bitangent ),
          max( dot( viewDir, surfaceNormal ), 0.0 )
        );
        float facing = clamp( viewTangent.z, 0.0, 1.0 );
        float grazingFade = smoothstep(
          pomGrazingFadeStart,
          pomGrazingFadeEnd,
          facing
        );
        if ( grazingFade <= 1e-4 || pomHeightScale <= 0.0 ) return baseUv;

        float steps = mix( pomMaxSteps, pomMinSteps, facing );
        steps = max( steps, 1.0 );
        float stepDepth = 1.0 / steps;
        vec2 totalUvOffset = (
          viewTangent.xy / max( facing, 0.12 )
        ) * pomHeightScale * grazingFade;
        float totalOffsetLength = length( totalUvOffset );
        if ( totalOffsetLength > pomMaxUvOffset ) {
          totalUvOffset *= pomMaxUvOffset / max( totalOffsetLength, 1e-6 );
        }
        vec2 stepUv = totalUvOffset / steps;

        vec2 currentUv = baseUv;
        float currentDepth = 0.0;
        float sampledDepth = samplePomDepth( currentUv, duvdx, duvdy );
        if ( sampledDepth <= 1e-5 ) return baseUv;

        vec2 previousUv = currentUv;
        float previousDepth = currentDepth;
        bool bracketed = false;
        for ( int stepIndex = 0; stepIndex < 96; stepIndex++ ) {
          if ( float( stepIndex ) >= steps ) break;
          if ( currentDepth >= sampledDepth ) {
            bracketed = true;
            break;
          }
          previousUv = currentUv;
          previousDepth = currentDepth;
          currentUv -= stepUv;
          currentDepth += stepDepth;
          sampledDepth = samplePomDepth( currentUv, duvdx, duvdy );
        }
        if ( currentDepth >= sampledDepth ) bracketed = true;
        if ( !bracketed ) return currentUv;

        vec2 beforeUv = previousUv;
        vec2 afterUv = currentUv;
        float beforeDepth = previousDepth;
        float afterDepth = currentDepth;
        for ( int refineIndex = 0; refineIndex < 8; refineIndex++ ) {
          if ( float( refineIndex ) >= pomRefinementSteps ) break;
          vec2 middleUv = ( beforeUv + afterUv ) * 0.5;
          float middleDepth = ( beforeDepth + afterDepth ) * 0.5;
          float middleSurface = samplePomDepth( middleUv, duvdx, duvdy );
          if ( middleDepth < middleSurface ) {
            beforeUv = middleUv;
            beforeDepth = middleDepth;
          } else {
            afterUv = middleUv;
            afterDepth = middleDepth;
          }
        }
        return ( beforeUv + afterUv ) * 0.5;
      }

    #endif
  `;
}

function pomMapSetup() {
  return /* glsl */`
    #ifdef USE_MAP
      vec2 pomDecalUv = resolvePomDecalUv( vMapUv );
      #define vMapUv pomDecalUv
      #define vNormalMapUv pomDecalUv
      #define vRoughnessMapUv pomDecalUv
      #define vMetalnessMapUv pomDecalUv
      #define vAoMapUv pomDecalUv
      #define vEmissiveMapUv pomDecalUv
    #endif
  `;
}

export function createPbrDecalMaterial(layer, textures) {
  return new THREE.MeshPhysicalMaterial({
    color: layer.tint,
    map: textures.baseColor,
    normalMap: textures.normal,
    roughnessMap: textures.orm,
    metalnessMap: textures.orm,
    aoMap: textures.orm,
    aoMapIntensity: 1,
    emissive: 0xffffff,
    emissiveMap: textures.emissive,
    transparent: true,
    alphaTest: 0.025,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.FrontSide,
  });
}

export function enablePomDecalMaterial(material, {
  heightMap,
  heightScale = 0.01,
  minSteps = 8,
  maxSteps = 48,
  refinementSteps = 4,
  grazingFadeStart = 0.06,
  grazingFadeEnd = 0.22,
  maxUvOffset = 0.35,
} = {}) {
  if (!heightMap) return material;
  const uniforms = {
    pomHeightMap: { value: heightMap },
    pomHeightScale: { value: heightScale },
    pomMinSteps: { value: minSteps },
    pomMaxSteps: { value: Math.min(maxSteps, 96) },
    pomRefinementSteps: { value: Math.min(refinementSteps, 8) },
    pomGrazingFadeStart: { value: grazingFadeStart },
    pomGrazingFadeEnd: { value: Math.max(grazingFadeEnd, grazingFadeStart + 0.001) },
    pomMaxUvOffset: { value: Math.max(0.01, maxUvOffset) },
  };
  material.userData.pomUniforms = uniforms;
  material.userData.pomEnabled = true;
  material.userData.pomStability = 'view-frame-sign-v3';
  material.userData.pomHeightConvention = 'WHITE_HIGH_BLACK_LOW';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${pomDeclarations()}`)
      .replace('#include <map_fragment>', `${pomMapSetup()}\n#include <map_fragment>`);
  };
  material.customProgramCacheKey = () => POM_PROGRAM_KEY;
  material.needsUpdate = true;
  return material;
}

export function updatePomDecalMaterial(material, {
  heightMap,
  heightScale,
  minSteps,
  maxSteps,
  refinementSteps,
  grazingFadeStart,
  grazingFadeEnd,
  maxUvOffset,
} = {}) {
  const uniforms = material?.userData?.pomUniforms;
  if (!uniforms) return;
  if (heightMap) uniforms.pomHeightMap.value = heightMap;
  if (Number.isFinite(heightScale)) uniforms.pomHeightScale.value = heightScale;
  if (Number.isFinite(minSteps)) uniforms.pomMinSteps.value = minSteps;
  if (Number.isFinite(maxSteps)) uniforms.pomMaxSteps.value = Math.min(maxSteps, 96);
  if (Number.isFinite(refinementSteps)) uniforms.pomRefinementSteps.value = Math.min(refinementSteps, 8);
  if (Number.isFinite(grazingFadeStart)) uniforms.pomGrazingFadeStart.value = grazingFadeStart;
  if (Number.isFinite(grazingFadeEnd)) {
    uniforms.pomGrazingFadeEnd.value = Math.max(
      grazingFadeEnd,
      uniforms.pomGrazingFadeStart.value + 0.001,
    );
  }
  if (Number.isFinite(maxUvOffset)) uniforms.pomMaxUvOffset.value = Math.max(0.01, maxUvOffset);
}
