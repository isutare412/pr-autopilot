import { describe, it, expect } from "vitest";
import { expandTilde, resolvePath, mergePath } from "../src/main/paths-pure";

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

describe("mergePath", () => {
  const home = process.env.HOME ?? "";

  it("adds ~/.local/bin where the claude native installer lands, even when the shell PATH omits it", () => {
    // A Finder/launchd-launched .app resolves PATH with a login but NON-interactive
    // shell (`$SHELL -lc`), which does not source ~/.zshrc — the common place users
    // add ~/.local/bin. Feed exactly that GUI-style PATH (no ~/.local/bin) and assert
    // the merge restores it; otherwise `spawn("claude")` fails with ENOENT.
    const guiPath = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
    expect(mergePath(guiPath).split(":")).toContain(`${home}/.local/bin`);
  });

  it("includes the standard dirs and de-duplicates", () => {
    const merged = mergePath("/usr/bin:/usr/bin:/opt/homebrew/bin");
    const parts = merged.split(":");
    ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].forEach((d) =>
      expect(parts).toContain(d),
    );
    expect(parts).toHaveLength(new Set(parts).size);
  });
});
