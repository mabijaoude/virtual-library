import { describe, expect, it } from "vitest";
import { dampPlanarVelocity, isTapGesture, joystickInputFromDelta, movementVectorFromInput, resolvePlanarCollisions, shouldStartLookDrag, stepCrouchOffset, stepJumpMotion } from "./navigation";

describe("isTapGesture", () => {
  it("accepts small pointer jitter and rejects look drags", () => {
    expect(isTapGesture({ x: 120, y: 80 }, { x: 125, y: 84 })).toBe(true);
    expect(isTapGesture({ x: 120, y: 80 }, { x: 140, y: 84 })).toBe(false);
  });
});

describe("look input", () => {
  it("starts a drag only for the primary pointer button outside pointer lock", () => {
    expect(shouldStartLookDrag(0, false)).toBe(true);
    expect(shouldStartLookDrag(2, false)).toBe(false);
    expect(shouldStartLookDrag(0, true)).toBe(false);
  });
});

describe("stepCrouchOffset", () => {
  it("smoothly lowers and restores the camera without exceeding the crouch range", () => {
    let offset = 0;
    for (let frame = 0; frame < 90; frame += 1) offset = stepCrouchOffset(offset, true, 1 / 60);
    expect(offset).toBeCloseTo(0.62, 2);
    expect(offset).toBeLessThanOrEqual(0.62);

    for (let frame = 0; frame < 90; frame += 1) offset = stepCrouchOffset(offset, false, 1 / 60);
    expect(offset).toBeCloseTo(0, 2);
  });
});

describe("joystickInputFromDelta", () => {
  it("maps upward thumb travel to forward movement", () => {
    const input = joystickInputFromDelta(0, -42, 42);
    expect(input.forward).toBeCloseTo(1);
    expect(input.strafe).toBeCloseTo(0);
  });

  it("ignores small movement inside the dead zone", () => {
    expect(joystickInputFromDelta(2, -3, 42)).toEqual({ forward: 0, strafe: 0 });
  });

  it("clamps diagonal travel to unit strength", () => {
    const input = joystickInputFromDelta(80, -80, 42);
    expect(Math.hypot(input.forward, input.strafe)).toBeCloseTo(1);
    expect(input.forward).toBeGreaterThan(0);
    expect(input.strafe).toBeGreaterThan(0);
  });
});

describe("movementVectorFromInput", () => {
  it("maps D to camera-right when the camera faces down the default -Z axis", () => {
    const move = movementVectorFromInput({ x: 0, z: -1 }, { forward: 0, strafe: 1 });
    expect(move.x).toBeCloseTo(1);
    expect(move.z).toBeCloseTo(0);
  });

  it("maps A to camera-left when the camera faces down the default -Z axis", () => {
    const move = movementVectorFromInput({ x: 0, z: -1 }, { forward: 0, strafe: -1 });
    expect(move.x).toBeCloseTo(-1);
    expect(move.z).toBeCloseTo(0);
  });

  it("normalizes diagonal movement", () => {
    const move = movementVectorFromInput({ x: 0, z: -1 }, { forward: 1, strafe: 1 });
    expect(Math.hypot(move.x, move.z)).toBeCloseTo(1);
    expect(move.x).toBeGreaterThan(0);
    expect(move.z).toBeLessThan(0);
  });
});

describe("dampPlanarVelocity", () => {
  it("accelerates toward the desired velocity without overshooting", () => {
    const next = dampPlanarVelocity({ x: 0, z: 0 }, { x: 4, z: -2 }, 10, 1 / 60);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(4);
    expect(next.z).toBeLessThan(0);
    expect(next.z).toBeGreaterThan(-2);
  });
});

describe("resolvePlanarCollisions", () => {
  const bounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  const table = { minX: -1, maxX: 1, minZ: 0, maxZ: 2 };

  it("slides along furniture instead of entering it", () => {
    const next = resolvePlanarCollisions({ x: -1.5, z: -0.5 }, { x: -0.8, z: 0.5 }, bounds, [table], 0.2);
    expect(next.x).toBe(-1.5);
    expect(next.z).toBe(0.5);
  });

  it("keeps the camera radius inside room bounds", () => {
    const next = resolvePlanarCollisions({ x: 0, z: 0 }, { x: 9, z: -9 }, bounds, [], 0.3);
    expect(next).toEqual({ x: 4.7, z: -4.7 });
  });

  it("keeps the camera inside an octagonal architectural shell", () => {
    const octagon = [
      { x: -2, z: -4 }, { x: 2, z: -4 }, { x: 4, z: -2 }, { x: 4, z: 2 },
      { x: 2, z: 4 }, { x: -2, z: 4 }, { x: -4, z: 2 }, { x: -4, z: -2 }
    ];
    const next = resolvePlanarCollisions({ x: 0, z: 0 }, { x: 4, z: 4 }, bounds, [], 0.25, octagon);
    expect(next.x + next.z).toBeCloseTo(6 - Math.SQRT2 * 0.25);
    expect(next.x).toBeLessThan(4);
    expect(next.z).toBeLessThan(4);
  });
});

describe("stepJumpMotion", () => {
  it("launches from the floor and lands without sinking below it", () => {
    let state = stepJumpMotion({ height: 1.82, velocity: 0, grounded: true }, true, 1 / 60, 1.82);
    expect(state.height).toBeGreaterThan(1.82);
    expect(state.grounded).toBe(false);
    for (let frame = 0; frame < 180; frame += 1) state = stepJumpMotion(state, false, 1 / 60, 1.82);
    expect(state).toEqual({ height: 1.82, velocity: 0, grounded: true });
  });

  it("does not permit an airborne second jump", () => {
    const airborne = { height: 2.4, velocity: -0.8, grounded: false };
    const next = stepJumpMotion(airborne, true, 1 / 60);
    expect(next.velocity).toBeLessThan(airborne.velocity);
  });

  it("produces a longer, lower lunar arc without changing the floor contract", () => {
    let lunar = stepJumpMotion({ height: 1.72, velocity: 0, grounded: true }, true, 1 / 60, 1.72, 1.35, 1.62);
    let terrestrial = stepJumpMotion({ height: 1.72, velocity: 0, grounded: true }, true, 1 / 60, 1.72, 5.2, 14);
    for (let frame = 0; frame < 60; frame += 1) {
      lunar = stepJumpMotion(lunar, false, 1 / 60, 1.72, 1.35, 1.62);
      terrestrial = stepJumpMotion(terrestrial, false, 1 / 60, 1.72, 5.2, 14);
    }
    expect(lunar.grounded).toBe(false);
    expect(terrestrial.grounded).toBe(true);
    expect(lunar.height).toBeGreaterThan(1.72);
  });
});
