export const ARKSHIP_NAVIGATION_DESIGN = {
  viewSeconds: 18,
  transitionSeconds: 0.85,
  views: ["journey", "habitat", "community"],
  route: "07-A",
  destination: "CYGNUS ARCHIVE",
  arrivalWindow: "T-18D 06H"
} as const;

export type ArkshipNavigationView = typeof ARKSHIP_NAVIGATION_DESIGN.views[number];
