import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "../types";
import { focusPoseForBook } from "../worlds/layout";
import { getWorld } from "../worlds/registry";
import { NavigationController } from "./LibraryScene";

type Effect = () => void | (() => void);
type Slot = { value?: unknown; dependencies?: unknown[]; cleanup?: () => void; effect?: Effect };
const hooks = vi.hoisted(() => ({
  slots: [] as Slot[], cursor: 0, pending: [] as number[],
  frame: undefined as undefined | ((state: unknown, delta: number) => void), three: undefined as unknown
}));

function changed(previous: unknown[] | undefined, next: unknown[] | undefined) {
  return !previous || !next || previous.length !== next.length || next.some((value, index) => !Object.is(value, previous[index]));
}
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (value: unknown) => {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: value } };
    return hooks.slots[index].value;
  },
  useMemo: (create: () => unknown, dependencies?: unknown[]) => {
    const index = hooks.cursor++;
    if (changed(hooks.slots[index]?.dependencies, dependencies)) hooks.slots[index] = { value: create(), dependencies };
    return hooks.slots[index].value;
  },
  useCallback: (callback: unknown, dependencies?: unknown[]) => {
    const index = hooks.cursor++;
    if (changed(hooks.slots[index]?.dependencies, dependencies)) hooks.slots[index] = { value: callback, dependencies };
    return hooks.slots[index].value;
  },
  useEffect: (effect: Effect, dependencies?: unknown[]) => {
    const index = hooks.cursor++;
    if (changed(hooks.slots[index]?.dependencies, dependencies)) {
      hooks.slots[index] = { ...hooks.slots[index], effect, dependencies }; hooks.pending.push(index);
    }
  }
}));
vi.mock("@react-three/fiber", async (original) => ({
  ...await original<typeof import("@react-three/fiber")>(),
  useThree: () => hooks.three,
  useFrame: (frame: (state: unknown, delta: number) => void) => { hooks.frame = frame; }
}));
vi.mock("../ambient", () => ({ updateAmbienceListener: vi.fn() }));

class TrackedTarget extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(listener);
    }
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  count(type: string) { return this.listeners.get(type)?.size ?? 0; }
}
class TestCanvas extends TrackedTarget {
  dataset: Record<string, string> = {};
  requestPointerLock = vi.fn<() => Promise<void> | void>(() => undefined);
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
  hasPointerCapture = () => false;
}

const world = getWorld("lunar");
const book = {
  id: "neutral-navigation-fixture",
  placement: { documentId: "neutral-navigation-fixture", shelfId: "reference", bay: 0, row: 2, slot: 6,
    width: .17, height: .94, depth: .43, accentColor: "#777777", shelfSectionId: "general", importanceScore: 1 }
} as Book;
type Props = Parameters<typeof NavigationController>[0];
let browser: TrackedTarget & { matchMedia: (query: string) => { matches: boolean } };
let doc: TrackedTarget & { pointerLockElement: TestCanvas | null; exitPointerLock: () => void };
let camera: THREE.PerspectiveCamera, canvas: TestCanvas, props: Props;
let coarse: boolean, portrait: boolean;

function render(next: Partial<Props> = {}) {
  props = { ...props, ...next }; hooks.cursor = 0; hooks.pending = [];
  NavigationController(props);
  // Preserve refs and compare effect dependencies across changes in the scene
  // root, while allowing tests to deliberately leave HTML-originating props stale.
  hooks.pending.forEach((index) => hooks.slots[index].cleanup?.());
  hooks.pending.forEach((index) => { hooks.slots[index].cleanup = hooks.slots[index].effect!() || undefined; });
}
function frames(count = 1) { for (let i = 0; i < count; i++) hooks.frame!({}, 1 / 60); }
function command(name: "center-room" | "enter-immersive") { browser.dispatchEvent(new Event(`library:${name}`)); }
function unmount() { hooks.slots.forEach((slot) => { slot.cleanup?.(); slot.cleanup = undefined; }); }

beforeEach(() => {
  hooks.slots = []; hooks.pending = []; hooks.cursor = 0; hooks.frame = undefined;
  coarse = portrait = false;
  browser = Object.assign(new TrackedTarget(), { matchMedia: (query: string) => ({ matches: query.includes("coarse") ? coarse : query.includes("portrait") ? portrait : false }) });
  canvas = new TestCanvas(); camera = new THREE.PerspectiveCamera(54, 1, .06, 110);
  doc = Object.assign(new TrackedTarget(), { pointerLockElement: null as TestCanvas | null,
    exitPointerLock: vi.fn(() => { doc.pointerLockElement = null; doc.dispatchEvent(new Event("pointerlockchange")); }) });
  hooks.three = { camera, gl: { domElement: canvas }, scene: new THREE.Scene() };
  vi.stubGlobal("window", browser); vi.stubGlobal("document", doc); vi.stubGlobal("HTMLElement", TestCanvas);
  props = { books: [book], world, sceneMode: "browse", onModeChange: vi.fn(), onFocusComplete: vi.fn(), onSelectBook: vi.fn(), interactionEnabled: false };
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe("explicit scene commands while a dialog blocks movement", () => {
  it("returns immediately to the entrance and resists a stale selected-book prop on following frames", () => {
    render({ focusBook: book, sceneMode: "focus" });
    frames(90);
    expect(camera.position.distanceTo(focusPoseForBook(book, world).position)).toBeLessThan(.001);
    command("center-room");
    const entrance = new THREE.Vector3(world.spawn.position[0], world.motion.floorHeight, world.spawn.position[2]);
    expect(camera.position.distanceTo(entrance)).toBeLessThan(.00001);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(world.spawn.pitch, world.spawn.yaw, 0, "YXZ"));
    expect(camera.quaternion.angleTo(rotation)).toBeLessThan(.00001);
    expect(props.onFocusComplete).toHaveBeenCalledOnce();
    expect(props.onModeChange).toHaveBeenLastCalledWith("browse");
    frames(90); // React has deliberately not yet removed the focusBook prop.
    expect(camera.position.distanceTo(entrance)).toBeLessThan(.00001);
    expect(canvas.dataset.cameraPosition).toBe(entrance.toArray().map((value) => value.toFixed(3)).join(","));
    render({ focusBook: undefined });
    render({ focusBook: book });
    frames(90);
    expect(camera.position.distanceTo(focusPoseForBook(book, world).position)).toBeLessThan(.001);
  });

  it("requests pointer lock synchronously, preserving the current view instead of resuming shelf focus", () => {
    render({ focusBook: book, sceneMode: "focus" }); frames(20);
    const before = camera.position.clone(), direction = camera.getWorldDirection(new THREE.Vector3());
    let inUserGesture = true;
    canvas.requestPointerLock.mockImplementation(() => {
      expect(inUserGesture).toBe(true);
      doc.pointerLockElement = canvas; doc.dispatchEvent(new Event("pointerlockchange"));
    });
    command("enter-immersive"); inUserGesture = false;
    expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
    expect(props.onFocusComplete).toHaveBeenCalledOnce();
    expect(props.onModeChange).toHaveBeenLastCalledWith("immersive");
    frames(90);
    expect(camera.position.x).toBeCloseTo(before.x, 7);
    expect(camera.position.z).toBeCloseTo(before.z, 7);
    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction)).toBeLessThan(.00001);
  });

  it("retains exactly one command listener when movement is disabled, and clears held movement", () => {
    render({ interactionEnabled: true }); command("center-room");
    const down = new Event("keydown"); Object.assign(down, { key: "w", code: "KeyW" });
    browser.dispatchEvent(down); frames(30);
    const moved = camera.position.clone();
    expect(moved.distanceTo(new THREE.Vector3(...world.spawn.position))).toBeGreaterThan(.2);
    render({ interactionEnabled: false });
    expect(browser.count("keydown")).toBe(0);
    expect(canvas.count("pointerdown")).toBe(0);
    expect(browser.count("library:center-room")).toBe(1);
    expect(browser.count("library:enter-immersive")).toBe(1);
    frames(30);
    expect(camera.position.distanceTo(moved)).toBeLessThan(.00001);
    command("center-room"); frames(30);
    expect(camera.position.z).toBeCloseTo(world.spawn.position[2], 7);
    render({ interactionEnabled: true }); render({ interactionEnabled: false });
    expect(browser.count("library:center-room")).toBe(1);
    expect(doc.count("pointerlockchange")).toBe(1);
  });

  it("observes pointer-lock release while a modal has disabled input", () => {
    render({ interactionEnabled: true });
    doc.pointerLockElement = canvas; doc.dispatchEvent(new Event("pointerlockchange"));
    render({ interactionEnabled: false });
    doc.exitPointerLock();
    expect(props.onModeChange).toHaveBeenLastCalledWith("browse");
    expect(props.onModeChange).toHaveBeenCalledTimes(2);
  });

  it.each(["throw", "reject"])("returns to browse if pointer lock fails by %s", async (failure) => {
    render({ focusBook: book, sceneMode: "focus" });
    canvas.requestPointerLock.mockImplementation(() => {
      if (failure === "throw") throw new Error("Pointer lock unavailable");
      return Promise.reject(new Error("Pointer lock unavailable"));
    });
    command("enter-immersive"); await Promise.resolve();
    expect(props.onModeChange).toHaveBeenLastCalledWith("browse");
    expect(props.onFocusComplete).toHaveBeenCalledOnce();
  });

  it("does not request mouse capture on a coarse-pointer device", () => {
    coarse = true; render(); command("enter-immersive");
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it("removes command and lock listeners on unmount and ignores a later request failure", async () => {
    let reject: (reason: Error) => void = () => undefined;
    canvas.requestPointerLock.mockImplementation(() => new Promise<void>((_, fail) => { reject = fail; }));
    render(); command("enter-immersive"); unmount();
    expect(browser.count("library:center-room")).toBe(0);
    expect(browser.count("library:enter-immersive")).toBe(0);
    expect(doc.count("pointerlockchange")).toBe(0);
    const before = camera.position.clone(); command("center-room");
    expect(camera.position.equals(before)).toBe(true);
    reject(new Error("Late pointer-lock rejection")); await Promise.resolve();
    expect(props.onModeChange).not.toHaveBeenCalled();
  });
});
