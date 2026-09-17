import * as THREE from 'three';

const POM_PROGRAM_KEY = 'shipmodule-pom-decal-r180-v1:steps96:refine8';

function pomDeclarations() {
  return /* glsl */`
    #ifdef USE_MAP
      uniform sampler2D pomHeightMap;
      uniform float pomHeightScale;
      uniform float pomMinSteps;
      uniform float pomMaxSteps;
      uniform float pomRefinementSteps;

      vec2 resolvePomDecalUv( vec2 baseUv ) {
        vec3 viewDir = normalize( vViewPosition );
        vec3 dpdx = dFdx( vViewPosition );
        vec3 dpdy = dFdy( vViewPosition );
        vec2 duvdx = dFdx( baseUv );
        vec2 duvdy = dFdy( baseUv );
        vec3 tangent = normalize( dpdx * duvdy.y - dpdy * duvdx.y );
        vec3 bitangent = normalize( -dpdx * duvdy.x + dpdy * duvdx.x );
        vec3 surfaceNormal = normalize( cross( tangent, bitangent ) );
        vec3 viewTangent = vec3(
          dot( viewDir, tangent ),
          dot( viewDir, bitangent ),
          abs( dot( viewDir, surfaceNormal ) )
        );

        float steps = mix(
          pomMaxSteps,
          pomMinSteps,
          clamp( viewTangent.z, 0.0, 1.0 )
        );
        float stepDepth = 1.0 / max( steps, 1.0 );
        vec2 stepUv = ( viewTangent.xy / max( viewTangent.z, 0.12 ) )
          * pomHeightScale * stepDepth;
        vec2 currentUv = baseUv;
        float currentDepth = 0.0;

        for ( int stepIndex = 0; stepIndex < 96; stepIndex++ ) {
          if ( float( stepIndex ) >= steps ) break;
          if ( currentDepth >= 1.0 - texture2D( pomHeightMap, currentUv ).r ) break;
          currentUv -= stepUv;
          currentDepth += stepDepth;
        }

        vec2 beforeUv = currentUv + stepUv;
        vec2 afterUv = currentUv;
        float beforeDepth = max( currentDepth - stepDepth, 0.0 );
        float afterDepth = currentDepth;
        for ( int refineIndex = 0; refineIndex < 8; refineIndex++ ) {
          if ( float( refineIndex ) >= pomRefinementSteps ) break;
          vec2 middleUv = ( beforeUv + afterUv ) * 0.5;
          float middleDepth = ( beforeDepth + afterDepth ) * 0.5;
          if ( middleDepth < 1.0 - texture2D( pomHeightMap, middleUv ).r ) {
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
      if ( any( lessThan( pomDecalUv, vec2( 0.0 ) ) ) || any( greaterThan( pomDecalUv, vec2( 1.0 ) ) ) ) discard;
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
} = {}) {
  if (!heightMap) return material;
  const uniforms = {
    pomHeightMap: { value: heightMap },
    pomHeightScale: { value: heightScale },
    pomMinSteps: { value: minSteps },
    pomMaxSteps: { value: Math.min(maxSteps, 96) },
    pomRefinementSteps: { value: Math.min(refinementSteps, 8) },
  };
  material.userData.pomUniforms = uniforms;
  material.userData.pomEnabled = true;
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
} = {}) {
  const uniforms = material?.userData?.pomUniforms;
  if (!uniforms) return;
  if (heightMap) uniforms.pomHeightMap.value = heightMap;
  if (Number.isFinite(heightScale)) uniforms.pomHeightScale.value = heightScale;
  if (Number.isFinite(minSteps)) uniforms.pomMinSteps.value = minSteps;
  if (Number.isFinite(maxSteps)) uniforms.pomMaxSteps.value = Math.min(maxSteps, 96);
  if (Number.isFinite(refinementSteps)) uniforms.pomRefinementSteps.value = Math.min(refinementSteps, 8);
}
