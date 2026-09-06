import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDialogFocus } from "./useDialogFocus";

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
vi.mock("react", () => ({
  useLayoutEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); }
}));

// A deliberately small DOM surface for the real hook. It models connection,
// inert ancestry and focus on removal; it does not reproduce the restore logic.
class TestElement {
  parentElement: TestElement | null = null;
  children: TestElement[] = [];
  inert = false;
  hidden = false;
  attributes = new Map<string, string>();
  listeners = new Map<string, Set<(event: KeyboardEvent) => void>>();
  constructor(public tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName.toUpperCase();
    Object.entries(attributes).forEach(([key, value]) => this.attributes.set(key, value));
  }
  get isConnected(): boolean {
    let root: TestElement = this;
    while (root.parentElement) root = root.parentElement;
    return root === dom.body;
  }
  append(...children: TestElement[]) {
    children.forEach((child) => { child.parentElement = this; this.children.push(child); });
  }
  remove() {
    if (this.contains(dom.activeElement)) dom.activeElement = dom.body;
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  contains(element: TestElement | null): boolean {
    for (let node = element; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  hasAttribute(name: string) { return this.attributes.has(name); }
  closest(selector: string): TestElement | null {
    if (selector !== "[inert]") throw new Error(`Unexpected closest selector: ${selector}`);
    for (let node: TestElement | null = this; node; node = node.parentElement) if (node.inert) return node;
    return null;
  }
  descendants(): TestElement[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector: string) {
    return this.descendants().filter((node) => selector.split(",").some((part) => matches(node, part.trim())));
  }
  getClientRects() { return this.hidden ? [] : [{}]; }
  focus = vi.fn((_options?: FocusOptions) => {
    if (this.isConnected && !this.closest("[inert]") && !this.hidden) dom.activeElement = this;
  });
  addEventListener(type: string, listener: (event: KeyboardEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: KeyboardEvent) => void) { this.listeners.get(type)?.delete(listener); }
  keydown(key: string, shiftKey = false) {
    const event = { key, shiftKey, preventDefault: vi.fn() };
    this.listeners.get("keydown")?.forEach((listener) => listener(event as unknown as KeyboardEvent));
    return event;
  }
}

let dom: { body: TestElement; activeElement: TestElement; querySelector: (selector: string) => TestElement | null };
let app: TestElement, toolbar: TestElement, controls: TestElement, search: TestElement, alreadyInert: TestElement;
let frames: FrameRequestCallback[];

function matches(element: TestElement, selector: string) {
  if (selector.startsWith("#")) return element.attributes.get("id") === selector.slice(1);
  if (selector.includes(":not(:disabled)") && element.hasAttribute("disabled")) return false;
  const tag = /^([a-z][\w-]*)/i.exec(selector)?.[1];
  if (tag && element.tagName !== tag.toUpperCase()) return false;
  const attributes = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
  if (!attributes.length && !tag) throw new Error(`Unexpected query selector: ${selector}`);
  return attributes.every(([, name, value]) => value === undefined ? element.hasAttribute(name) : element.attributes.get(name) === value);
}
function flushFrames() {
  const pending = frames.splice(0);
  pending.forEach((frame) => frame(0));
}
function mountDialog(returnSelector = '[aria-controls="controls"]', enabled = true, previous?: TestElement) {
  previous?.focus();
  const dialog = new TestElement("section", { role: "dialog", "aria-modal": "true", tabindex: "-1" });
  const first = new TestElement("button"), last = new TestElement("button");
  dialog.append(first, last); app.append(dialog);
  useDialogFocus({ current: dialog } as unknown as RefObject<HTMLElement>, returnSelector, enabled);
  const cleanup = hooks.effects.shift()!();
  return {
    dialog, first, last,
    close: () => { cleanup?.(); dialog.remove(); }
  };
}

beforeEach(() => {
  hooks.effects.length = 0; frames = [];
  const body = new TestElement("body");
  dom = { body, activeElement: body, querySelector: (selector) => body.descendants().find((node) => matches(node, selector)) ?? null };
  app = new TestElement("main"); toolbar = new TestElement("header");
  controls = new TestElement("button", { "aria-controls": "controls" });
  search = new TestElement("input", { id: "library-search" });
  alreadyInert = new TestElement("aside"); alreadyInert.inert = true;
  body.append(app); app.append(toolbar, alreadyInert); toolbar.append(controls, search);
  vi.stubGlobal("HTMLElement", TestElement);
  vi.stubGlobal("document", dom);
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.push(frame); return frames.length; });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("dialog focus handoff", () => {
  it("keeps Ctrl+K search focus when its queued handoff precedes the closing dialog's restore frame", () => {
    const modal = mountDialog(undefined, true, controls);
    expect(dom.activeElement).toBe(modal.dialog);
    expect(toolbar.inert).toBe(true);
    // The application queues this in its shortcut handler before React runs
    // the closing dialog's layout-effect cleanup.
    requestAnimationFrame(() => search.focus());
    modal.close();
    flushFrames();
    expect(dom.activeElement).toBe(search);
    expect(controls.focus).toHaveBeenCalledTimes(1);
    expect(toolbar.inert).toBe(false);
    expect(alreadyInert.inert).toBe(true);
  });

  it("preserves an explicit focus move made after closure and before the deferred restoration", () => {
    const modal = mountDialog(undefined, true, controls);
    modal.close();
    search.focus();
    flushFrames();
    expect(dom.activeElement).toBe(search);
    expect(controls.focus).toHaveBeenCalledTimes(1);
  });

  it("returns to the connected trigger when ordinary closure leaves focus on the body", () => {
    const modal = mountDialog(undefined, true, controls);
    modal.last.focus();
    modal.close();
    expect(dom.activeElement).toBe(dom.body);
    flushFrames();
    expect(dom.activeElement).toBe(controls);
    expect(controls.focus).toHaveBeenLastCalledWith({ preventScroll: true });
  });

  it("falls back to the stable toolbar trigger when a previous panel's action has unmounted", () => {
    const action = new TestElement("button"); app.append(action);
    const modal = mountDialog('[data-missing-trigger], [aria-controls="controls"]', true, action);
    action.remove();
    modal.close();
    flushFrames();
    expect(dom.activeElement).toBe(controls);
  });

  it("allows a replacement modal to own focus without the old cleanup stealing it", () => {
    const old = mountDialog(undefined, true, controls);
    old.close();
    const replacement = mountDialog();
    flushFrames();
    expect(dom.activeElement).toBe(replacement.dialog);
    expect(toolbar.inert).toBe(true);
    replacement.close();
    flushFrames();
    expect(dom.activeElement).toBe(controls);
    expect(toolbar.inert).toBe(false);
    expect(alreadyInert.inert).toBe(true);
  });

  it("does not mistake an already-removed handoff target for valid retained focus", () => {
    const transient = new TestElement("button"); toolbar.append(transient);
    const modal = mountDialog(undefined, true, controls);
    modal.close();
    transient.focus(); transient.remove();
    flushFrames();
    expect(dom.activeElement).toBe(controls);
  });

  it("still wraps Tab within the active dialog and removes the trap on close", () => {
    const modal = mountDialog(undefined, true, controls);
    expect(modal.dialog.keydown("Tab", true).preventDefault).toHaveBeenCalledOnce();
    expect(dom.activeElement).toBe(modal.last);
    expect(modal.dialog.keydown("Tab").preventDefault).toHaveBeenCalledOnce();
    expect(dom.activeElement).toBe(modal.first);
    modal.close(); flushFrames();
    expect(modal.dialog.listeners.get("keydown")?.size).toBe(0);
  });

  it("includes a visible disclosure summary in the focus loop when its controls are collapsed", () => {
    const modal = mountDialog(undefined, true, controls);
    modal.first.hidden = modal.last.hidden = true;
    const disclosure = new TestElement("details"), summary = new TestElement("summary");
    const collapsedInput = new TestElement("input"); collapsedInput.hidden = true;
    disclosure.append(summary, collapsedInput); modal.dialog.append(disclosure);
    modal.dialog.keydown("Tab", true);
    expect(dom.activeElement).toBe(summary);
    modal.dialog.keydown("Tab");
    expect(dom.activeElement).toBe(summary);
    modal.close(); flushFrames();
  });

  it("does not disturb focus or background interaction for an inactive dialog", () => {
    controls.focus();
    const modal = mountDialog(undefined, false);
    expect(dom.activeElement).toBe(controls);
    expect(toolbar.inert).toBe(false);
    modal.close(); flushFrames();
    expect(controls.focus).toHaveBeenCalledOnce();
  });
});
