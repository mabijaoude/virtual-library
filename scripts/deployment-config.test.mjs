import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("Dockerfile", "utf8");
const nginx = readFileSync("nginx.conf", "utf8");
const compose = yaml.safeLoad(readFileSync("docker-compose.yml", "utf8"));

describe("stock deployment configuration", () => {
  it("uses one portable service with an explicit health check", () => {
    expect(Object.keys(compose.services)).toEqual(["web"]);
    expect(compose.services.web.build).toEqual({ context: ".", target: "web" });
    expect(compose.services.web.ports).toEqual(["${HOST_PORT:-5587}:80"]);
    expect(compose.services.web.healthcheck.test).toEqual(["CMD", "wget", "-q", "--spider", "http://127.0.0.1/"]);
    expect(JSON.stringify(compose)).not.toMatch(/192\.168\.|\/volume\d+\/|[A-Z]:\\Users\\|\/home\/[^/]+\//i);
  });

  it("pins the runtime server and builds only the static collection", () => {
    expect(dockerfile).toMatch(/^FROM node:22-alpine AS build$/m);
    expect(dockerfile).toMatch(/^FROM nginx:1\.30\.4-alpine3\.24 AS web$/m);
    expect(dockerfile).toContain("COPY books ./books");
    expect(dockerfile).toContain("RUN pnpm build");
    expect(dockerfile).not.toMatch(/192\.168\.|\/volume\d+\/|[A-Z]:\\Users\\|\/home\/[^/]+\//i);
  });

  it("ships safe defaults and explicit cache rules", () => {
    expect(nginx).toContain("server_tokens off;");
    expect(nginx).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(nginx).toContain('add_header Referrer-Policy "strict-origin-when-cross-origin" always;');
    expect(nginx).toContain('add_header X-Frame-Options "SAMEORIGIN" always;');
    expect(nginx).toContain("add_header_inherit merge;");
    expect(nginx).toContain('add_header Cache-Control "no-store";');
    expect(nginx).toContain('add_header Cache-Control "public, max-age=31536000, immutable";');
  });
});
