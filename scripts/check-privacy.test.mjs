import { describe, expect, it } from "vitest";
import { forbiddenPath, privateMarkers } from "./check-privacy.mjs";

describe("release privacy guard", () => {
  it("detects home paths in binary, escaped JSON, and UTF-16 metadata without printing their contents", () => {
    const home = ["C:", "Users", "example", "private"].join("\\");
    for (const value of [Buffer.from(home), Buffer.from(JSON.stringify({ home })), Buffer.from(home, "utf16le")]) {
      expect(privateMarkers(value)).toContain("home-directory path");
    }
    expect(privateMarkers(["", "home", "example", "work"].join("/"))).toContain("home-directory path");
  });
  it("detects private hosts, credentials and tokens", () => {
    for (const value of [[192, 168, 1, 8].join("."), [172, 31, 0, 1].join("."), "/" + "volume1" + "/data", "storage" + ".local"]) {
      expect(privateMarkers(value)).toContain("private infrastructure");
    }
    expect(privateMarkers("ghp_" + "x".repeat(36))).toContain("access token");
    expect(privateMarkers("https://" + "user:password" + "@example.com")).toContain("URL credentials");
    expect(privateMarkers("-----BEGIN " + "PRIVATE KEY-----")).toContain("private key");
  });
  it("rejects private content and authoring metadata paths", () => {
    for (const file of ["books/notes.md", ".env", ".env.production", "world.blend", "world.blend1", "server/index.mjs", "public/book-content/notes.md", "secret.pem"]) expect(forbiddenPath(file)).toBe(true);
  });
  it("allows portable setup instructions, provenance, and neutral examples", () => {
    for (const file of ["books/.gitkeep", "examples/starter.md", "public/worlds/assets/models/modern-lite.glb", "docs/images/modern.jpg"]) expect(forbiddenPath(file)).toBe(false);
    expect(privateMarkers("http://127.0.0.1:5173 https://library.example.com /srv/library-books C:/Program Files/Blender")).toEqual([]);
  });
});
