import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { worldBootManifest } from "../../vite.config";
import { WORLDS } from "./registry";

describe("initial room preloads", () => {
  const plugin = worldBootManifest();
  const transform = plugin.transformIndexHtml as { handler: (html: string) => string };
  const html = transform.handler(readFileSync(new URL("../../index.html", import.meta.url), "utf8"));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];

  function preloads(search: string, stored?: string) {
    const links: Array<Record<string, string>> = [];
    runInNewContext(script, {
      URLSearchParams,
      window: { location: { search }, addEventListener() {} },
      localStorage: { getItem: () => stored },
      document: {
        createElement: () => ({ setAttribute() {} }),
        head: { appendChild: (link: Record<string, string>) => links.push(link) }
      }
    });
    return links;
  }

  it("preloads exactly the model and preview URLs used by every runtime world", () => {
    for (const world of WORLDS) {
      const links = preloads(`?world=${world.id}`);
      expect(links.filter((link) => link.as === "fetch").map((link) => link.href)).toEqual([world.assets.fallbackModel]);
      expect(links.map((link) => link.href)).toContain(world.preview);
      if (world.assets.backplate) expect(links.map((link) => link.href)).toContain(world.assets.backplate);
    }
  });

  it("does not preload hidden city panels or unused artwork in Deco", () => {
    const deco = WORLDS.find((world) => world.id === "deco")!;
    expect(deco.assets.backplate).toBeUndefined();
    expect(deco.assets.art).toBeUndefined();
    expect(preloads("?world=deco").some((link) => /assets\/(art|backplates)\//.test(link.href))).toBe(false);
  });

  it("respects a saved room and falls back safely for unknown IDs", () => {
    const foundry = WORLDS.find((world) => world.id === "foundry")!;
    expect(preloads("", "foundry").map((link) => link.href)).toContain(foundry.assets.fallbackModel);
    expect(preloads("?world=unknown", "unknown")[0].href).toBe(WORLDS[0].preview);
    expect(html).not.toContain("__WORLD_ASSET_REVISIONS__");
  });
});
