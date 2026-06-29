import { describe, it, expect } from "vitest";
import { expandTilde, resolvePath } from "../src/main/paths-pure";

describe("expandTilde", () => {
  it("expands a leading ~ to HOME", () => {
    const home = process.env.HOME ?? "";
    expect(expandTilde("~/x")).toBe(`${home}/x`);
    expect(expandTilde("/abs")).toBe("/abs");
  });
});

describe("resolvePath", () => {
  it("returns a colon-separated PATH with no duplicates", () => {
    const path = resolvePath();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
    const parts = path.split(":");
    expect(parts.length).toBeGreaterThan(0);
    // Check no duplicates
    const unique = [...new Set(parts)];
    expect(unique).toHaveLength(parts.length);
  });

  it("includes standard directories", () => {
    const path = resolvePath();
    const stdDirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
    stdDirs.forEach((dir) => {
      expect(path).toContain(dir);
    });
  });
});
