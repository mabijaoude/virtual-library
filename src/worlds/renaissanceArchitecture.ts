import type { BayAnchor } from "./types";

export const RENAISSANCE_COLUMN_Z = [-5.6, -2.8, 0, 2.8, 5.6, 8.4] as const;
export const RENAISSANCE_SOFFIT = { halfSpan: 11, openingRadius: 10.5, height: 6.64, curveSegments: 48 } as const;
export const RENAISSANCE_DOME = {
  radius: 10.65,
  springY: 6.82,
  verticalScale: 0.38,
  openingAngle: 0.2,
  segments: { lite: [36, 14], cinematic: [64, 24] },
  drum: { radius: 10.59, centerY: 6.97, height: 0.74, radialSegments: 96 }
} as const;

// Keep the landscape clear and the entrance cases outside the marble arcade.
// Includes space for the complete crowns and 0.6–2.8 m shelf approaches.
export const RENAISSANCE_BAYS: BayAnchor[] = [
  { position: [-9.35, 0, -7.4], rotationY: Math.PI / 2, width: 4 },
  ...[-3, 0.6, 4.2].map((z): BayAnchor => ({ position: [-9.35, 0, z], rotationY: Math.PI / 2, width: 2.35 })),
  ...[-7, -1.4, 4.2].map((z): BayAnchor => ({ position: [9.35, 0, z], rotationY: -Math.PI / 2, width: 2.35 })),
  ...[-8.2, 8.2].map((x): BayAnchor => ({ position: [x, 0, 9.6], rotationY: Math.PI, width: 3.4 }))
];
