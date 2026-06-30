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
});
