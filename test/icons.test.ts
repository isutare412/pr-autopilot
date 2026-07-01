import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// PNG IHDR: 8-byte signature, then 4-byte length + "IHDR", then
// width@16 (BE u32), height@20 (BE u32), bit-depth@24, color-type@25.
// color-type 2 = RGB, 4 = gray+alpha, 6 = RGBA.
function png(rel: string): { width: number; height: number; colorType: number } {
  const b = readFileSync(rel); // cwd is the repo root under vitest
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b.readUInt8(25) };
}
const hasAlpha = (ct: number) => ct === 4 || ct === 6;

describe("icon assets", () => {
  it("tray template is 18x18 with alpha", () => {
    const p = png("build/trayTemplate.png");
    expect([p.width, p.height]).toEqual([18, 18]);
    expect(hasAlpha(p.colorType)).toBe(true);
  });

  it("tray template @2x is 36x36 with alpha", () => {
    const p = png("build/trayTemplate@2x.png");
    expect([p.width, p.height]).toEqual([36, 36]);
    expect(hasAlpha(p.colorType)).toBe(true);
  });

  it("app icon is 1024x1024 RGBA", () => {
    const p = png("build/icon.png");
    expect([p.width, p.height]).toEqual([1024, 1024]);
    expect(p.colorType).toBe(6);
  });

  it("package.json wires the mac icon and bundles the @2x tray template", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.build.mac.icon).toBe("build/icon.png");
    expect(pkg.build.extraResources).toContainEqual({
      from: "build/trayTemplate@2x.png",
      to: "build/trayTemplate@2x.png",
    });
  });

  it("disabled tray templates are 18x18 and 36x36 with alpha", () => {
    const a = png("build/trayTemplate-disabled.png");
    expect([a.width, a.height]).toEqual([18, 18]);
    expect(hasAlpha(a.colorType)).toBe(true);
    const b = png("build/trayTemplate-disabled@2x.png");
    expect([b.width, b.height]).toEqual([36, 36]);
    expect(hasAlpha(b.colorType)).toBe(true);
  });

  it("automated tray templates are 18x18 and 36x36 with alpha", () => {
    const a = png("build/trayTemplate-automated.png");
    expect([a.width, a.height]).toEqual([18, 18]);
    expect(hasAlpha(a.colorType)).toBe(true);
    const b = png("build/trayTemplate-automated@2x.png");
    expect([b.width, b.height]).toEqual([36, 36]);
    expect(hasAlpha(b.colorType)).toBe(true);
  });

  it("bundles the mode tray templates as extraResources", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    for (const f of ["trayTemplate-disabled.png", "trayTemplate-disabled@2x.png",
                     "trayTemplate-automated.png", "trayTemplate-automated@2x.png"]) {
      expect(pkg.build.extraResources).toContainEqual({ from: `build/${f}`, to: `build/${f}` });
    }
  });

  it("needs-review tray templates are 18x18 and 36x36 RGBA", () => {
    for (const base of ["trayTemplate-needsreview", "trayTemplate-needsreview-dark"]) {
      const a = png(`build/${base}.png`);
      expect([a.width, a.height]).toEqual([18, 18]);
      expect(a.colorType).toBe(6); // RGBA — the red dot means true color, not template grayscale
      const b = png(`build/${base}@2x.png`);
      expect([b.width, b.height]).toEqual([36, 36]);
      expect(b.colorType).toBe(6);
    }
  });

  it("bundles the needs-review tray templates as extraResources", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    for (const f of ["trayTemplate-needsreview.png", "trayTemplate-needsreview@2x.png",
                     "trayTemplate-needsreview-dark.png", "trayTemplate-needsreview-dark@2x.png"]) {
      expect(pkg.build.extraResources).toContainEqual({ from: `build/${f}`, to: `build/${f}` });
    }
  });
});
