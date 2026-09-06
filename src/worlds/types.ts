import type { ComponentType } from "react";
import type { CollisionRect, PlanarVector } from "../navigation";

export type WorldId = "heritage" | "gothic" | "modern" | "renaissance" | "deco" | "foundry" | "lunar" | "arkship" | "alexandria";
export type Vector3Tuple = [number, number, number];
export type QualityPreference = "auto" | "cinematic" | "balanced" | "lite";
export type ResolvedQuality = Exclude<QualityPreference, "auto">;
export type SceneLoadStage = "code" | "architecture" | "collection" | "lighting" | "ready";
export type BoundaryStyle = "georgian" | "gothic" | "modern" | "renaissance" | "deco" | "industrial" | "lunar" | "starship" | "alexandrian";
export type DisplayArtifact = "codex" | "scroll";
export type BoundaryBarrierKind = "energy" | "grille" | "doors";

export type WorldExterior =
  | { kind: "backplate" }
  | { kind: "lunar"; earthAngularDiameter: number; starSeed: number }
  | { kind: "deep-space"; starSeed: number; voyageSeconds: number }
  | { kind: "harbor-diorama"; motionSeed: number; waterSpeed: number };

export type WorldMotionProfile = {
  floorHeight: number;
  walkSpeed: number;
  sprintSpeed: number;
  acceleration: number;
  braking: number;
  jumpVelocity: number;
  gravity: number;
  airControl: number;
};

export type WorldLightingProfile = {
  exposure: number;
  ambient: number;
  hemisphere: number;
  key: number;
  practical: number;
  environment: number;
};

export type SceneLoadProgress = {
  stage: SceneLoadStage;
  completed: number;
  total: number;
  ratio: number;
};

export type WorldAssetBundle = {
  completeModel: string;
  fallbackModel: string;
  environment: string;
  backplate?: string;
  art?: string;
  lightmaps: string[];
  lut?: string;
  audioZones: string[];
  byteBudget: number;
  fallbackByteBudget: number;
};

export type BayAnchor = {
  position: Vector3Tuple;
  rotationY: number;
  width: number;
};

export type WorldEnvironmentProps = {
  reducedMotion: boolean;
  quality: ResolvedQuality;
  onArchitectureReady?: () => void;
  onReady?: () => void;
};

export type WorldModule = {
  default: ComponentType<WorldEnvironmentProps>;
};

export type WorldDefinition = {
  id: WorldId;
  label: string;
  shortLabel: string;
  era: string;
  description: string;
  landmark: string;
  swatches: [string, string, string];
  preview: string;
  load: () => Promise<WorldModule>;
  assets: WorldAssetBundle;
  cameraFar: number;
  exterior: WorldExterior;
  displayArtifact?: DisplayArtifact;
  motion: WorldMotionProfile;
  lighting: WorldLightingProfile;
  spawn: {
    position: Vector3Tuple;
    yaw: number;
    /** Optional tighter landmark framing for a portrait viewport. */
    portraitYaw?: number;
    pitch: number;
  };
  bounds: CollisionRect;
  walkablePolygon?: PlanarVector[];
  obstacles: CollisionRect[];
  boundary: {
    placements: Array<{
      position: Vector3Tuple;
      rotationY: number;
    }>;
    span: number;
    width: number;
    height: number;
    depth: number;
    style: BoundaryStyle;
    barrierKind: BoundaryBarrierKind;
    laserOpacity?: number;
  };
  bays: BayAnchor[];
  expansion: {
    origin: Vector3Tuple;
    direction: Vector3Tuple;
    spacing: number;
    rotationY: number;
  };
  scene: {
    background: string;
    fog: string;
    fogNear: number;
    fogFar: number;
    exposure: number;
    ambient: string;
    ambientIntensity: number;
    key: string;
    keyPosition: Vector3Tuple;
    keyIntensity: number;
    practical: string;
    practicalIntensity: number;
    floor: string;
    wall: string;
    shelf: string;
    shelfDark: string;
    shelfBack?: string;
    trim: string;
    metal: string;
    paper: string;
    accent: string;
    secondary: string;
    bookPalette: string[];
    bloom: number;
    vignette: number;
    grade: {
      hue: number;
      saturation: number;
      contrast: number;
      brightness: number;
    };
  };
  ui: {
    shell: string;
    panel: string;
    panelSolid: string;
    line: string;
    text: string;
    muted: string;
    accent: string;
    accentText: string;
    secondary: string;
    paper: string;
    ink: string;
  };
};
