export const PERFORMANCE_MARKS = {
  shellReady: "library:shell-ready",
  catalogReady: "library:catalog-ready",
  sceneArchitectureReady: "library:scene-architecture-ready",
  sceneReady: "library:scene-ready"
} as const;

let roomStartedAt = 0;
let roomStages: Record<string, number> = {};
let longTasks: Array<{ start: number; duration: number }> = [];

export function observeRoomWork() {
  if (!globalThis.PerformanceObserver?.supportedEntryTypes.includes("longtask")) return;
  const observer = new PerformanceObserver((list) => {
    longTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })));
    longTasks = longTasks.slice(-120);
  });
  observer.observe({ type: "longtask", buffered: true });
  return () => observer.disconnect();
}

export function beginRoomPerformance() {
  roomStartedAt = performance.now();
  roomStages = {};
  delete document.documentElement.dataset.roomProfile;
}

export function recordRoomStage(stage: string) {
  roomStages[stage] ??= Math.round(performance.now() - roomStartedAt);
}

export function finishRoomPerformance(world: string) {
  const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .filter((entry) => entry.startTime >= roomStartedAt);
  const profile = {
    world,
    readyMs: Math.round(performance.now() - roomStartedAt),
    stages: roomStages,
    resourceCount: resources.length,
    transferredBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
    longestResourceMs: Math.round(Math.max(0, ...resources.map((entry) => entry.duration))),
    longTaskMs: Math.round(longTasks.filter((entry) => entry.start >= roomStartedAt).reduce((sum, entry) => sum + entry.duration, 0))
  };
  document.documentElement.dataset.roomProfile = JSON.stringify(profile);
}

export function markPerformance(name: string) {
  if (typeof performance === "undefined" || performance.getEntriesByName(name, "mark").length) return;
  performance.mark(name);
  document.documentElement.setAttribute(`data-perf-${name.replaceAll(":", "-")}`, String(Math.round(performance.now())));
}

export function measurePerformance(name: string, start: string, end: string) {
  if (typeof performance === "undefined" || !performance.getEntriesByName(start, "mark").length || !performance.getEntriesByName(end, "mark").length) return;
  if (!performance.getEntriesByName(name, "measure").length) {
    const measure = performance.measure(name, start, end);
    document.documentElement.setAttribute(`data-perf-${name.replaceAll(":", "-")}`, String(Math.round(measure.duration)));
  }
}
