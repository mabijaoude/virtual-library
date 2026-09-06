export const SCROLL_BAY_DESIGN = {
  outerCenterZ: 0.1,
  outerDepth: 1.1,
  rearPanelZ: -0.36,
  rearPanelDepth: 0.12,
  slotDividerCenterZ: 0.16,
  slotDividerDepth: 0.84,
  slotFrontZ: 0.58,
  frontTrimZ: 0.64,
  liningColor: "#d8c59b",
  dividerColor: "#c8a78a",
  dividerEmissive: "#321a10",
  dividerRoughness: 0.38,
  dividerMetalness: 0.01,
  liningEmissive: "#6d5537",
  woodTextures: {
    map: "/worlds/assets/materials/shelf-wood-color.webp",
    normalMap: "/worlds/assets/materials/shelf-wood-normal.webp",
    roughnessMap: "/worlds/assets/materials/shelf-wood-roughness.webp"
  },
  liningTextures: {
    map: "/worlds/assets/materials/dome-plaster-color.webp",
    normalMap: "/worlds/assets/materials/dome-plaster-normal.webp",
    roughnessMap: "/worlds/assets/materials/dome-plaster-roughness.webp"
  }
} as const;

export function getScrollBayUsableDepth() {
  const rearPanelFront = SCROLL_BAY_DESIGN.rearPanelZ + SCROLL_BAY_DESIGN.rearPanelDepth / 2;
  return SCROLL_BAY_DESIGN.slotFrontZ - rearPanelFront;
}
