import architecture from "./alexandriaArchitecture.json";

export const ALEXANDRIA_ENTRANCE_DESIGN = {
  centerX: architecture.centerX,
  rearShelfCenterX: architecture.rearShelfCenterX,
  frameColor: "#255f86",
  panelColor: "#9d6238",
  bronzeColor: "#c39a55",
  sillColor: "#c9b990",
  muralCenterY: 6.28,
  muralHeight: 1.1,
  muralFrameExtension: 0.18,
  muralZ: 10.72,
  portalHalfWidth: 3.05,
  portalCorniceTop: 5.48,
  facadeLintelCenterOffset: 0.38,
  facadeLintelHeight: 0.4
} as const;

export function getAlexandriaMuralClearance() {
  const frameBottom = ALEXANDRIA_ENTRANCE_DESIGN.muralCenterY
    - (ALEXANDRIA_ENTRANCE_DESIGN.muralHeight + ALEXANDRIA_ENTRANCE_DESIGN.muralFrameExtension) / 2;
  return frameBottom - ALEXANDRIA_ENTRANCE_DESIGN.portalCorniceTop;
}
