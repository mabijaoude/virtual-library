import { FOUNDRY_RELAY_OBSTACLES } from "./foundryRelayDesign";
import type { WorldAssetBundle, WorldDefinition, WorldId } from "./types";
import { ALEXANDRIA_ENTRANCE_DESIGN } from "./alexandriaEntrance";
import { RENAISSANCE_BAYS, RENAISSANCE_COLUMN_Z } from "./renaissanceArchitecture";
import assetRevisions from "./assetRevisions.json";

const backWall = (z: number, xs: number[], width = 3.8) => xs.map((x) => ({ position: [x, 0, z] as [number, number, number], rotationY: 0, width }));
const sideWall = (x: number, zs: number[], rotationY: number, width = 3.8) => zs.map((z) => ({ position: [x, 0, z] as [number, number, number], rotationY, width }));
const inwardAnchor = (x: number, z: number, width = 3.8) => ({
  position: [x, 0, z] as [number, number, number],
  rotationY: Math.atan2(-x, -z),
  width
});

const standardMotion = {
  floorHeight: 1.82,
  walkSpeed: 3.25,
  sprintSpeed: 5.4,
  acceleration: 11,
  braking: 7,
  jumpVelocity: 5.2,
  gravity: 14,
  airControl: 0.82
} as const;

const staticExterior = { kind: "backplate" } as const;
const worldPreview = (id: WorldId) => `/worlds/previews/${id}.webp?v=${assetRevisions.previews[id]}`;
const worldAsset = (id: WorldId, path: string) => `${path}?v=${assetRevisions.assets[id]}`;

function worldAssets(id: WorldId, hasArt = true): WorldAssetBundle {
  return {
    completeModel: worldAsset(id, `/worlds/assets/models/${id}-cinematic.glb`),
    fallbackModel: `${worldAsset(id, `/worlds/assets/models/${id}-lite.glb`)}&startup=${assetRevisions.startup}`,
    environment: worldAsset(id, `/worlds/assets/environments/${id}.hdr`),
    backplate: id === "deco" ? undefined : worldAsset(id, `/worlds/assets/backplates/${id}.webp`),
    art: hasArt ? worldAsset(id, `/worlds/assets/art/${id}.webp`) : undefined,
    lightmaps: [] as string[],
    audioZones: [`${id}-ambient`],
    byteBudget: 16 * 1024 * 1024,
    fallbackByteBudget: 2 * 1024 * 1024
  };
}

const WORLD_DEFINITIONS: readonly WorldDefinition[] = [
  {
    id: "heritage",
    label: "Heritage Oak",
    shortLabel: "Heritage",
    era: "Georgian reading hall",
    description: "A double-height oak library gathered around a carved fireplace and a lantern-lit reading table.",
    landmark: "The King's Gallery",
    swatches: ["#4f241b", "#c49a54", "#24483d"],
    preview: worldPreview("heritage"),
    load: () => import("./heritage"),
    assets: worldAssets("heritage"),
    cameraFar: 110,
    exterior: staticExterior,
    motion: standardMotion,
    lighting: { exposure: 0.98, ambient: 0.78, hemisphere: 0.38, key: 0.32, practical: 0.64, environment: 0.52 },
    spawn: { position: [-3.5, 1.82, 6.5], yaw: -0.26, pitch: 0.015 },
    bounds: { minX: -9.2, maxX: 9.2, minZ: -10.2, maxZ: 10.2 },
    obstacles: [
      { minX: -1.4, maxX: 1.4, minZ: 0.3, maxZ: 2.15 },
      { minX: -2.3, maxX: 2.3, minZ: -8.9, maxZ: -7.2 },
      { minX: -8.9, maxX: -7.6, minZ: -1.4, maxZ: 1.4 }
    ],
    boundary: { placements: [{ position: [0, 0, 10.55], rotationY: Math.PI }], span: 19.2, width: 4.0, height: 4.5, depth: 7.4, style: "georgian", barrierKind: "doors" },
    bays: [...backWall(-9.92, [-5.6, 5.6]), ...sideWall(-8.72, [-6.7, -2.1, 2.5, 7.1], Math.PI / 2), ...sideWall(8.72, [-5.2, 0, 5.2], -Math.PI / 2)],
    expansion: { origin: [-8.72, 0, 10], direction: [0, 0, 1], spacing: 4.3, rotationY: Math.PI / 2 },
    scene: {
      background: "#1b120d", fog: "#2a1a12", fogNear: 18, fogFar: 42, exposure: 1.1,
      ambient: "#f5d9ad", ambientIntensity: 0.7, key: "#ffe9c7", keyPosition: [-7, 11, 8], keyIntensity: 3.7,
      practical: "#ffc77c", practicalIntensity: 3.4, floor: "#3b2117", wall: "#67432e", shelf: "#c28a61",
      shelfDark: "#68442f", shelfBack: "#8c5e43", trim: "#d09a56", metal: "#d1ad66", paper: "#efddb8", accent: "#e1b65d",
      secondary: "#5b9f8e", bookPalette: ["#7f342c", "#98532f", "#356a57", "#395d70", "#7b5728", "#724563"], bloom: 0.15, vignette: 0.28,
      grade: { hue: 0.01, saturation: 0.08, contrast: 0.08, brightness: 0.01 }
    },
    ui: { shell: "#15100d", panel: "rgba(21,16,13,.9)", panelSolid: "#211711", line: "rgba(229,204,162,.22)", text: "#f7edda", muted: "#c6b59a", accent: "#d5a850", accentText: "#211208", secondary: "#6fb3a1", paper: "#f2ead9", ink: "#292019" }
  },
  {
    id: "gothic",
    label: "Gothic Nocturne",
    shortLabel: "Gothic",
    era: "Cathedral archive",
    description: "A moonlit nave of limestone, stained glass, wrought iron, and chapel-like book alcoves.",
    landmark: "The Rose Window Nave",
    swatches: ["#11151d", "#8b293d", "#809ac1"],
    preview: worldPreview("gothic"),
    load: () => import("./gothic"),
    assets: worldAssets("gothic"),
    cameraFar: 110,
    exterior: staticExterior,
    motion: standardMotion,
    lighting: { exposure: 0.86, ambient: 0.66, hemisphere: 0.32, key: 0.36, practical: 0.4, environment: 0 },
    spawn: { position: [-1.8, 1.82, 9.2], yaw: -0.15, pitch: 0.06 },
    bounds: { minX: -8.4, maxX: 8.4, minZ: -13.1, maxZ: 13.1 },
    obstacles: [
      { minX: -7.7, maxX: -6.7, minZ: -10.2, maxZ: 10.2 },
      { minX: 6.7, maxX: 7.7, minZ: -10.2, maxZ: 10.2 }
    ],
    boundary: { placements: [{ position: [0, 0, 13.3], rotationY: Math.PI }], span: 16.4, width: 4.0, height: 5.2, depth: 8.6, style: "gothic", barrierKind: "doors" },
    bays: [
      ...sideWall(7.45, [7, 0, -7], -Math.PI / 2, 4.3),
      ...backWall(-11.8, [4.7, -4.7], 3.5),
      ...sideWall(-7.45, [-9, -3, 3, 9], Math.PI / 2, 3.9)
    ],
    expansion: { origin: [-7.45, 0, 11.5], direction: [0, 0, 1], spacing: 4.7, rotationY: Math.PI / 2 },
    scene: {
      background: "#05080d", fog: "#0c1320", fogNear: 17, fogFar: 46, exposure: 1.24,
      ambient: "#7f96bd", ambientIntensity: 0.6, key: "#a9cfff", keyPosition: [0, 10.5, -16], keyIntensity: 3.8,
      practical: "#ff9d52", practicalIntensity: 3.05, floor: "#15171c", wall: "#3a3c43", shelf: "#211719",
      shelfDark: "#08090c", shelfBack: "#3a292a", trim: "#5c4342", metal: "#7c8794", paper: "#cfc4aa", accent: "#c04d67",
      secondary: "#91add7", bookPalette: ["#281217", "#451824", "#17263b", "#202a2b", "#39291d", "#1a131a"], bloom: 0.2, vignette: 0.32,
      grade: { hue: -0.02, saturation: -0.03, contrast: 0.06, brightness: 0.01 }
    },
    ui: { shell: "#070a10", panel: "rgba(9,13,20,.92)", panelSolid: "#111722", line: "rgba(166,184,214,.22)", text: "#eef2f8", muted: "#aeb8ca", accent: "#c6536c", accentText: "#fff7f8", secondary: "#91add7", paper: "#ede7da", ink: "#24242a" }
  },
  {
    id: "modern",
    label: "Modern Archive",
    shortLabel: "Modern",
    era: "Museum archive",
    description: "A sunlit travertine atrium of pale-oak stacks, a glass roof, and cobalt wayfinding.",
    landmark: "The Daylight Index",
    swatches: ["#deddd6", "#27313a", "#236aa2"],
    preview: worldPreview("modern"),
    load: () => import("./modern"),
    assets: worldAssets("modern", false),
    cameraFar: 110,
    exterior: staticExterior,
    motion: standardMotion,
    lighting: { exposure: 0.78, ambient: 0.58, hemisphere: 0.3, key: 0.42, practical: 0.16, environment: 0.32 },
    spawn: { position: [-4.1, 1.82, 8.0], yaw: -0.46, pitch: 0.035 },
    bounds: { minX: -12.5, maxX: 12.5, minZ: -9.3, maxZ: 9.3 },
    obstacles: [
      { minX: -2.8, maxX: 2.8, minZ: -1.9, maxZ: 1.9 },
      { minX: -11.35, maxX: -9.85, minZ: -9.0, maxZ: 9.0 },
      { minX: 9.85, maxX: 11.35, minZ: -9.0, maxZ: 9.0 },
      { minX: 4.15, maxX: 9.05, minZ: 8.1, maxZ: 9.35 }
    ],
    boundary: {
      placements: [
        { position: [-12.47, 0, 7.3], rotationY: Math.PI / 2 },
        { position: [0, 0, 9.82], rotationY: Math.PI }
      ],
      span: 19.0, width: 5.2, height: 5.0, depth: 7.8, style: "modern", barrierKind: "doors"
    },
    bays: [
      { position: [-10.8, 0, -6.9], rotationY: Math.PI / 2, width: 4.15 },
      { position: [-10.8, 0, -2.3], rotationY: Math.PI / 2, width: 4.15 },
      { position: [-10.8, 0, 2.3], rotationY: Math.PI / 2, width: 4.15 },
      { position: [-10.8, 0, 6.9], rotationY: Math.PI / 2, width: 4.15 },
      { position: [10.8, 0, -6.9], rotationY: -Math.PI / 2, width: 4.15 },
      { position: [10.8, 0, -2.3], rotationY: -Math.PI / 2, width: 4.15 },
      { position: [10.8, 0, 2.3], rotationY: -Math.PI / 2, width: 4.15 },
      { position: [10.8, 0, 6.35], rotationY: -Math.PI / 2, width: 3.2 },
      { position: [-6.6, 0, 8.85], rotationY: Math.PI, width: 4.2 }
    ],
    expansion: { origin: [0, 0, 8.5], direction: [1, 0, 0], spacing: 4.8, rotationY: Math.PI },
    scene: {
      background: "#c8cecf", fog: "#d8dddd", fogNear: 20, fogFar: 50, exposure: 0.84,
      ambient: "#eaf5ff", ambientIntensity: 0.76, key: "#ffffff", keyPosition: [-8, 14, 5], keyIntensity: 3.55,
      practical: "#d4efff", practicalIntensity: 1.1, floor: "#c6baa4", wall: "#e0e1dc", shelf: "#baa98d",
      shelfDark: "#2c3840", shelfBack: "#617078", trim: "#eee8dc", metal: "#26343e", paper: "#f2f0e8", accent: "#2f73ab",
      secondary: "#b54f42", bookPalette: ["#293e4b", "#59665e", "#8b4a40", "#6f5d3c", "#405976", "#6d4555"], bloom: 0.08, vignette: 0.12,
      grade: { hue: -0.01, saturation: -0.06, contrast: 0.04, brightness: 0.035 }
    },
    ui: { shell: "#e1e3e1", panel: "rgba(247,248,246,.92)", panelSolid: "#f3f4f1", line: "rgba(33,48,58,.2)", text: "#17252d", muted: "#60707a", accent: "#2f73ab", accentText: "#fff", secondary: "#ad4b40", paper: "#fbfaf6", ink: "#1d252a" }
  },
  {
    id: "renaissance",
    label: "Renaissance Scriptorium",
    shortLabel: "Renaissance",
    era: "Italian cloister",
    description: "A walnut-lined loggia surrounding a sunlit marble courtyard of arcades and flowing water.",
    landmark: "The Court of Letters",
    swatches: ["#d8c9a3", "#31558c", "#aa573b"],
    preview: worldPreview("renaissance"),
    load: () => import("./renaissance"),
    assets: worldAssets("renaissance", false),
    cameraFar: 110,
    exterior: staticExterior,
    motion: standardMotion,
    lighting: { exposure: 0.76, ambient: 0.58, hemisphere: 0.3, key: 0.34, practical: 0.2, environment: 0.34 },
    spawn: { position: [0, 1.82, 8.8], yaw: 0, pitch: -0.035 },
    bounds: { minX: -10.8, maxX: 10.8, minZ: -10.8, maxZ: 10.8 },
    obstacles: [
      { minX: -2.3, maxX: 2.3, minZ: -2.3, maxZ: 2.3 },
      { minX: -1.85, maxX: 1.85, minZ: -10.1, maxZ: -9.25 },
      ...[-5.25, 5.25].flatMap((x) => RENAISSANCE_COLUMN_Z.map((z) => ({ minX: x - 0.39, maxX: x + 0.39, minZ: z - 0.39, maxZ: z + 0.39 })))
    ],
    boundary: { placements: [{ position: [0, 0, 10.88], rotationY: Math.PI }], span: 21.2, width: 4.0, height: 4.8, depth: 7.6, style: "renaissance", barrierKind: "doors" },
    bays: RENAISSANCE_BAYS,
    expansion: { origin: [-9.35, 0, 10.1], direction: [0, 0, 1], spacing: 4.5, rotationY: Math.PI / 2 },
    scene: {
      background: "#9ebbd0", fog: "#c8d2ca", fogNear: 21, fogFar: 52, exposure: 1.02,
      ambient: "#f6e8bd", ambientIntensity: 0.78, key: "#fff6d6", keyPosition: [-6, 13, 3], keyIntensity: 5,
      practical: "#ffd28a", practicalIntensity: 1.4, floor: "#824a2d", wall: "#cdbc91", shelf: "#653a24",
      shelfDark: "#2b1b13", shelfBack: "#7b4c32", trim: "#b87a48", metal: "#ad7b3e", paper: "#efe2bd", accent: "#aa5338",
      secondary: "#426aa3", bookPalette: ["#783b2c", "#315883", "#315c49", "#76502a", "#68435b", "#512f21"], bloom: 0.12, vignette: 0.18,
      grade: { hue: 0.015, saturation: 0.09, contrast: 0.065, brightness: 0.025 }
    },
    ui: { shell: "#d6cdb7", panel: "rgba(249,244,230,.94)", panelSolid: "#f2ead7", line: "rgba(75,55,35,.22)", text: "#30261d", muted: "#756553", accent: "#aa5338", accentText: "#fff", secondary: "#426aa3", paper: "#fbf5e5", ink: "#30271e" }
  },
  {
    id: "deco",
    label: "Art Deco Athenaeum",
    shortLabel: "Deco",
    era: "Metropolitan penthouse",
    description: "An octagonal reading salon of ebony, warm brass, emerald velvet, and softly illuminated geometric ceilings.",
    landmark: "The Metropolitan Crown",
    swatches: ["#131514", "#c3a35b", "#17685b"],
    preview: worldPreview("deco"),
    load: () => import("./deco"),
    assets: worldAssets("deco", false),
    cameraFar: 110,
    exterior: staticExterior,
    motion: standardMotion,
    lighting: { exposure: 0.86, ambient: 0.68, hemisphere: 0.36, key: 0.3, practical: 0.46, environment: 0.44 },
    spawn: { position: [-0.7, 1.82, 5.8], yaw: -0.055, pitch: -0.035 },
    bounds: { minX: -9.6, maxX: 9.6, minZ: -9.6, maxZ: 9.6 },
    walkablePolygon: [
      { x: -3.82, z: -9.18 }, { x: 3.82, z: -9.18 },
      { x: 9.18, z: -3.82 }, { x: 9.18, z: 3.82 },
      { x: 3.82, z: 9.18 }, { x: -3.82, z: 9.18 },
      { x: -9.18, z: 3.82 }, { x: -9.18, z: -3.82 }
    ],
    obstacles: [
      { minX: -1.05, maxX: 1.05, minZ: -1.05, maxZ: 1.05 },
      { minX: -1.9, maxX: 1.9, minZ: 8.84, maxZ: 9.6 }
    ],
    boundary: { placements: [{ position: [0, 0, 9.12], rotationY: Math.PI }], span: 7.0, width: 3.2, height: 4.4, depth: 6.6, style: "deco", barrierKind: "doors" },
    bays: [
      { position: [-2.035, 0, -8.35], rotationY: 0, width: 3 }, { position: [2.035, 0, -8.35], rotationY: 0, width: 3 },
      inwardAnchor(-6, -6, 4.2), inwardAnchor(-8.35, 0, 4.2),
      { position: [-6.75, 0, 5.05], rotationY: 3 * Math.PI / 4, width: 4.2 },
      { position: [8.35, 0, 2.035], rotationY: -Math.PI / 2, width: 3 }, inwardAnchor(6, 6, 4.2),
      { position: [8.35, 0, -2.035], rotationY: -Math.PI / 2, width: 3 }, inwardAnchor(6, -6, 4.2)
    ],
    expansion: { origin: [0, 0, 10.5], direction: [0, 0, 1], spacing: 4.8, rotationY: Math.PI },
    scene: {
      background: "#090d0e", fog: "#111b1a", fogNear: 19, fogFar: 44, exposure: 1.12,
      ambient: "#b9cbc4", ambientIntensity: 0.55, key: "#e9f6ee", keyPosition: [-5, 11, 6], keyIntensity: 3.8,
      practical: "#ffc568", practicalIntensity: 2.9, floor: "#171817", wall: "#34362f", shelf: "#24221e",
      shelfDark: "#0c0e0d", shelfBack: "#3e3a30", trim: "#594c38", metal: "#c4a35b", paper: "#e4d9be", accent: "#c5a35b",
      secondary: "#3da18d", bookPalette: ["#171b1b", "#1c5046", "#54282a", "#303d54", "#634c2a", "#3b2c40"], bloom: 0.14, vignette: 0.32,
      grade: { hue: 0.005, saturation: 0.07, contrast: 0.13, brightness: 0.005 }
    },
    ui: { shell: "#0e1211", panel: "rgba(15,20,18,.92)", panelSolid: "#161c1a", line: "rgba(216,188,124,.23)", text: "#f2ebdc", muted: "#b9b5a8", accent: "#c5a35b", accentText: "#171208", secondary: "#45a794", paper: "#f1ebdc", ink: "#24251f" }
  },
  {
    id: "foundry",
    label: "Neon Foundry",
    shortLabel: "Foundry",
    era: "Chronomechanical archive",
    description: "A brass-and-black-steel repository alive with aether machinery, cyan data glass, copper circuits, and magenta signal light.",
    landmark: "The Aether Index",
    swatches: ["#11181d", "#c4873b", "#19d9d1"],
    preview: worldPreview("foundry"),
    load: () => import("./foundry"),
    assets: worldAssets("foundry", false),
    cameraFar: 110,
    exterior: staticExterior,
    motion: standardMotion,
    lighting: { exposure: 0.8, ambient: 0.76, hemisphere: 0.28, key: 0.48, practical: 0.36, environment: 0.58 },
    spawn: { position: [-5.8, 1.82, 5.6], yaw: -1.18, pitch: -0.035 },
    bounds: { minX: -12.1, maxX: 12.1, minZ: -10.1, maxZ: 10.1 },
    obstacles: [
      { minX: -2.25, maxX: 2.25, minZ: 2.65, maxZ: 4.1 },
      ...FOUNDRY_RELAY_OBSTACLES
    ],
    boundary: { placements: [{ position: [0, 0, 10.42], rotationY: Math.PI }], span: 24.0, width: 4.4, height: 4.5, depth: 8.2, style: "industrial", barrierKind: "doors" },
    bays: [
      ...backWall(-8.65, [-7.5, -2.5, 2.5, 7.5], 4.15),
      { position: [-11.15, 0, -4.4], rotationY: Math.PI / 2, width: 4.2 },
      { position: [-11.15, 0, 3.2], rotationY: Math.PI / 2, width: 3.2 },
      { position: [11.15, 0, -4.4], rotationY: -Math.PI / 2, width: 4.2 },
      { position: [11.15, 0, 3.2], rotationY: -Math.PI / 2, width: 3.2 },
      { position: [11.15, 0, 7.3], rotationY: -Math.PI / 2, width: 4.2 }
    ],
    expansion: { origin: [-11.15, 0, 9.1], direction: [0, 0, 1], spacing: 4.7, rotationY: Math.PI / 2 },
    scene: {
      background: "#020608", fog: "#071218", fogNear: 20, fogFar: 52, exposure: 1.12,
      ambient: "#80c8cf", ambientIntensity: 0.43, key: "#89fff5", keyPosition: [-7, 12, 6], keyIntensity: 3.8,
      practical: "#ffad4d", practicalIntensity: 3.2, floor: "#11191d", wall: "#1a252b", shelf: "#18252b",
      shelfDark: "#05090c", shelfBack: "#2b3e45", trim: "#734825", metal: "#c4873b", paper: "#d6ddd4", accent: "#19d9d1",
      secondary: "#e64e9c", bookPalette: ["#17232a", "#3a221b", "#183a3d", "#40223a", "#3c351e", "#162b40"], bloom: 0.42, vignette: 0.3,
      grade: { hue: -0.01, saturation: 0.12, contrast: 0.16, brightness: -0.015 }
    },
    ui: { shell: "#03080b", panel: "rgba(4,11,15,.92)", panelSolid: "#081218", line: "rgba(69,226,218,.23)", text: "#e8f4f2", muted: "#9db4b7", accent: "#19d9d1", accentText: "#031214", secondary: "#e64e9c", paper: "#edf0e8", ink: "#182124" }
  },
  {
    id: "lunar",
    label: "Lunar South Pole Archive",
    shortLabel: "Moon Base",
    era: "Lunar research habitat",
    description: "A pressure-sealed archive overlooking long-shadowed craters, the black lunar sky, and Earth above the horizon.",
    landmark: "The Earthwatch Gallery",
    swatches: ["#d8dfe2", "#202b35", "#dc943f"],
    preview: worldPreview("lunar"),
    load: () => import("./lunar"),
    assets: worldAssets("lunar", false),
    cameraFar: 1600,
    exterior: { kind: "lunar", earthAngularDiameter: 2, starSeed: 19721211 },
    motion: { ...standardMotion, walkSpeed: 3, sprintSpeed: 4.6, acceleration: 9, jumpVelocity: 1.35, gravity: 1.62, airControl: 0.48 },
    lighting: { exposure: 0.74, ambient: 0.48, hemisphere: 0.2, key: 0.46, practical: 0.34, environment: 0.38 },
    spawn: { position: [3.2, 1.82, 7.8], yaw: 0.12, pitch: 0.035 },
    bounds: { minX: -10.55, maxX: 10.55, minZ: -10.1, maxZ: 10.0 },
    obstacles: [
      { minX: -1.8, maxX: 1.8, minZ: -0.8, maxZ: 1.2 },
      // The sealed habitat door includes projecting pressure latches.
      { minX: 1.82, maxX: 6.18, minZ: 9.49, maxZ: 10.45 },
      { minX: -6.4, maxX: -4.0, minZ: -8.45, maxZ: -7.15 },
      { minX: 4.0, maxX: 6.4, minZ: -8.45, maxZ: -7.15 }
    ],
    boundary: { placements: [{ position: [4.0, 0, 10.18], rotationY: Math.PI }], span: 20.8, width: 3.5, height: 4.4, depth: 7.5, style: "lunar", barrierKind: "doors" },
    bays: [
      ...sideWall(-10.05, [-7.1, -2.3, 2.5, 7.3], Math.PI / 2, 4.1),
      ...sideWall(10.05, [-7.1, -2.3, 2.5, 7.3], -Math.PI / 2, 4.1),
      { position: [-5.1, 0, 9.55], rotationY: Math.PI, width: 4.2 }
    ],
    expansion: { origin: [-10.05, 0, 11.7], direction: [0, 0, 1], spacing: 4.6, rotationY: Math.PI / 2 },
    scene: {
      background: "#020306", fog: "#080b0f", fogNear: 220, fogFar: 1500, exposure: 0.92,
      ambient: "#d9e7ee", ambientIntensity: 0.7, key: "#fff0c9", keyPosition: [-48, 18, -70], keyIntensity: 4.8,
      practical: "#ffc36b", practicalIntensity: 2.2, floor: "#2a3137", wall: "#d7dcdd", shelf: "#a9b2b7",
      shelfDark: "#182129", trim: "#566773", metal: "#758994", paper: "#e8e4d9", accent: "#4aa6d8",
      secondary: "#dc943f", bookPalette: ["#24394b", "#4a4f55", "#9b6432", "#3d5963", "#694858", "#65725c"], bloom: 0.12, vignette: 0.2,
      grade: { hue: -0.015, saturation: -0.03, contrast: 0.12, brightness: -0.01 }
    },
    ui: { shell: "#10171d", panel: "rgba(17,25,31,.92)", panelSolid: "#182229", line: "rgba(180,209,222,.23)", text: "#eff5f5", muted: "#afbec4", accent: "#4aa6d8", accentText: "#071219", secondary: "#dc943f", paper: "#f2f1eb", ink: "#20282d" }
  },
  {
    id: "arkship",
    label: "Arkship Memory Gallery",
    shortLabel: "Arkship",
    era: "Midships interstellar archive",
    description: "An asymmetrical memory gallery aboard a deep-space ark, with protected archive stacks, a starboard observation promenade, and the vessel's hull visible beyond the glass.",
    landmark: "The Starboard Promenade",
    swatches: ["#08111c", "#61c7da", "#a86d3c"],
    preview: worldPreview("arkship"),
    load: () => import("./arkship"),
    assets: worldAssets("arkship", false),
    cameraFar: 900,
    exterior: { kind: "deep-space", starSeed: 24112079, voyageSeconds: 480 },
    motion: standardMotion,
    lighting: { exposure: 0.98, ambient: 0.9, hemisphere: 0.3, key: 0.42, practical: 0.58, environment: 0.5 },
    spawn: { position: [4.3, 1.82, 8.2], yaw: -1.1, portraitYaw: -1.48, pitch: 0.025 },
    bounds: { minX: -10.55, maxX: 10.55, minZ: -13.72, maxZ: 13.72 },
    obstacles: [
      { minX: -2.55, maxX: 2.55, minZ: -6.05, maxZ: -4.35 },
      { minX: -2.55, maxX: 2.55, minZ: 3.55, maxZ: 5.25 },
      { minX: 7.0, maxX: 8.5, minZ: -0.8, maxZ: 0.8 }
    ],
    boundary: { placements: [{ position: [4.25, 0, 13.95], rotationY: Math.PI }], span: 21.0, width: 5.2, height: 4.65, depth: 9.2, style: "starship", barrierKind: "doors" },
    bays: [
      ...sideWall(-10.05, [-9.2, -3.1, 3.0, 9.1], Math.PI / 2, 4.15),
      { position: [0, 0, -4.82], rotationY: 0, width: 4.4 },
      { position: [0, 0, -5.58], rotationY: Math.PI, width: 4.4 },
      { position: [0, 0, 4.78], rotationY: 0, width: 4.4 },
      { position: [0, 0, 4.02], rotationY: Math.PI, width: 4.4 },
      { position: [-3.7, 0, 13.2], rotationY: Math.PI, width: 4.4 }
    ],
    expansion: { origin: [-10.05, 0, 15.4], direction: [0, 0, 1], spacing: 4.7, rotationY: Math.PI / 2 },
    scene: {
      background: "#01040a", fog: "#050a12", fogNear: 105, fogFar: 820, exposure: 0.88,
      ambient: "#afcfdf", ambientIntensity: 0.58, key: "#d9f1f8", keyPosition: [8, 10, -8], keyIntensity: 2.6,
      practical: "#ffd29a", practicalIntensity: 3.2, floor: "#1c2935", wall: "#304351", shelf: "#3d5261",
      shelfDark: "#13202b", trim: "#b77942", metal: "#8298a5", paper: "#e8e4da", accent: "#6fd4e4",
      secondary: "#d89b61", bookPalette: ["#21445c", "#516777", "#a96d45", "#39717a", "#86536c", "#667f5d"], bloom: 0.13, vignette: 0.18,
      grade: { hue: -0.018, saturation: 0.01, contrast: 0.08, brightness: 0.04 }
    },
    ui: { shell: "#070d14", panel: "rgba(8,15,23,.94)", panelSolid: "#101b25", line: "rgba(128,191,211,.25)", text: "#edf4f7", muted: "#a6b7c2", accent: "#61c7da", accentText: "#061118", secondary: "#c9854d", paper: "#f0eee8", ink: "#1a232a" }
  },
  {
    id: "alexandria",
    label: "The Alexandrian Mouseion",
    shortLabel: "Alexandria",
    era: "Ptolemaic research sanctuary",
    description: "A sun-warmed hall of papyrus archives, painted colonnades, scholars' tables, and harbor light from the Pharos.",
    landmark: "The Hall of the Pinakes",
    swatches: ["#d6c69d", "#174a70", "#a95c38"],
    preview: worldPreview("alexandria"),
    load: () => import("./alexandria"),
    assets: worldAssets("alexandria"),
    cameraFar: 140,
    exterior: { kind: "harbor-diorama", motionSeed: 247, waterSpeed: 0.012 },
    displayArtifact: "scroll",
    motion: { ...standardMotion, walkSpeed: 3.1, sprintSpeed: 5.0 },
    lighting: { exposure: 0.88, ambient: 0.7, hemisphere: 0.34, key: 0.46, practical: 0.24, environment: 0.46 },
    spawn: { position: [2.7, 1.82, 8.5], yaw: 0.08, portraitYaw: 0.3, pitch: -0.025 },
    bounds: { minX: -11.25, maxX: 11.25, minZ: -10.65, maxZ: 10.85 },
    obstacles: [{ minX: -1.28, maxX: 1.28, minZ: -1.28, maxZ: 1.28 }, { minX: -3.05, maxX: 3.05, minZ: 10.15, maxZ: 11.13 }],
    boundary: { placements: [{ position: [ALEXANDRIA_ENTRANCE_DESIGN.centerX, 0, 11.08], rotationY: Math.PI }], span: 22.2, width: 4.2, height: 4.8, depth: 8.8, style: "alexandrian", barrierKind: "doors" },
    bays: [
      ...sideWall(-10.55, [-7.6, -2.4, 2.8, 8.0], Math.PI / 2, 4.15),
      ...sideWall(10.55, [-7.6, -2.4, 2.8, 8.0], -Math.PI / 2, 4.15),
      { position: [ALEXANDRIA_ENTRANCE_DESIGN.rearShelfCenterX, 0, 10.35], rotationY: Math.PI, width: 4.15 }
    ],
    expansion: { origin: [-10.55, 0, 12.1], direction: [0, 0, 1], spacing: 4.7, rotationY: Math.PI / 2 },
    scene: {
      background: "#789bb0", fog: "#9ca99f", fogNear: 34, fogFar: 118, exposure: 0.82,
      ambient: "#f4dfb2", ambientIntensity: 0.82, key: "#fff0c4", keyPosition: [-8, 14, 2], keyIntensity: 2.15,
      practical: "#efb66b", practicalIntensity: 1.7, floor: "#b2835d", wall: "#d5c69e", shelf: "#815136",
      shelfDark: "#3b281e", trim: "#255f86", metal: "#b5904d", paper: "#dec58a", accent: "#225d84",
      secondary: "#a95238", bookPalette: ["#d6bd7d", "#c6a765", "#e1cb92", "#bda268", "#dcc486", "#c7ad74"], bloom: 0.1, vignette: 0.16,
      grade: { hue: 0.012, saturation: 0.07, contrast: 0.075, brightness: 0.018 }
    },
    ui: { shell: "#18212a", panel: "rgba(26,34,39,.93)", panelSolid: "#202a2f", line: "rgba(224,197,137,.25)", text: "#f6edda", muted: "#c8bca3", accent: "#caa45c", accentText: "#24170d", secondary: "#4d91b9", paper: "#f2e7cc", ink: "#302217" }
  }
] as const;

const WORLD_ORDER: readonly WorldId[] = ["modern", "heritage", "gothic", "renaissance", "deco", "foundry", "lunar", "arkship", "alexandria"];

export const WORLDS: readonly WorldDefinition[] = WORLD_ORDER.map((id) => {
  const world = WORLD_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!world) throw new Error(`Missing world definition: ${id}`);
  return world;
});

export const DEFAULT_WORLD_ID: WorldId = "modern";

export function getWorld(id: string | null | undefined): WorldDefinition {
  return WORLDS.find((world) => world.id === id) || WORLDS.find((world) => world.id === DEFAULT_WORLD_ID)!;
}

export function worldCssVariables(world: WorldDefinition): Record<string, string> {
  return {
    "--shell": world.ui.shell,
    "--panel": world.ui.panel,
    "--panel-solid": world.ui.panelSolid,
    "--line": world.ui.line,
    "--text": world.ui.text,
    "--muted": world.ui.muted,
    "--accent": world.ui.accent,
    "--accent-text": world.ui.accentText,
    "--secondary": world.ui.secondary,
    "--paper": world.ui.paper,
    "--ink": world.ui.ink
  };
}

export type { WorldDefinition, WorldId } from "./types";
