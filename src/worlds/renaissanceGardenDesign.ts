export type GardenPart = {
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
};

export const RENAISSANCE_GARDEN = {
  window: { minX: -5.2, maxX: 5.2, bottom: 1.12, top: 6.46, outerZ: -11.34 },
  backdrop: { radius: 66, height: 112, centerY: -16, centerZ: -11 },
  terrace: { halfWidth: 14, nearZ: -11.38, farZ: -25.38, top: -0.18 },
  balustradeZ: -21.8,
  reliefs: [
    { position: [10.5, 4.1, -4.2], rotationY: -Math.PI / 2, scale: [0.86, 0.7, 0.6], kind: "celestial" },
    { position: [10.5, 4.1, 1.4], rotationY: -Math.PI / 2, scale: [0.86, 0.7, 0.6], kind: "botanical" },
    { position: [-10.52, 4.1, 7.1], rotationY: Math.PI / 2, scale: [0.86, 0.7, 0.45], kind: "rosette" }
  ]
} as const;

export function gardenPart(x: number, y: number, z: number, sx: number, sy: number, sz: number): GardenPart {
  return { position: [x, y, z], scale: [sx, sy, sz] };
}

export function buildGardenTerrace() {
  const paving: GardenPart[] = [];
  for (let x = -13; x <= 13; x += 2) for (let row = 0; row < 7; row++) {
    paving.push(gardenPart(x, -0.28, -12.38 - row * 2, 1.975, 0.2, 1.975));
  }
  const stone: GardenPart[] = [
    gardenPart(0, -0.43, -18.38, 28, 0.25, 14),
    gardenPart(0, 0.94, RENAISSANCE_GARDEN.balustradeZ, 25, 0.16, 0.54),
    gardenPart(0, -0.055, RENAISSANCE_GARDEN.balustradeZ, 25, 0.27, 0.58)
  ];
  const balusters: GardenPart[] = [];
  for (let x = -11.7; x <= 11.7; x += 0.9) balusters.push(gardenPart(x, 0.08, RENAISSANCE_GARDEN.balustradeZ, 1, 0.78, 1));
  for (const x of [-12.35, -6.15, 6.15, 12.35]) {
    stone.push(gardenPart(x, 0.4, RENAISSANCE_GARDEN.balustradeZ, 0.48, 1.18, 0.64));
    stone.push(gardenPart(x, 1.04, RENAISSANCE_GARDEN.balustradeZ, 0.66, 0.14, 0.78));
  }
  // A descending garden beyond the low rail gives the opening a horizon,
  // foreground and middle distance rather than a second picture frame.
  const beds: GardenPart[] = [];
  for (const x of [-7.1, 7.1]) for (const z of [-28.5, -36.5]) {
    beds.push(gardenPart(x, -0.48, z, 7.8, 0.28, 5.4));
    for (const dx of [-3.7, 3.7]) stone.push(gardenPart(x + dx, -0.35, z, 0.2, 0.55, 5.6));
    for (const dz of [-2.7, 2.7]) stone.push(gardenPart(x, -0.35, z + dz, 7.6, 0.55, 0.2));
  }
  return { paving, stone, balusters, beds };
}

export function buildCypresses() {
  return [
    [-5.8, -16.6, 4.5, 0.7], [6.1, -17.8, 5.1, 0.76],
    [-9.3, -22.6, 5.4, 0.82], [10.1, -24.4, 5.8, 0.84],
    [-4.1, -30.2, 4.7, 0.64], [4.3, -32.4, 5, 0.7],
    [-12.6, -39.2, 6.2, 0.95], [12.8, -41, 6.5, 1.05]
  ].map(([x, z, height, radius]) => ({ x, z, height, radius }));
}
