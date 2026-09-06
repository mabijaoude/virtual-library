import * as THREE from "three";
import type { Book, ShelfPlacement } from "../types";
import type { BayAnchor, WorldDefinition } from "./types";

export type ResolvedBookTransform = {
  position: THREE.Vector3;
  rotationY: number;
  front: THREE.Vector3;
  width: number;
};

export const SHELF_ROW_SPACING = 1.02;
export const SHELF_BOARD_BASE_Y = 0.38;
export const SHELF_BOOK_BASE_Y = 0.48;
export const SHELF_TOP_CLEARANCE = 0.18;
export const SCROLL_CELL_BASE_Y = 0.78;
export const SCROLL_CELL_SPACING = 1.02;

export function getShelfTop(_world: WorldDefinition) {
  return SHELF_BOARD_BASE_Y + SHELF_ROW_SPACING * 5 + SHELF_TOP_CLEARANCE;
}

export function getBayAnchor(world: WorldDefinition, bay: number): BayAnchor {
  const authored = world.bays[bay];
  if (authored) return authored;
  const overflow = bay - world.bays.length;
  const { origin, direction, spacing, rotationY } = world.expansion;
  return {
    position: [origin[0] + direction[0] * spacing * overflow, origin[1], origin[2] + direction[2] * spacing * overflow],
    rotationY,
    width: 4
  };
}

export function resolveBookTransform(placement: ShelfPlacement, world: WorldDefinition): ResolvedBookTransform {
  const anchor = getBayAnchor(world, placement.bay);
  const slotSpacing = anchor.width / 16;
  const localX = -(13 * slotSpacing) / 2 + placement.slot * slotSpacing;
  const scroll = world.displayArtifact === "scroll";
  const localY = scroll
    ? SCROLL_CELL_BASE_Y + placement.row * SCROLL_CELL_SPACING
    : SHELF_BOOK_BASE_Y + placement.row * SHELF_ROW_SPACING + placement.height / 2;
  const localZ = scroll ? 0.34 : 0.37;
  const sin = Math.sin(anchor.rotationY);
  const cos = Math.cos(anchor.rotationY);
  return {
    position: new THREE.Vector3(anchor.position[0] + localX * cos + localZ * sin, localY, anchor.position[2] - localX * sin + localZ * cos),
    rotationY: anchor.rotationY,
    // Leave room for the slight spine lean and the selected-book lift.
    width: Math.min(placement.width, slotSpacing - 0.035),
    front: new THREE.Vector3(sin, 0, cos)
  };
}

export function focusPoseForBook(book: Book, world: WorldDefinition) {
  const transform = resolveBookTransform(book.placement, world);
  const target = transform.position.clone().add(new THREE.Vector3(0, 0.03, 0));
  const baseDistance = world.displayArtifact === "scroll"
    ? 2.15
    : THREE.MathUtils.clamp(2.05 + book.placement.height * 0.34, 2.28, 2.52);
  // Gothic bays sit between clustered stone piers. The standard inspection
  // distance placed the camera inside the nearest pier even though the book
  // transform itself was correct.
  const architectureClearance = world.id === "gothic" ? 0.35 : world.id === "foundry" ? 0.28 : 0;
  const distance = baseDistance + architectureClearance;
  const position = target.clone().addScaledVector(transform.front, distance);
  if (world.id === "gothic") {
    const tangent = new THREE.Vector3(transform.front.z, 0, -transform.front.x);
    const candidateA = position.clone().addScaledVector(tangent, 1.35);
    const candidateB = position.clone().addScaledVector(tangent, -1.35);
    const distanceToCenter = (candidate: THREE.Vector3) => candidate.x * candidate.x + candidate.z * candidate.z;
    position.copy(distanceToCenter(candidateA) < distanceToCenter(candidateB) ? candidateA : candidateB);
  }

  // Guided shelf views are inspection poses, so the camera rises to the row
  // instead of looking up from walking height. This keeps every spine square.
  position.y = target.y;
  return { position, target };
}
