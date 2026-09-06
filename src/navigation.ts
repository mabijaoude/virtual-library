export type PlanarVector = {
  x: number;
  z: number;
};

export type MovementInput = {
  forward: number;
  strafe: number;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

export function isTapGesture(start: ScreenPoint, end: ScreenPoint, maxTravel = 9): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) <= Math.max(0, maxTravel);
}

export function joystickInputFromDelta(
  deltaX: number,
  deltaY: number,
  radius: number,
  deadZone = 0.14
): MovementInput {
  if (radius <= 0) return { forward: 0, strafe: 0 };
  const distance = Math.hypot(deltaX, deltaY);
  const normalizedDeadZone = Math.min(0.95, Math.max(0, deadZone));
  const normalizedDistance = Math.min(1, distance / radius);
  if (!distance || normalizedDistance <= normalizedDeadZone) return { forward: 0, strafe: 0 };

  const strength = (normalizedDistance - normalizedDeadZone) / (1 - normalizedDeadZone);
  return {
    forward: (-deltaY / distance) * strength,
    strafe: (deltaX / distance) * strength
  };
}

export type CollisionRect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type VerticalMotionState = {
  height: number;
  velocity: number;
  grounded: boolean;
};

export function shouldStartLookDrag(button: number, pointerLocked: boolean): boolean {
  return button === 0 && !pointerLocked;
}

export function stepCrouchOffset(
  current: number,
  crouching: boolean,
  delta: number,
  maxOffset = 0.62,
  response = 12
): number {
  const limit = Math.max(0, maxOffset);
  const start = Math.min(limit, Math.max(0, current));
  const target = crouching ? limit : 0;
  const amount = 1 - Math.exp(-Math.max(0, response) * Math.min(0.05, Math.max(0, delta)));
  const next = start + (target - start) * amount;
  return Math.abs(next - target) < 0.0005 ? target : next;
}

export function movementVectorFromInput(cameraForward: PlanarVector, input: MovementInput): PlanarVector {
  const forward = normalize2(cameraForward);
  const right = normalize2({ x: -forward.z, z: forward.x });
  const x = forward.x * input.forward + right.x * input.strafe;
  const z = forward.z * input.forward + right.z * input.strafe;
  return normalize2({ x, z });
}

export function dampPlanarVelocity(
  current: PlanarVector,
  desired: PlanarVector,
  acceleration: number,
  delta: number
): PlanarVector {
  const amount = 1 - Math.exp(-Math.max(0, acceleration) * Math.max(0, delta));
  return {
    x: current.x + (desired.x - current.x) * amount,
    z: current.z + (desired.z - current.z) * amount
  };
}

export function resolvePlanarCollisions(
  current: PlanarVector,
  proposed: PlanarVector,
  bounds: CollisionRect,
  obstacles: CollisionRect[],
  radius = 0.28,
  walkablePolygon: PlanarVector[] = []
): PlanarVector {
  let next = {
    x: Math.min(bounds.maxX - radius, Math.max(bounds.minX + radius, proposed.x)),
    z: Math.min(bounds.maxZ - radius, Math.max(bounds.minZ + radius, proposed.z))
  };

  if (walkablePolygon.length >= 3) next = keepInsideConvexPolygon(next, walkablePolygon, radius);

  for (const obstacle of obstacles) {
    const expanded = {
      minX: obstacle.minX - radius,
      maxX: obstacle.maxX + radius,
      minZ: obstacle.minZ - radius,
      maxZ: obstacle.maxZ + radius
    };
    if (!inside(next, expanded)) continue;

    const slideX = { x: current.x, z: next.z };
    const slideZ = { x: next.x, z: current.z };
    if (!inside(slideX, expanded)) next = slideX;
    else if (!inside(slideZ, expanded)) next = slideZ;
    else next = { ...current };
  }

  return next;
}

export function stepJumpMotion(
  state: VerticalMotionState,
  jumpRequested: boolean,
  delta: number,
  floorHeight = 1.82,
  jumpVelocity = 5.2,
  gravity = 14
): VerticalMotionState {
  const step = Math.min(0.05, Math.max(0, delta));
  let height = Math.max(floorHeight, state.height);
  let velocity = state.velocity;
  let grounded = state.grounded && height <= floorHeight + 0.002;

  if (jumpRequested && grounded) {
    velocity = jumpVelocity;
    grounded = false;
  }
  if (!grounded) {
    velocity -= gravity * step;
    height += velocity * step;
  }
  if (height <= floorHeight) return { height: floorHeight, velocity: 0, grounded: true };
  return { height, velocity, grounded: false };
}

function keepInsideConvexPolygon(point: PlanarVector, polygon: PlanarVector[], radius: number): PlanarVector {
  const signedArea = polygon.reduce((area, vertex, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return area + vertex.x * next.z - next.x * vertex.z;
  }, 0);
  const orientation = signedArea >= 0 ? 1 : -1;
  const next = { ...point };

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const edgeX = end.x - start.x;
    const edgeZ = end.z - start.z;
    const length = Math.hypot(edgeX, edgeZ);
    if (!length) continue;
    const inwardX = (-edgeZ / length) * orientation;
    const inwardZ = (edgeX / length) * orientation;
    const distance = (next.x - start.x) * inwardX + (next.z - start.z) * inwardZ;
    if (distance >= radius) continue;
    const correction = radius - distance;
    next.x += inwardX * correction;
    next.z += inwardZ * correction;
  }
  return next;
}

function inside(point: PlanarVector, rect: CollisionRect): boolean {
  return point.x > rect.minX && point.x < rect.maxX && point.z > rect.minZ && point.z < rect.maxZ;
}

function normalize2(vector: PlanarVector): PlanarVector {
  const length = Math.hypot(vector.x, vector.z);
  if (!length) return { x: 0, z: 0 };
  return { x: vector.x / length, z: vector.z / length };
}
