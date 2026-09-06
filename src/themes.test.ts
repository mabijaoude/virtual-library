import { describe, expect, it } from "vitest";
import { scrollPresentation } from "./components/ScrollCollection";
import { resolvePlanarCollisions, type CollisionRect, type PlanarVector } from "./navigation";
import { LUNAR_CONTROL_PLINTH_POSITIONS } from "./worlds/RoomDetails";
import { ALEXANDRIA_HARBOR_COMPOSITION } from "./worlds/AlexandriaExterior";
import { ARKSHIP_EXTERIOR_DESIGN } from "./worlds/SpaceExteriors";
import { ALEXANDRIA_ENTRANCE_DESIGN, getAlexandriaMuralClearance } from "./worlds/alexandriaEntrance";
import { ARKSHIP_NAVIGATION_DESIGN } from "./worlds/arkshipNavigation";
import { DEFAULT_WORLD_ID, getWorld, WORLDS, worldCssVariables } from "./worlds/registry";
import { getScrollBayUsableDepth, SCROLL_BAY_DESIGN } from "./worlds/scrollBay";
import { balanceScrollPlaqueLabel, getShelfKitDimensions, usesOccupiedShelfBackPanel, usesPersistentShelfBackPanel } from "./worlds/shared";

const CAMERA_RADIUS = 0.28;

function hexBrightness(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return ((value >> 16) & 0xff) * 0.2126 + ((value >> 8) & 0xff) * 0.7152 + (value & 0xff) * 0.0722;
}

type OrientedFootprint = {
  center: PlanarVector;
  rotationY: number;
  halfWidth: number;
  halfDepth: number;
};

function footprintAxes(footprint: OrientedFootprint) {
  return [
    { x: Math.cos(footprint.rotationY), z: -Math.sin(footprint.rotationY) },
    { x: Math.sin(footprint.rotationY), z: Math.cos(footprint.rotationY) }
  ] as const;
}

function projectedRadius(footprint: OrientedFootprint, axis: PlanarVector) {
  const [tangent, front] = footprintAxes(footprint);
  return footprint.halfWidth * Math.abs(tangent.x * axis.x + tangent.z * axis.z)
    + footprint.halfDepth * Math.abs(front.x * axis.x + front.z * axis.z);
}

function footprintsOverlap(a: OrientedFootprint, b: OrientedFootprint) {
  for (const axis of [...footprintAxes(a), ...footprintAxes(b)]) {
    const centerDistance = Math.abs((a.center.x - b.center.x) * axis.x + (a.center.z - b.center.z) * axis.z);
    if (centerDistance >= projectedRadius(a, axis) + projectedRadius(b, axis) - 0.0001) return false;
  }
  return true;
}

function insideExpandedObstacle(point: PlanarVector, obstacle: CollisionRect) {
  return point.x > obstacle.minX - CAMERA_RADIUS
    && point.x < obstacle.maxX + CAMERA_RADIUS
    && point.z > obstacle.minZ - CAMERA_RADIUS
    && point.z < obstacle.maxZ + CAMERA_RADIUS;
}

function isWalkablePoint(world: (typeof WORLDS)[number], point: PlanarVector) {
  if (point.x < world.bounds.minX + CAMERA_RADIUS || point.x > world.bounds.maxX - CAMERA_RADIUS) return false;
  if (point.z < world.bounds.minZ + CAMERA_RADIUS || point.z > world.bounds.maxZ - CAMERA_RADIUS) return false;
  if (world.obstacles.some((obstacle) => insideExpandedObstacle(point, obstacle))) return false;
  if (!world.walkablePolygon?.length) return true;
  const resolved = resolvePlanarCollisions(point, point, world.bounds, [], CAMERA_RADIUS, world.walkablePolygon);
  return Math.hypot(resolved.x - point.x, resolved.z - point.z) < 0.001;
}

function reachableFloorPoints(world: (typeof WORLDS)[number]) {
  // Keep the flood-fill resolution no larger than the camera radius so a
  // narrow but valid shelf edge is not rounded into an adjacent obstacle.
  const step = CAMERA_RADIUS;
  const columns = Math.floor((world.bounds.maxX - world.bounds.minX - CAMERA_RADIUS * 2) / step) + 1;
  const rows = Math.floor((world.bounds.maxZ - world.bounds.minZ - CAMERA_RADIUS * 2) / step) + 1;
  const pointAt = (column: number, row: number) => ({
    x: world.bounds.minX + CAMERA_RADIUS + column * step,
    z: world.bounds.minZ + CAMERA_RADIUS + row * step
  });
  const nearestCell = (point: PlanarVector) => ({
    column: Math.max(0, Math.min(columns - 1, Math.round((point.x - world.bounds.minX - CAMERA_RADIUS) / step))),
    row: Math.max(0, Math.min(rows - 1, Math.round((point.z - world.bounds.minZ - CAMERA_RADIUS) / step)))
  });
  const start = nearestCell({ x: world.spawn.position[0], z: world.spawn.position[2] });
  const queue = [start];
  const visited = new Set([`${start.column}:${start.row}`]);
  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index];
    for (const [columnDelta, rowDelta] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const column = cell.column + columnDelta;
      const row = cell.row + rowDelta;
      const key = `${column}:${row}`;
      if (column < 0 || row < 0 || column >= columns || row >= rows || visited.has(key) || !isWalkablePoint(world, pointAt(column, row))) continue;
      visited.add(key);
      queue.push({ column, row });
    }
  }
  return {
    canReach(point: PlanarVector) {
      const target = nearestCell(point);
      return visited.has(`${target.column}:${target.row}`);
    }
  };
}

describe("library worlds", () => {
  it("registers nine complete worlds with distinct layouts and scene modules", () => {
    expect(WORLDS.map((world) => world.id)).toEqual(["modern", "heritage", "gothic", "renaissance", "deco", "foundry", "lunar", "arkship", "alexandria"]);
    expect(new Set(WORLDS.map((world) => `${world.bounds.minX}:${world.bounds.maxX}:${world.bounds.minZ}:${world.bounds.maxZ}`)).size).toBe(9);
    expect(new Set(WORLDS.map((world) => world.landmark)).size).toBe(9);
    for (const world of WORLDS) {
      expect(world.bays).toHaveLength(9);
      expect(new Set(world.bays.map((bay) => bay.position.join(":"))).size).toBe(9);
      expect(world.boundary.width).toBeGreaterThanOrEqual(3.2);
      expect(world.boundary.height).toBeGreaterThanOrEqual(4.4);
      expect(world.boundary.depth).toBeGreaterThanOrEqual(6.5);
      expect(world.boundary.span).toBeGreaterThan(world.boundary.width);
      expect(world.boundary.placements.length).toBeGreaterThan(0);
      if (world.boundary.barrierKind === "energy") {
        expect(world.boundary.laserOpacity).toBeGreaterThanOrEqual(0.2);
        expect(world.boundary.laserOpacity).toBeLessThanOrEqual(0.3);
      } else {
        expect(world.boundary.laserOpacity).toBeUndefined();
      }
      expect(world.scene.bookPalette.length).toBeGreaterThanOrEqual(6);
      expect(world.swatches).toHaveLength(3);
      expect(world.cameraFar).toBeGreaterThan(world.scene.fogFar * 0.9);
      expect(world.motion.gravity).toBeGreaterThan(0);
      expect(world.motion.floorHeight).toBeGreaterThanOrEqual(1.8);
      expect(world.spawn.position[1]).toBe(world.motion.floorHeight);
      expect(worldCssVariables(world)["--paper"]).toBe(world.ui.paper);
    }
  });

  it("keeps Art Deco shelving on the perimeter and its central circulation clear", () => {
    const world = getWorld("deco");
    expect(world.bays.every((bay) => Math.hypot(bay.position[0], bay.position[2]) >= 8)).toBe(true);
    expect(world.obstacles).toEqual([{ minX: -1.05, maxX: 1.05, minZ: -1.05, maxZ: 1.05 }, { minX: -1.9, maxX: 1.9, minZ: 8.84, maxZ: 9.6 }]);
    expect(world.walkablePolygon).toHaveLength(8);
    expect(world.bays[4].position).toEqual([-6.75, 0, 5.05]);
    expect(world.bays[4].rotationY).toBe(3 * Math.PI / 4);
    expect(world.bays[5].position).toEqual([8.35, 0, 2.035]);
    expect(world.bays[5].rotationY).toBe(-Math.PI / 2);
    expect(world.bays[5].width).toBe(3);
    expect(world.boundary.placements[0]).toEqual({ position: [0, 0, 9.12], rotationY: Math.PI });
  });

  it("keeps visible circulation routes free of phantom collision volumes", () => {
    const gothic = getWorld("gothic");
    expect(gothic.obstacles.some((obstacle) => obstacle.minX < 0 && obstacle.maxX > 0 && obstacle.minZ < 0 && obstacle.maxZ > 0)).toBe(false);
    expect(gothic.bays[0]).toMatchObject({ position: [7.45, 0, 7], rotationY: -Math.PI / 2 });
    // Arrival frames the nave and rose window, with the shelf aisle beside it.
    expect(Math.abs(gothic.spawn.yaw)).toBeLessThan(0.3);

    const renaissance = getWorld("renaissance");
    expect(renaissance.obstacles[0]).toEqual({ minX: -2.3, maxX: 2.3, minZ: -2.3, maxZ: 2.3 });
    expect(renaissance.spawn.position).toEqual([0, 1.82, 8.8]);
    expect(renaissance.obstacles.some((obstacle) => (
      renaissance.spawn.position[0] >= obstacle.minX
      && renaissance.spawn.position[0] <= obstacle.maxX
      && renaissance.spawn.position[2] >= obstacle.minZ
      && renaissance.spawn.position[2] <= obstacle.maxZ
    ))).toBe(false);
    expect(renaissance.bays[0].position).toEqual([-9.35, 0, -7.4]);

    const foundry = getWorld("foundry");
    expect(foundry.obstacles).toHaveLength(3);
    expect(foundry.obstacles[0]).toEqual({ minX: -2.25, maxX: 2.25, minZ: 2.65, maxZ: 4.1 });
    expect(foundry.spawn.yaw).toBeLessThan(-1);
    expect(foundry.bays[5]).toMatchObject({ position: [-11.15, 0, 3.2], width: 3.2 });
    expect(foundry.bays[7]).toMatchObject({ position: [11.15, 0, 3.2], width: 3.2 });
  });

  it("keeps every spawn and authored shelf approach on connected walkable floor", () => {
    for (const world of WORLDS) {
      const spawn = { x: world.spawn.position[0], z: world.spawn.position[2] };
      expect(isWalkablePoint(world, spawn), `${world.id} spawn should be walkable`).toBe(true);
      const reachable = reachableFloorPoints(world);
      for (const [index, bay] of world.bays.entries()) {
        const front = { x: Math.sin(bay.rotationY), z: Math.cos(bay.rotationY) };
        const tangent = { x: Math.cos(bay.rotationY), z: -Math.sin(bay.rotationY) };
        for (const depth of [1.45, 2.4]) {
          for (const lateral of [-0.34, 0, 0.34]) {
            const approach = {
              x: bay.position[0] + front.x * depth + tangent.x * bay.width * lateral,
              z: bay.position[2] + front.z * depth + tangent.z * bay.width * lateral
            };
            const label = `${world.id} bay ${index} depth ${depth} lateral ${lateral}`;
            expect(isWalkablePoint(world, approach), `${label} should keep the shelf face clear`).toBe(true);
            expect(reachable.canReach(approach), `${label} should connect to the spawn`).toBe(true);
          }
        }
      }
    }
  });

  it("keeps every physical shelf case out of every entrance frame and portal throat", () => {
    for (const world of WORLDS) {
      for (const [bayIndex, bay] of world.bays.entries()) {
        const dimensions = getShelfKitDimensions(world, bay.width);
        const shelf: OrientedFootprint = {
          center: { x: bay.position[0], z: bay.position[2] },
          rotationY: bay.rotationY,
          halfWidth: (bay.width + 0.62) / 2,
          halfDepth: (dimensions.shelfDepth + 0.2) / 2
        };
        for (const [entranceIndex, placement] of world.boundary.placements.entries()) {
          const entrance: OrientedFootprint = {
            center: { x: placement.position[0], z: placement.position[2] },
            rotationY: placement.rotationY,
            halfWidth: (world.boundary.width + 0.7) / 2,
            halfDepth: 0.75
          };
          expect(
            footprintsOverlap(shelf, entrance),
            `${world.id} shelf ${bayIndex} must not intersect entrance ${entranceIndex}`
          ).toBe(false);
        }
      }
    }
  });

  it("keeps movable perimeter fixtures outside shelf service lanes and gives them colliders", () => {
    const fixtureGroups = [
      { worldId: "lunar" as const, positions: LUNAR_CONTROL_PLINTH_POSITIONS, width: 2.2, depth: 0.82 }
    ];
    for (const group of fixtureGroups) {
      const world = getWorld(group.worldId);
      for (const [fixtureIndex, position] of group.positions.entries()) {
        const fixture: OrientedFootprint = {
          center: { x: position[0], z: position[2] },
          rotationY: 0,
          halfWidth: group.width / 2 + 0.35,
          halfDepth: group.depth / 2 + 0.35
        };
        for (const [bayIndex, bay] of world.bays.entries()) {
          const front = { x: Math.sin(bay.rotationY), z: Math.cos(bay.rotationY) };
          const aisle: OrientedFootprint = {
            center: {
              x: bay.position[0] + front.x * 1.7,
              z: bay.position[2] + front.z * 1.7
            },
            rotationY: bay.rotationY,
            halfWidth: bay.width / 2 + 0.15,
            halfDepth: 1.1
          };
          expect(
            footprintsOverlap(fixture, aisle),
            `${group.worldId} fixture ${fixtureIndex} must stay out of shelf ${bayIndex}'s service lane`
          ).toBe(false);
        }
        expect(
          world.obstacles.some((obstacle) => (
            obstacle.minX <= position[0] - group.width / 2
            && obstacle.maxX >= position[0] + group.width / 2
            && obstacle.minZ <= position[2] - group.depth / 2
            && obstacle.maxZ >= position[2] + group.depth / 2
          )),
          `${group.worldId} fixture ${fixtureIndex} should have a matching collision footprint`
        ).toBe(true);
      }
    }
  });

  it("keeps specialized shelf backs intact and gives standard non-space shelves a lighter persistent back", () => {
    for (const world of WORLDS) {
      const spaceRoom = world.id === "lunar" || world.id === "arkship";
      const standardNonSpaceRoom = !spaceRoom && world.id !== "alexandria";
      expect(usesOccupiedShelfBackPanel(world.id)).toBe(spaceRoom);
      expect(usesPersistentShelfBackPanel(world.id)).toBe(standardNonSpaceRoom);
      if (standardNonSpaceRoom) {
        expect(world.scene.shelfBack).toMatch(/^#[0-9a-f]{6}$/i);
        expect(hexBrightness(world.scene.shelfBack!)).toBeGreaterThan(hexBrightness(world.scene.shelfDark));
      }
    }
    expect(hexBrightness(SCROLL_BAY_DESIGN.liningColor)).toBeGreaterThan(hexBrightness(getWorld("alexandria").scene.shelfDark));
  });

  it("anchors Gothic moonlight behind the rose window instead of an invisible room light", () => {
    const gothic = getWorld("gothic");
    expect(gothic.scene.keyPosition).toEqual([0, 10.5, -16]);
    expect(gothic.scene.keyPosition[2]).toBeLessThan(gothic.bounds.minZ);
    expect(gothic.lighting.environment).toBe(0);
    expect(gothic.scene.key).toBe("#a9cfff");
  });

  it("cache-busts the simplified Alexandria study model", () => {
    const alexandria = getWorld("alexandria");
    expect(alexandria.assets.completeModel).toContain("ceremonial-doorway");
    expect(alexandria.assets.fallbackModel).toContain("ceremonial-doorway");
  });

  it("keeps shelf boards and trim inside the upright faces", () => {
    for (const world of WORLDS) {
      const dimensions = getShelfKitDimensions(world, world.bays[0].width);
      const uprightInnerFace = dimensions.uprightCenter - dimensions.uprightWidth / 2;
      expect(dimensions.boardWidth / 2).toBeLessThanOrEqual(uprightInnerFace + 0.007);
      expect(dimensions.trimWidth).toBeLessThan(dimensions.boardWidth);
    }
  });

  it("keeps Renaissance shelves on the side and entrance walls around a clear landscape", () => {
    const renaissance = getWorld("renaissance");
    const sideBays = renaissance.bays.slice(1, 7);
    expect(sideBays.map((bay) => bay.position[2])).toEqual([-3, 0.6, 4.2, -7, -1.4, 4.2]);
    expect(sideBays.every((bay) => bay.width === 2.35)).toBe(true);
    expect(sideBays.every((bay) => bay.width < 2.8)).toBe(true);
    expect(renaissance.bays.slice(7).map((bay) => bay.position)).toEqual([[-8.2, 0, 9.6], [8.2, 0, 9.6]]);
  });

  it("gives Modern Archive two modeled entrance transitions", () => {
    const modern = getWorld("modern");
    expect(modern.boundary.placements).toHaveLength(2);
    expect(modern.boundary.span).toBeGreaterThanOrEqual(19);
    expect(modern.boundary.style).toBe("modern");
    expect(modern.bays[7]).toMatchObject({ position: [10.8, 0, 6.35], width: 3.2 });
    expect(modern.bays[8].position).toEqual([-6.6, 0, 8.85]);
  });

  it("cache-busts Gothic models after grounding the compact candle fixtures", () => {
    const gothic = getWorld("gothic");
    expect(gothic.assets.completeModel).toContain("starter-sightline");
    expect(gothic.assets.fallbackModel).toContain("starter-sightline");
  });

  it("starts fresh and unknown visitors in Modern Archive", () => {
    expect(DEFAULT_WORLD_ID).toBe("modern");
    expect(WORLDS[0].id).toBe("modern");
    expect(getWorld("unknown").id).toBe("modern");
    expect(getWorld(undefined).label).toBe("Modern Archive");
  });

  it("keeps the period rooms legible without flattening their lighting schemes", () => {
    for (const id of ["heritage", "gothic"] as const) {
      const lighting = getWorld(id).lighting;
      expect(lighting.exposure).toBeGreaterThanOrEqual(0.68);
      expect(lighting.ambient).toBeGreaterThanOrEqual(0.58);
      expect(lighting.hemisphere).toBeGreaterThanOrEqual(0.22);
      expect(lighting.practical).toBeGreaterThanOrEqual(0.22);
    }
    expect(getWorld("gothic").lighting.environment).toBe(0);
  });

  it("keeps Heritage Oak shelves readable against the paneled room", () => {
    const heritage = getWorld("heritage");
    expect(heritage.lighting.exposure).toBeGreaterThanOrEqual(0.92);
    expect(heritage.lighting.ambient).toBeGreaterThanOrEqual(0.76);
    expect(heritage.lighting.hemisphere).toBeGreaterThanOrEqual(0.34);
    expect(heritage.lighting.practical).toBeGreaterThanOrEqual(0.4);
    expect(heritage.scene.ambientIntensity).toBeGreaterThanOrEqual(0.68);
    expect(heritage.scene.shelf).toBe("#c28a61");
    expect(heritage.scene.shelfDark).toBe("#68442f");
    expect(heritage.scene.bookPalette).toEqual(["#7f342c", "#98532f", "#356a57", "#395d70", "#7b5728", "#724563"]);
  });

  it("makes the Moon base physically distinct from the artificial-gravity ship", () => {
    const lunar = getWorld("lunar");
    const arkship = getWorld("arkship");
    expect(lunar.exterior.kind).toBe("lunar");
    expect(arkship.exterior.kind).toBe("deep-space");
    expect(lunar.motion.gravity).toBeCloseTo(1.62, 2);
    expect(lunar.motion.jumpVelocity).toBeLessThan(arkship.motion.jumpVelocity);
    expect(lunar.cameraFar).toBeGreaterThan(arkship.cameraFar);
    expect(lunar.obstacles[0].maxX - lunar.obstacles[0].minX).toBeLessThan(4);
    expect(arkship.obstacles).toHaveLength(3);
    expect(arkship.obstacles[0].maxX - arkship.obstacles[0].minX).toBeGreaterThan(5);
    expect(arkship.obstacles[0].maxZ - arkship.obstacles[0].minZ).toBeLessThan(2);
    expect(arkship.boundary.style).toBe("starship");
  });

  it("keeps Arkship shelves and circulation legible in the compact room", () => {
    const arkship = getWorld("arkship");
    expect(arkship.lighting.exposure).toBeGreaterThanOrEqual(0.84);
    expect(arkship.lighting.ambient).toBeGreaterThanOrEqual(0.7);
    expect(arkship.lighting.hemisphere).toBeGreaterThanOrEqual(0.18);
    expect(arkship.assets.completeModel).toContain("aisle-lighting");
    expect(arkship.assets.fallbackModel).toContain("aisle-lighting");
  });

  it("keeps Arkship voyage motion frequent and the observation planet detailed", () => {
    expect(ARKSHIP_EXTERIOR_DESIGN.nearFieldCount.balanced).toBeGreaterThanOrEqual(180);
    expect(ARKSHIP_EXTERIOR_DESIGN.travelStreakCount.balanced).toBeGreaterThanOrEqual(36);
    expect(ARKSHIP_EXTERIOR_DESIGN.travelPulseSeconds).toBeLessThanOrEqual(20);
    expect(ARKSHIP_EXTERIOR_DESIGN.planetPassSeconds).toBeLessThanOrEqual(180);
    expect(ARKSHIP_EXTERIOR_DESIGN.nearFieldSpeed).toBeGreaterThanOrEqual(7);
    expect(ARKSHIP_EXTERIOR_DESIGN.planetWidthSegments.balanced).toBeGreaterThanOrEqual(64);
    expect(ARKSHIP_EXTERIOR_DESIGN.ringSegments.cinematic).toBeGreaterThanOrEqual(192);
    expect(ARKSHIP_EXTERIOR_DESIGN.planetSurfaceOpacity).toBe(1);
    expect(ARKSHIP_EXTERIOR_DESIGN.motionRenderOrder).toBeLessThan(-3);
    expect(ARKSHIP_NAVIGATION_DESIGN.views).toEqual(["journey", "habitat", "community"]);
    expect(ARKSHIP_NAVIGATION_DESIGN.viewSeconds).toBeGreaterThanOrEqual(15);
    expect(ARKSHIP_NAVIGATION_DESIGN.destination).toBeTruthy();
  });

  it("makes Alexandria the sole scroll-based display world", () => {
    const alexandria = getWorld("alexandria");
    expect(alexandria.displayArtifact).toBe("scroll");
    expect(alexandria.exterior.kind).toBe("harbor-diorama");
    expect(alexandria.boundary.style).toBe("alexandrian");
    expect(alexandria.boundary.barrierKind).toBe("doors");
    expect(alexandria.obstacles).toEqual([{ minX: -1.28, maxX: 1.28, minZ: -1.28, maxZ: 1.28 }, { minX: -3.05, maxX: 3.05, minZ: 10.15, maxZ: 11.13 }]);
    expect(WORLDS.filter((world) => world.displayArtifact === "scroll").map((world) => world.id)).toEqual(["alexandria"]);
  });

  it("keeps Alexandria scroll cases legible beyond the practical-light falloff", () => {
    const alexandria = getWorld("alexandria");
    expect(alexandria.lighting.exposure).toBeGreaterThanOrEqual(0.74);
    expect(alexandria.lighting.ambient).toBeGreaterThanOrEqual(0.7);
    expect(alexandria.lighting.hemisphere).toBeGreaterThanOrEqual(0.3);
    expect(alexandria.lighting.key).toBeGreaterThanOrEqual(0.2);
    expect(alexandria.scene.ambientIntensity).toBeGreaterThanOrEqual(0.8);
    expect(alexandria.scene.shelf).toBe("#815136");
    expect(alexandria.scene.shelfDark).toBe("#3b281e");
  });

  it("gives Alexandria deep dark-cedar scroll cubbies with a bright plaster lining", () => {
    const longestScroll = Math.max(...Array.from({ length: 565 }, (_, index) => scrollPresentation(`scroll-${index}`).depth));
    expect(getScrollBayUsableDepth()).toBeGreaterThanOrEqual(longestScroll + 0.16);
    expect(SCROLL_BAY_DESIGN.outerDepth).toBeGreaterThanOrEqual(1.05);
    expect(SCROLL_BAY_DESIGN.slotDividerDepth).toBeGreaterThanOrEqual(0.8);
    expect(SCROLL_BAY_DESIGN.dividerColor).not.toBe(getWorld("alexandria").scene.shelfDark);
    expect(SCROLL_BAY_DESIGN.dividerColor).not.toBe("#b97843");
    expect(SCROLL_BAY_DESIGN.dividerRoughness).toBeLessThanOrEqual(0.46);
    expect(SCROLL_BAY_DESIGN.woodTextures.map).toContain("shelf-wood-color");
    expect(SCROLL_BAY_DESIGN.liningColor).not.toBe(getWorld("alexandria").scene.background);
    expect(SCROLL_BAY_DESIGN.liningTextures.map).toContain("dome-plaster-color");
    expect(SCROLL_BAY_DESIGN.liningTextures.map).not.toContain("marble");
  });

  it("keeps Alexandria's centered doorway clear of its astronomical fresco", () => {
    const alexandria = getWorld("alexandria");
    expect(alexandria.boundary.placements[0].position[0]).toBe(ALEXANDRIA_ENTRANCE_DESIGN.centerX);
    expect(ALEXANDRIA_ENTRANCE_DESIGN.centerX).toBe(0);
    expect(alexandria.bays.at(-1)?.position[0]).toBe(ALEXANDRIA_ENTRANCE_DESIGN.rearShelfCenterX);
    expect(getAlexandriaMuralClearance()).toBeGreaterThanOrEqual(0.15);
    expect(ALEXANDRIA_ENTRANCE_DESIGN.portalHalfWidth).toBeLessThan(3.3);
    expect(ALEXANDRIA_ENTRANCE_DESIGN.muralZ).toBeLessThan(10.79);
    expect(ALEXANDRIA_ENTRANCE_DESIGN.frameColor).toBe(alexandria.scene.trim);
    expect(ALEXANDRIA_ENTRANCE_DESIGN.bronzeColor).not.toBe(ALEXANDRIA_ENTRANCE_DESIGN.frameColor);
  });

  it("keeps Alexandria's preferred open harbor consistent across quality levels", () => {
    expect(ALEXANDRIA_HARBOR_COMPOSITION).toEqual({
      detailedQuays: false,
      cityRelief: false,
      detailedVessels: false,
      landmarks: false
    });
  });

  it("gives the Alexandrian catalogue varied but deterministic scroll furniture", () => {
    const ids = Array.from({ length: 565 }, (_, index) => `scroll-${index}`);
    const presentations = ids.map(scrollPresentation);
    expect(new Set(presentations.map((presentation) => presentation.archetype)).size).toBe(24);
    expect(new Set(presentations.map((presentation) => presentation.parchmentColor)).size).toBeGreaterThanOrEqual(8);
    expect(presentations.filter((presentation) => presentation.hasLooseWrap).length).toBeGreaterThan(100);
    expect(presentations.filter((presentation) => presentation.hasBinding).length).toBeGreaterThan(50);
    for (const id of ids.slice(0, 30)) expect(scrollPresentation(id)).toEqual(scrollPresentation(id));
    for (const presentation of presentations) {
      expect(presentation.depth).toBeGreaterThanOrEqual(0.52);
      expect(presentation.depth).toBeLessThanOrEqual(0.72);
      expect(Math.abs(presentation.tilt)).toBeLessThanOrEqual(0.04);
    }
  });

  it("balances long Alexandrian plaque labels without orphaning one word", () => {
    const balanced = balanceScrollPlaqueLabel("Classical Liberal Lineage Mainstream Economic Context", 28);
    const lines = balanced.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.split(" ").length > 1)).toBe(true);
  });
});
