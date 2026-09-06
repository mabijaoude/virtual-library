// Wall-local +Z faces into the room. Keep the projecting chambers inside
// |x| <= 7.3 so the southeast bookcase retains its full browsing lane.
export const FOUNDRY_RELAY = {
  wallZ: 10.22,
  centers: [-5.4, 5.4],
  centerY: 4.35,
  halfWidth: 1.9,
  front: 0.84,
  rear: -0.08,
  baseY: 0.9,
  topY: 6.75,
  rotorSpeed: 0.075,
  markerSpeed: 0.18,
  markerRadius: 1.15
} as const;

export const FOUNDRY_RELAY_OBSTACLES = FOUNDRY_RELAY.centers.map((x) => ({
  minX: x - FOUNDRY_RELAY.halfWidth,
  maxX: x + FOUNDRY_RELAY.halfWidth,
  minZ: FOUNDRY_RELAY.wallZ - FOUNDRY_RELAY.front - 0.04,
  maxZ: FOUNDRY_RELAY.wallZ + 0.16
}));

export function advanceRelayPhase(phase: number, delta: number, paused: boolean) {
  // A hidden tab or paused reading session must not fast-forward the machine.
  // Five rotor turns equal twelve marker turns, so both wrap continuously.
  return paused ? phase : (phase + Math.min(Math.max(delta, 0), 0.05)) % (Math.PI * 10 / FOUNDRY_RELAY.rotorSpeed);
}
