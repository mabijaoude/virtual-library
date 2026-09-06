import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const assetRoot = path.join(root, "public", "worlds");
const manifest = JSON.parse(readFileSync(path.join(assetRoot, "asset-manifest.json"), "utf8"));
const bundleManifest = JSON.parse(readFileSync(path.join(assetRoot, "world-assets.json"), "utf8"));
const materialManifest = JSON.parse(readFileSync(path.join(assetRoot, "assets", "materials", "manifest.json"), "utf8"));

describe("world assets", () => {
  it("bundles one compact, nonblank scene preview for every world", async () => {
    expect(manifest.assets.map((asset) => asset.world)).toEqual(["heritage", "gothic", "modern", "renaissance", "deco", "foundry", "lunar", "arkship", "alexandria"]);
    for (const asset of manifest.assets) {
      const file = path.join(assetRoot, asset.file);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBe(asset.bytes);
      expect(asset.bytes).toBeLessThan(100_000);
      const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
      expect(digest).toBe(asset.sha256);
      const image = sharp(file);
      const metadata = await image.metadata();
      const stats = await image.stats();
      expect([metadata.width, metadata.height]).toEqual([960, 540]);
      expect(stats.entropy).toBeGreaterThan(2.5);
      expect(Math.max(...stats.channels.map((channel) => channel.stdev))).toBeGreaterThan(18);
    }
  });

  it("records a nonblank mobile baseline for every world", async () => {
    for (const world of ["heritage", "gothic", "modern", "renaissance", "deco", "foundry", "lunar", "arkship", "alexandria"]) {
      const file = path.join(root, "art-source", "baselines", "mobile", `${world}.jpg`);
      expect(existsSync(file)).toBe(true);
      const image = sharp(file);
      const metadata = await image.metadata();
      const stats = await image.stats();
      expect([metadata.width, metadata.height]).toEqual([390, 844]);
      expect(stats.entropy).toBeGreaterThan(2.25);
    }
  });

  it("records provenance and has no runtime remote asset URLs", () => {
    const licenseDocument = readFileSync(path.join(root, "ASSET_LICENSES.md"), "utf8");
    expect(licenseDocument).toContain("CC0 1.0");
    expect(licenseDocument).toContain("NASA Images and Media Usage Guidelines");
    const provenance = JSON.parse(readFileSync(path.join(root, "art-source", "asset-lock.json"), "utf8"));
    expect(provenance.policy).toContain("CC0");
    expect(provenance.records).toHaveLength(27);
    for (const record of provenance.records) {
      expect(record.license, record.id).toBe("CC0-1.0");
      expect(record.author, record.id).toBeTruthy();
      expect(record.sourceUrl, record.id).toMatch(/^https:\/\//);
      expect(licenseDocument, record.id).toContain(`\`${record.id}\``);
      expect(record.derivatives?.length || record.file, record.id).toBeTruthy();
      for (const derivative of record.derivatives || []) {
        expect(derivative.file, record.id).toBeTruthy();
        expect(derivative.bytes, record.id).toBeGreaterThan(0);
        expect(derivative.sha256, record.id).toMatch(/^[a-f0-9]{64}$/);
      }
    }
    const worldSources = ["heritage.tsx", "gothic.tsx", "modern.tsx", "renaissance.tsx", "deco.tsx", "foundry.tsx", "lunar.tsx", "arkship.tsx", "alexandria.tsx"]
      .map((file) => readFileSync(path.join(root, "src", "worlds", file), "utf8"))
      .join("\n");
    expect(worldSources).not.toMatch(/https?:\/\//);
  });

  it("ships validated complete and fallback GLBs within their active-world budgets", () => {
    expect(Object.keys(bundleManifest.worlds)).toEqual(["heritage", "gothic", "modern", "renaissance", "deco", "foundry", "lunar", "arkship", "alexandria"]);
    for (const [world, bundles] of Object.entries(bundleManifest.worlds)) {
      for (const tier of ["complete", "fallback"]) {
        const bundle = bundles[tier];
        const file = path.join(root, "public", bundle.model);
        expect(existsSync(file), `${world}-${tier} model`).toBe(true);
        const bytes = readFileSync(file);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(bundle.contentHash);
        expect(bundle.validatorErrors).toBe(0);
        const minimumTriangles = world === "foundry" && tier === "fallback" ? 400 : 1_000;
        expect(bundle.triangles).toBeGreaterThan(minimumTriangles);
        expect(bundle.modelBytes).toBeLessThanOrEqual(tier === "complete" ? 12 * 1024 * 1024 : 2 * 1024 * 1024);
        expect(bundle.bytes).toBeLessThanOrEqual(tier === "complete" ? 16 * 1024 * 1024 : 7 * 1024 * 1024);
        const json = parseGlbJson(bytes);
        expect(json.extensionsUsed).toContain(tier === "complete" ? "KHR_texture_basisu" : "EXT_texture_webp");
        expect(json.extensionsUsed).toContain("EXT_meshopt_compression");
        expect(JSON.stringify(json)).not.toMatch(/https?:\/\//);
        const names = new Set(json.nodes.map((node) => node.name));
        if (world === "foundry") {
          expect([...names].some((name) => /^Turbine (drum|rim|blade)/.test(name))).toBe(false);
        }
        expect(names.has("SPAWN")).toBe(true);
        for (let index = 0; index < 9; index += 1) {
          const suffix = String(index).padStart(2, "0");
          expect(names.has(`SHELF_BAY_${suffix}`)).toBe(true);
          expect(names.has(`CLEARANCE_BAY_${suffix}`)).toBe(true);
        }
      }
    }
  });

  it("keeps structural furniture and restrained planting in lightweight rooms", () => {
    const liteNodeNames = (world) => {
      const bundle = bundleManifest.worlds[world].fallback;
      const json = parseGlbJson(readFileSync(path.join(root, "public", bundle.model)));
      return (json.nodes || []).map((node) => node.name || "");
    };

    const heritageNames = liteNodeNames("heritage");
    expect(heritageNames.filter((name) => name.startsWith("Balcony rail "))).toHaveLength(2);
    expect(heritageNames.filter((name) => name.startsWith("Baluster "))).toHaveLength(38);
    expect(heritageNames.filter((name) => name.startsWith("Table leg "))).toHaveLength(4);
    expect(
      heritageNames.filter((name) => name.startsWith("Reading table long apron ")),
    ).toHaveLength(1);
    expect(
      heritageNames.filter((name) => name.startsWith("Reading table stretcher ")),
    ).toHaveLength(1);

    const modernNames = liteNodeNames("modern");
    expect(modernNames.filter((name) => name.startsWith("Bridge rail "))).toHaveLength(2);
    const modernPlantNames = modernNames.filter(
      (name) => name.startsWith("Planter ") || name.startsWith("Plant "),
    );
    expect(modernNames.filter((name) => name.startsWith("Planter "))).toHaveLength(2);
    expect(modernNames.filter((name) => name.startsWith("Plant "))).toHaveLength(14);
    expect(modernPlantNames.some((name) => name.includes("8.5"))).toBe(false);

    const lunarNames = liteNodeNames("lunar");
    expect(
      lunarNames.filter((name) => name.startsWith("Research table support ")),
    ).toHaveLength(2);
    expect(lunarNames).toContain("Research table lower brace");
  });

  it("keeps Art Deco wall trim and seating out of the shelf aisle", () => {
    const blenderSource = readFileSync(
      path.join(root, "scripts", "blender", "build_worlds.py"),
      "utf8",
    );
    expect(blenderSource).not.toContain('(0.08, 6.8, 5.8), brass');

    const bundle = bundleManifest.worlds.deco.complete;
    const json = parseGlbJson(readFileSync(path.join(root, "public", bundle.model)));
    const names = (json.nodes || []).map((node) => node.name || "");
    expect(names.filter((name) => name.startsWith("Brass wall reveal "))).toHaveLength(0);
    // Identical diffusers may share an unnamed GPU-instanced node. Match the
    // surviving named fixtures' geometry/material, then count actual instances.
    const namedCoves = json.nodes.filter((node) => node.name?.startsWith("Warm cove diffuser "));
    expect(namedCoves.length).toBeGreaterThan(0);
    const covePrimitives = new Set(namedCoves.map((node) => JSON.stringify(json.meshes[node.mesh].primitives)));
    const coveCount = json.nodes.reduce((count, node) => {
      if (node.mesh === undefined || !covePrimitives.has(JSON.stringify(json.meshes[node.mesh].primitives))) return count;
      const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
      if (!attributes) return count + 1;
      const instanceCounts = Object.values(attributes).map((accessor) => json.accessors[accessor].count);
      expect(new Set(instanceCounts).size, "cove instance attributes must agree").toBe(1);
      return count + instanceCounts[0];
    }, 0);
    expect(coveCount).toBe(8);
    expect(names.filter((name) => name.startsWith("South entrance jamb "))).toHaveLength(2);
    expect(names).toContain("South entrance header");
    expect(names).not.toContain("Ebony wall 0");
    expect(names.some((name) => name.startsWith("Emerald settee "))).toBe(false);
    expect(names.some((name) => name.startsWith("Emerald lounge "))).toBe(false);
  });

  it("keeps the Renaissance loggia structural and the north shelf approach open", () => {
    const blenderSource = readFileSync(
      path.join(root, "scripts", "blender", "build_worlds.py"),
      "utf8",
    );
    const renaissanceSource = blenderSource.slice(
      blenderSource.indexOf("def build_renaissance"),
      blenderSource.indexOf("def build_deco"),
    );
    expect(renaissanceSource).toMatch(
      /round_arch\([\s\S]*?f"Cloister arch \{side\} \{z\}"[\s\S]*?include_legs=False,[\s\S]*?\)/,
    );
    expect(renaissanceSource).toContain("arcade_columns = (-5.6, -2.8, 0, 2.8, 5.6, 8.4)");
    expect(renaissanceSource).toContain("for z in (-4.2, -1.4, 1.4, 4.2, 7.0):");
    expect(renaissanceSource).not.toContain("for z in (-7.0, -4.2, -1.4, 1.4, 4.2, 7.0):");
    expect(renaissanceSource).toContain('f"Arcade entablature {side}"');
    expect(renaissanceSource).toContain('f"Gallery ceiling beam {side} {coordinate}"');

    const renaissanceBundle = bundleManifest.worlds.renaissance.fallback;
    const renaissanceJson = parseGlbJson(readFileSync(path.join(root, "public", renaissanceBundle.model)));
    const names = (renaissanceJson.nodes || []).map((node) => node.name || "");
    expect(names.filter((name) => name.startsWith("Cloister arch "))).toHaveLength(10);
    expect(names.some((name) => name.startsWith("Cloister arch ") && name.endsWith(" -7.0"))).toBe(false);
    expect(names.filter((name) => name.startsWith("Arcade entablature "))).toHaveLength(2);
    expect(names.filter((name) => name.startsWith("Gallery ceiling beam "))).toHaveLength(12);
    expect(names.some((name) => name.startsWith("Side fresco "))).toBe(false);
    expect(names.some((name) => name.startsWith("North fresco "))).toBe(false);
    expect(names.some((name) => name.startsWith("Citrus "))).toBe(false);
    expect(names.some((name) => name.startsWith("Citrus fruit "))).toBe(false);
    expect(names).toContain("Bronze arrival inlay");
  });

  it("does not re-author the obsolete Alexandria armillary behind the Antikythera exhibit", () => {
    const blenderSource = readFileSync(
      path.join(root, "scripts", "blender", "build_worlds.py"),
      "utf8",
    );
    expect(blenderSource).not.toMatch(/cylinder\("Pinakes armillary stem"/);
    expect(blenderSource).not.toMatch(/torus\(f"Pinakes celestial ring/);
    expect(blenderSource).not.toMatch(/cylinder\("Pinakes celestial axis"/);

    const exhibitSource = readFileSync(
      path.join(root, "src", "worlds", "AssetWorld.tsx"),
      "utf8",
    );
    expect(exhibitSource).not.toContain("<torusGeometry args={[radius, 0.007");
    expect(exhibitSource).toContain("<ringGeometry args={[radius - 0.005, radius + 0.005, 64]}");
  });

  it("keeps the Alexandria cyclorama free of untextured horizon closure blocks", () => {
    const exteriorSource = readFileSync(
      path.join(root, "src", "worlds", "AlexandriaExterior.tsx"),
      "utf8",
    );
    const cycloramaSource = exteriorSource.slice(
      exteriorSource.indexOf("function HarborCyclorama"),
      exteriorSource.indexOf("type ReliefBox"),
    );
    expect(cycloramaSource).toContain("<cylinderGeometry");
    expect(cycloramaSource).not.toContain("<boxGeometry");
  });

  it("keeps Alexandria water highlights organic and low contrast", () => {
    const exteriorSource = readFileSync(
      path.join(root, "src", "worlds", "AlexandriaExterior.tsx"),
      "utf8",
    );
    const waterSource = exteriorSource.slice(
      exteriorSource.indexOf("function HarborWater"),
      exteriorSource.indexOf("function HarborQuays"),
    );

    expect(waterSource).toContain("float layeredWaterNoise");
    expect(waterSource).toContain("float brokenCrest");
    expect(waterSource).toContain("horizonColor");
    expect(waterSource).not.toContain("waterUv.x * 92.0");
    expect(waterSource).not.toContain("glint * 0.34");
  });

  it("keeps Gothic illumination attached to visible candle fixtures", () => {
    const source = readFileSync(
      path.join(root, "src", "worlds", "AssetWorld.tsx"),
      "utf8",
    );
    const sceneSource = readFileSync(
      path.join(root, "src", "components", "LibraryScene.tsx"),
      "utf8",
    );
    const appSource = readFileSync(
      path.join(root, "src", "App.tsx"),
      "utf8",
    );
    const documentSource = readFileSync(path.join(root, "index.html"), "utf8");
    expect(source).not.toContain("Rose window floor projection");
    expect(source).toContain("<GothicCandleStandLights />");
    expect(source).toContain("GOTHIC_CANDLE_STAND_POSITIONS");
    const gothicFallback = bundleManifest.worlds.gothic.fallback;
    const gothicFallbackJson = parseGlbJson(
      readFileSync(path.join(root, "public", gothicFallback.model)),
    );
    const gothicFallbackNames = (gothicFallbackJson.nodes || []).map((node) => node.name || "");
    expect(gothicFallbackNames.filter((name) => name.startsWith("Iron candle standard "))).toHaveLength(6);
    expect(gothicFallbackNames.filter((name) => name.startsWith("Iron candle foot "))).toHaveLength(6);
    expect(gothicFallbackNames.filter((name) => name.startsWith("Iron candle bobeche "))).toHaveLength(6);
    expect(gothicFallbackNames.filter((name) => name.startsWith("Ivory candle body "))).toHaveLength(6);
    expect(sceneSource).toMatch(
      /quality === "cinematic" && world\.id !== "gothic"[\s\S]*?<Environment files=\{world\.assets\.environment\}/,
    );
    expect(sceneSource).toContain("<ScenePresentation ready={fullyReady}");
    expect(sceneSource).toContain("gl.compileAsync(scene, camera)");
    expect(appSource).toContain("fetch(world.assets.fallbackModel");
    expect(appSource).not.toMatch(
      /fetch\(world\.assets\.(?:environment|backplate|art)/,
    );
    expect(documentSource).not.toContain('"/worlds/assets/environments/" + world');
    expect(documentSource).toContain('world + "-lite.glb?v=" + assetRevision + "&startup=" + fallbackRevision');
    expect(documentSource).not.toContain('world + "-cinematic.glb?v=" + assetRevision');
  });

  it("keeps the startup shell and preloads aligned with the Modern Archive default", () => {
    const documentSource = readFileSync(path.join(root, "index.html"), "utf8");
    expect(documentSource).toContain('var worlds = ["modern", "heritage", "gothic"');
    expect(documentSource).toContain('worlds.indexOf(stored) >= 0 ? stored : "modern"');
    expect(documentSource).toContain('background:#d9dedf');
  });

  it("ships Arkship's aisle fixtures in the compact startup model", () => {
    const source = readFileSync(
      path.join(root, "src", "worlds", "AssetWorld.tsx"),
      "utf8",
    );
    const arkshipFallback = bundleManifest.worlds.arkship.fallback;
    const arkshipFallbackJson = parseGlbJson(
      readFileSync(path.join(root, "public", arkshipFallback.model)),
    );
    const names = new Set((arkshipFallbackJson.nodes || []).map((node) => node.name || ""));
    expect(names.has("Archive amber ceiling line")).toBe(true);
    expect(names.has("Observation cyan ceiling line")).toBe(true);
    expect(names.has("Memory stack fore light")).toBe(true);
    expect(names.has("Memory stack aft light")).toBe(true);
    expect(source).toContain("<ArkshipAisleLights />");
    expect(source).toContain("ARKSHIP_AISLE_LIGHTS");
  });

  it("ships textured shelf and entrance material families", () => {
    const files = new Set(materialManifest.assets.map((asset) => asset.file));
    for (const family of ["wood", "concrete", "metal"]) {
      expect(files.has(`/worlds/assets/materials/shelf-${family}-color.webp`)).toBe(true);
      expect(files.has(`/worlds/assets/materials/shelf-${family}-normal.webp`)).toBe(true);
      expect(files.has(`/worlds/assets/materials/shelf-${family}-roughness.webp`)).toBe(true);
    }
    for (const channel of ["color", "normal", "roughness"]) {
      expect(files.has(`/worlds/assets/materials/boundary-stone-${channel}.webp`)).toBe(true);
      expect(files.has(`/worlds/assets/materials/dome-plaster-${channel}.webp`)).toBe(true);
    }
  });

  it("locks every dynamic exterior texture locally with provenance", () => {
    const lockPath = path.join(assetRoot, "assets", "exteriors", "space-assets.json");
    expect(existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    expect(lock.runtimeRemoteUrls).toBe(false);
    expect(lock.sources).toHaveLength(3);
    for (const source of lock.sources) {
      expect(source.url).toMatch(/^https:\/\/svs\.gsfc\.nasa\.gov\//);
      expect(source.page).toMatch(/^https:\/\/svs\.gsfc\.nasa\.gov\//);
      expect(source.credit).toBeTruthy();
      expect(source.rights).toContain("generally is not subject to copyright");
      expect(source.rightsUrl).toBe("https://www.nasa.gov/nasa-brand-center/images-and-media/");
      expect(source.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    for (const derivative of lock.derivatives) {
      const file = path.join(root, derivative.file);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBe(derivative.bytes);
      expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(derivative.sha256);
    }
  });
});

function parseGlbJson(buffer) {
  let offset = 12;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) return JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString("utf8").replace(/\u0000+$/g, ""));
    offset += 8 + length;
  }
  throw new Error("Missing GLB JSON chunk");
}
