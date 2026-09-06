import * as THREE from "three";
import type { ResolvedQuality } from "./types";

// One continuous surface reaches under the pressure-window sill. Concentrate
// vertices near the habitat rather than displacing a visible rectangular edge.
export const LUNAR_GROUND = { halfWidth: 640, front: -9.8, back: -850 } as const;
export const LUNAR_ROVER = { x: -6.8, z: -31, yaw: -0.32, scale: 1.08 } as const;
const craters = [
  [10, -43, 8.5, 1.7], [-20, -59, 12, 2.4], [29, -88, 18, 3.9],
  [-49, -121, 27, 5.2], [5, -178, 39, 7.4], [92, -209, 49, 8],
  [-133, -285, 62, 12], [185, -390, 91, 16], [-18, -502, 122, 20],
  [-12, -19, 1.8, 0.22], [4, -23, 2.2, 0.3], [18, -28, 3.1, 0.5],
  [-29, -32, 4.2, 0.65], [0, -57, 3.2, 0.5], [35, -49, 4.8, 0.7]
] as const;

function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const sx = x - ix, sz = z - iz;
  const u = sx * sx * (3 - 2 * sx), v = sz * sz * (3 - 2 * sz);
  const hash = (a: number, b: number) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  };
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), u),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}

export function lunarHeight(x: number, z: number) {
  const distance = Math.max(0, -z - 10);
  const distant = THREE.MathUtils.smoothstep(distance, 70, 480);
  let y = -0.92 - distance * 0.004;
  y += noise(x * 0.043, z * 0.043) * 0.65;
  y += noise(x * 0.12, z * 0.12) * 0.18;
  y += noise(x * 0.37, z * 0.37) * 0.045;
  y += distant * (9 + 17 * noise(x * 0.011, z * 0.014));
  for (const [cx, cz, radius, depth] of craters) {
    const dx = x - cx, dz = z - cz;
    const angle = Math.atan2(dz, dx);
    const r = Math.hypot(dx, dz) / (radius * (1 + 0.045 * Math.sin(angle * 5 + cx)));
    if (r > 1.7) continue;
    // Smooth excavated bowl, rounded raised rim, and a low ejecta apron.
    const bowl = r < 1 ? -depth * (1 - r * r) ** 2 : 0;
    const rim = depth * 0.29 * Math.exp(-(((r - 1) / 0.15) ** 2));
    const apron = depth * 0.06 * Math.exp(-(((r - 1.18) / 0.32) ** 2));
    y += bowl + rim + apron;
  }
  // A gently graded survey route keeps the rover and wheel trails in contact.
  const dx = x - LUNAR_ROVER.x, dz = z - LUNAR_ROVER.z;
  const across = dx * Math.cos(LUNAR_ROVER.yaw) - dz * Math.sin(LUNAR_ROVER.yaw);
  const along = dx * Math.sin(LUNAR_ROVER.yaw) + dz * Math.cos(LUNAR_ROVER.yaw);
  const grade = (1 - THREE.MathUtils.smoothstep(Math.abs(across), 2.6, 5.5))
    * (1 - THREE.MathUtils.smoothstep(Math.abs(along - 5), 9, 15));
  return THREE.MathUtils.lerp(y, -1.02, grade);
}

export function createLunarTerrain(quality: ResolvedQuality) {
  const nx = quality === "cinematic" ? 196 : quality === "balanced" ? 136 : 80;
  const nz = quality === "cinematic" ? 196 : quality === "balanced" ? 136 : 80;
  const geometry = new THREE.PlaneGeometry(1, 1, nx, nz);
  const positions = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const u = (i % (nx + 1)) / nx * 2 - 1;
    const v = Math.floor(i / (nx + 1)) / nz;
    const x = Math.sign(u) * LUNAR_GROUND.halfWidth * (0.035 * Math.abs(u) + 0.965 * Math.abs(u) ** 3);
    const z = LUNAR_GROUND.front + (LUNAR_GROUND.back - LUNAR_GROUND.front) * (0.025 * v + 0.975 * v ** 2.6);
    const y = lunarHeight(x, z);
    positions.setXYZ(i, x, y, z);
    uv.setXY(i, x / 38, -z / 38);
    // Static low-sun terrain occlusion: crater rims shade their own bowls,
    // without another real-time shadow map or render pass.
    let occlusion = 1;
    if (z > -240) for (const step of [1.2, 2.4, 4.8, 9.6, 19.2, 38.4]) {
      const obstruction = lunarHeight(x - step * 0.89, z - step * 0.456) - y - step * 0.413;
      occlusion = Math.min(occlusion, 1 - 0.6 * THREE.MathUtils.smoothstep(obstruction, 0.04, 0.42));
      if (occlusion <= 0.4) break;
    }
    const shade = (0.78 + noise(x * 0.16, z * 0.16) * 0.055 + noise(x * 0.037, z * 0.037) * 0.1) * occlusion;
    colors.set([shade, shade * 0.99, shade * 0.97], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const indices = geometry.getIndex()!;
  for (let i = 0; i < indices.count; i += 3) {
    const b = indices.getX(i + 1);
    indices.setX(i + 1, indices.getX(i + 2));
    indices.setX(i + 2, b);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "Continuous cratered regolith";
  return geometry;
}

export function createRegolithGrain() {
  const size = 512, data = new Uint8Array(size * size * 4);
  const relief = new Float32Array(size * size);
  let state = 19721211;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    relief[y * size + x] = 127 + noise(x * 0.031, y * 0.031) * 12
      + noise(x * 0.13, y * 0.13) * 8 + (random() - 0.5) * 19;
  }
  // Small impact pits and their raised lips sit above the dust grain scale.
  // Wrap each stamp across tile edges so the repeat stays continuous.
  for (let i = 0; i < 190; i++) {
    const cx = random() * size, cy = random() * size, radius = 2 + random() ** 2 * 17;
    for (let y = Math.floor(cy - radius * 1.4); y <= cy + radius * 1.4; y++) {
      for (let x = Math.floor(cx - radius * 1.4); x <= cx + radius * 1.4; x++) {
        const r = Math.hypot(x - cx, y - cy) / radius;
        if (r > 1.4) continue;
        const pit = r < 1 ? -26 * (1 - r * r) ** 2 : 0;
        const lip = 10 * Math.exp(-(((r - 1) / 0.13) ** 2));
        relief[((y + size) % size) * size + ((x + size) % size)] += pit + lip;
      }
    }
  }
  for (let i = 0; i < size * size; i++) {
    const shade = THREE.MathUtils.clamp(relief[i], 0, 255);
    data.set([shade, shade, shade, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.repeat.set(5, 5);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Sample the actual rendered triangles, including Lite's coarser tessellation.
export function lunarSurfaceSampler(geometry: THREE.PlaneGeometry) {
  const nx = geometry.parameters.widthSegments, nz = geometry.parameters.heightSegments;
  const p = geometry.getAttribute("position");
  const interval = (value: number, count: number, at: (i: number) => number) => {
    let low = 0, high = count;
    while (high - low > 1) { const mid = (low + high) >> 1; if (at(mid) <= value) low = mid; else high = mid; }
    return low;
  };
  return (x: number, z: number) => {
    const ix = interval(x, nx, (i) => p.getX(i));
    const iz = interval(-z, nz, (i) => -p.getZ(i * (nx + 1)));
    const a = iz * (nx + 1) + ix, b = a + nx + 1;
    const u = THREE.MathUtils.clamp((x - p.getX(a)) / (p.getX(a + 1) - p.getX(a)), 0, 1);
    const v = THREE.MathUtils.clamp((z - p.getZ(a)) / (p.getZ(b) - p.getZ(a)), 0, 1);
    return u + v <= 1
      ? p.getY(a) + (p.getY(a + 1) - p.getY(a)) * u + (p.getY(b) - p.getY(a)) * v
      : p.getY(b + 1) + (p.getY(b) - p.getY(b + 1)) * (1 - u) + (p.getY(a + 1) - p.getY(b + 1)) * (1 - v);
  };
}

export function createLunarTracks(height = lunarHeight) {
  const positions: number[] = [], indices: number[] = [];
  for (const side of [-1, 1]) {
    const start = positions.length / 3;
    for (let i = 0; i <= 72; i++) {
      const along = 1 + i / 72 * 13;
      for (const edge of [-1, 1]) {
        const across = side * 1.08 * LUNAR_ROVER.scale + edge * 0.15;
        const x = LUNAR_ROVER.x + across * Math.cos(LUNAR_ROVER.yaw) + along * Math.sin(LUNAR_ROVER.yaw);
        const z = LUNAR_ROVER.z - across * Math.sin(LUNAR_ROVER.yaw) + along * Math.cos(LUNAR_ROVER.yaw);
        positions.push(x, height(x, z) + 0.018, z);
      }
      if (i < 72) { const a = start + i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
