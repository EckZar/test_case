import asset_cross_hub_a from './seam-fixtures/cross_hub_a.js';
import asset_straight_offset_a from './seam-fixtures/straight_offset_a.js';
import asset_straight_reinforced_a from './seam-fixtures/straight_reinforced_a.js';
import asset_straight_frame_a from './seam-fixtures/straight_frame_a.js';
import asset_straight_offset_b from './seam-fixtures/straight_offset_b.js';
import asset_y_hub_a from './seam-fixtures/y_hub_a.js';
import asset_t_hub_a from './seam-fixtures/t_hub_a.js';
import asset_corner_hub_a from './seam-fixtures/corner_hub_a.js';
import asset_angled_hub_a from './seam-fixtures/angled_hub_a.js';

export const seamPackFixture = {"schema":1,"pack":{"schema":1,"id":"shipmodule-seam-pack-v1","label":"ShipModule Modular Seam Pack v1","heightConvention":"WHITE_HIGH_BLACK_LOW","socketStandard":{"id":"seam_rail_v1","nominalWidthWorld":1.0,"pixelsPerUnit":256.0,"joinRule":"align ports; opposite outward directions; optional overlap 0.04 world units"},"defaultProfile":{"heightScale":0.016,"neutralLevel":0.58,"raiseScale":0.32,"sinkScale":1.35,"wallSoftnessPx":0.75,"minSteps":12,"maxSteps":96,"refinementSteps":6,"maxUvOffset":0.22,"grazingFadeStart":0.08,"grazingFadeEnd":0.22,"jitterStrength":0,"stableGradients":true}},"assets":[asset_cross_hub_a,asset_straight_offset_a,asset_straight_reinforced_a,asset_straight_frame_a,asset_straight_offset_b,asset_y_hub_a,asset_t_hub_a,asset_corner_hub_a,asset_angled_hub_a]};
