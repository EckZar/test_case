const $ = id => document.getElementById(id);

export const CONTROL_IDS = {
  heightScale: 'height', neutralLevel: 'neutralLevel', raiseScale: 'raiseScale', sinkScale: 'sinkScale',
  wallSoftnessPx: 'wallSoftnessPx', minSteps: 'minSteps', maxSteps: 'maxSteps',
  refinementSteps: 'refine', maxUvOffset: 'maxUvOffset', grazingFadeStart: 'grazingFadeStart',
  grazingFadeEnd: 'grazingFadeEnd', jitterStrength: 'jitterStrength',
};

const OUTPUT_IDS = {
  heightScale: 'heightOut', neutralLevel: 'neutralLevelOut', raiseScale: 'raiseScaleOut',
  sinkScale: 'sinkScaleOut', wallSoftnessPx: 'wallSoftnessPxOut', minSteps: 'minOut',
  maxSteps: 'maxOut', refinementSteps: 'refineOut', maxUvOffset: 'maxUvOffsetOut',
  grazingFadeStart: 'grazingFadeStartOut', grazingFadeEnd: 'grazingFadeEndOut',
  jitterStrength: 'jitterStrengthOut',
};

export function readControls() {
  const parameters = Object.fromEntries(Object.entries(CONTROL_IDS).map(([key, id]) => [key, Number($(id).value)]));
  parameters.stableGradients = $('stableGradients').checked;
  parameters.minSteps = Math.min(parameters.minSteps, parameters.maxSteps);
  parameters.grazingFadeEnd = Math.max(parameters.grazingFadeStart + .001, parameters.grazingFadeEnd);
  return parameters;
}

export function assignControls(parameters) {
  for (const [key, value] of Object.entries(parameters)) {
    if (CONTROL_IDS[key]) $(CONTROL_IDS[key]).value = String(value);
    if (key === 'stableGradients') $('stableGradients').checked = Boolean(value);
  }
}

export function updateControlOutputs(parameters) {
  for (const [key, id] of Object.entries(OUTPUT_IDS)) {
    const digits = ['minSteps', 'maxSteps', 'refinementSteps'].includes(key) ? 0 : key === 'heightScale' ? 3 : 2;
    $(id).textContent = Number(parameters[key]).toFixed(digits);
  }
}
