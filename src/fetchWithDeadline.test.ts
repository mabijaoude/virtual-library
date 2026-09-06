import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithDeadline } from "./fetchWithDeadline";

afterEach(() => vi.unstubAllGlobals());

describe("fetchWithDeadline", () => {
  it("returns successful responses without changing their body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ready", { status: 200 })));
    const response = await fetchWithDeadline("/test", {}, { timeoutMs: 1000 });
    expect(await response.text()).toBe("ready");
  });

  it("propagates caller cancellation to the active fetch", async () => {
    vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    })));
    const controller = new AbortController();
    const pending = fetchWithDeadline("/slow", {}, { signal: controller.signal, timeoutMs: 1000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
