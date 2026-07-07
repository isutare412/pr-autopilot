# Queue Sort, Icon Toolbar, Tray Conformance, and ⌘R Poll-now — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted, reversible queue sort (Recent activity / Repo & number) that drives both the main queue list and the tray menu, expose it via a funnel icon + direction badge, and bind ⌘R to Poll-now.

**Architecture:** A pure comparator lives as parallel copies in `core/queueSort.ts` (authoritative, used by the tray) and `renderer/src/queueSort.ts` (used by the UI), kept in lock-step by a parity test — the same convention as `visibility` and the `guard`. The sort preference is a zod field on `Settings`, set via a new `queue-sort:set` IPC channel that also refreshes the tray. ⌘R is an app-menu accelerator routed to the renderer's existing Poll-now flow via a `trigger-poll` event.

**Tech Stack:** Electron + React + TypeScript, zod, vitest (+ @testing-library/react, jsdom), pnpm.

## Global Constraints

- Package manager is **pnpm 11**; run tests/typecheck via `make test` and `make typecheck` (never `npm`/`yarn`).
- Modules in `src/main/core/` **must not import Electron**.
- The **renderer bundle must not import from `src/main/core/`** — duplicate pure logic as a parallel copy and cover it with a parity test.
- Comment/UI copy stays **general** — no company/team/language hardcoding.
- Commit after every task with the exact message shown.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass.

---

### Task 1: Core sort schema + comparator

**Files:**
- Modify: `src/main/core/schema.ts` (append `QueueSort` schema/type/default)
- Create: `src/main/core/queueSort.ts`
- Test: `test/queueSort.test.ts`

**Interfaces:**
- Produces (schema.ts): `export const QueueSort` (zod), `export type QueueSort = { key: "activity" | "repo"; dir: "asc" | "desc" }`, `export const DEFAULT_QUEUE_SORT: QueueSort`.
- Produces (queueSort.ts): `export interface SortableRow { key: string; repo: string; number: number; updatedAt: string }`, `export function compareRows(a: SortableRow, b: SortableRow, s: QueueSort): number`, `export function sortRows<T extends SortableRow>(rows: readonly T[], s: QueueSort): T[]`.

- [ ] **Step 1: Write the failing test**

Create `test/queueSort.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { compareRows, sortRows, type SortableRow } from "../src/main/core/queueSort";

const row = (over: Partial<SortableRow>): SortableRow => ({
  key: "k", repo: "r", number: 1, updatedAt: "2026-01-01T00:00:00Z", ...over,
});

describe("queueSort", () => {
  const a = row({ key: "a", repo: "alpha", number: 2, updatedAt: "2026-01-01T00:00:00Z" });
  const b = row({ key: "b", repo: "beta",  number: 1, updatedAt: "2026-03-01T00:00:00Z" });
  const c = row({ key: "c", repo: "alpha", number: 5, updatedAt: "2026-02-01T00:00:00Z" });

  it("activity desc = newest first", () => {
    expect(sortRows([a, b, c], { key: "activity", dir: "desc" }).map((r) => r.key)).toEqual(["b", "c", "a"]);
  });
  it("activity asc = oldest first", () => {
    expect(sortRows([a, b, c], { key: "activity", dir: "asc" }).map((r) => r.key)).toEqual(["a", "c", "b"]);
  });
  it("repo asc = repo A->Z then number low->high", () => {
    expect(sortRows([a, b, c], { key: "repo", dir: "asc" }).map((r) => r.key)).toEqual(["a", "c", "b"]);
  });
  it("repo desc = repo Z->A then number high->low", () => {
    expect(sortRows([a, b, c], { key: "repo", dir: "desc" }).map((r) => r.key)).toEqual(["b", "c", "a"]);
  });
  it("breaks ties on key, independent of direction", () => {
    const x = row({ key: "x", repo: "same", number: 1, updatedAt: "2026-01-01T00:00:00Z" });
    const y = row({ key: "y", repo: "same", number: 1, updatedAt: "2026-01-01T00:00:00Z" });
    expect(sortRows([y, x], { key: "activity", dir: "desc" }).map((r) => r.key)).toEqual(["x", "y"]);
    expect(sortRows([y, x], { key: "activity", dir: "asc" }).map((r) => r.key)).toEqual(["x", "y"]);
  });
  it("coerces empty/invalid updatedAt to 0 without throwing", () => {
    const p = row({ key: "p", updatedAt: "" });
    const q = row({ key: "q", updatedAt: "2026-05-01T00:00:00Z" });
    expect(sortRows([p, q], { key: "activity", dir: "desc" }).map((r) => r.key)).toEqual(["q", "p"]);
  });
  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortRows(input, { key: "activity", dir: "desc" });
    expect(input.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/queueSort.test.ts`
Expected: FAIL — cannot resolve `../src/main/core/queueSort`.

- [ ] **Step 3: Append the schema to `src/main/core/schema.ts`**

Add at the end of the file (it already imports `z`):

```ts
export const QueueSort = z.object({
  key: z.enum(["activity", "repo"]),
  dir: z.enum(["asc", "desc"]),
});
export type QueueSort = z.infer<typeof QueueSort>;
export const DEFAULT_QUEUE_SORT: QueueSort = { key: "activity", dir: "desc" };
```

- [ ] **Step 4: Create `src/main/core/queueSort.ts`**

```ts
import type { QueueSort } from "./schema";

export interface SortableRow {
  key: string;
  repo: string;
  number: number;
  updatedAt: string;
}

/** Compare two rows under the given sort. Direction flips the primary key only;
 *  ties break on `key` for a stable, direction-independent order. */
export function compareRows(a: SortableRow, b: SortableRow, s: QueueSort): number {
  const dir = s.dir === "desc" ? -1 : 1;
  let primary: number;
  if (s.key === "activity") {
    primary = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0);
  } else {
    primary = a.repo.localeCompare(b.repo) || a.number - b.number;
  }
  if (primary !== 0) return dir * primary;
  return a.key.localeCompare(b.key);
}

/** Return a new array sorted per `s`; never mutates `rows`. */
export function sortRows<T extends SortableRow>(rows: readonly T[], s: QueueSort): T[] {
  return [...rows].sort((a, b) => compareRows(a, b, s));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/queueSort.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/core/schema.ts src/main/core/queueSort.ts test/queueSort.test.ts
git commit -m "feat(core): add QueueSort schema and comparator"
```

---

### Task 2: Renderer parallel copy + parity test

**Files:**
- Create: `src/renderer/src/queueSort.ts`
- Test: `test/queueSort-parity.test.ts`

**Interfaces:**
- Produces: `export type QueueSort = { key: "activity" | "repo"; dir: "asc" | "desc" }`, `export const DEFAULT_QUEUE_SORT: QueueSort`, `export interface SortableRow`, `export function compareRows(...)`, `export function sortRows<T extends SortableRow>(...)` — behaviour identical to `core/queueSort.ts`.

- [ ] **Step 1: Write the failing parity test**

Create `test/queueSort-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as core from "../src/main/core/queueSort";
import * as ui from "../src/renderer/src/queueSort";
import type { SortableRow } from "../src/main/core/queueSort";

const rows: SortableRow[] = [
  { key: "a", repo: "alpha", number: 2, updatedAt: "2026-01-01T00:00:00Z" },
  { key: "b", repo: "beta",  number: 1, updatedAt: "2026-03-01T00:00:00Z" },
  { key: "c", repo: "alpha", number: 5, updatedAt: "2026-02-01T00:00:00Z" },
  { key: "d", repo: "alpha", number: 2, updatedAt: "2026-01-01T00:00:00Z" },
];

describe("queueSort parity: core vs renderer copy", () => {
  for (const key of ["activity", "repo"] as const) {
    for (const dir of ["desc", "asc"] as const) {
      it(`orders identically for ${key}/${dir}`, () => {
        const c = core.sortRows(rows, { key, dir }).map((r) => r.key);
        const u = ui.sortRows(rows, { key, dir }).map((r) => r.key);
        expect(u).toEqual(c);
      });
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/queueSort-parity.test.ts`
Expected: FAIL — cannot resolve `../src/renderer/src/queueSort`.

- [ ] **Step 3: Create `src/renderer/src/queueSort.ts` (parallel copy)**

```ts
// Parallel copy of src/main/core/queueSort.ts (the UI bundle cannot import core/).
// Keep in sync; test/queueSort-parity.test.ts enforces identical ordering.
export type QueueSortKey = "activity" | "repo";
export type QueueSortDir = "asc" | "desc";
export interface QueueSort {
  key: QueueSortKey;
  dir: QueueSortDir;
}
export const DEFAULT_QUEUE_SORT: QueueSort = { key: "activity", dir: "desc" };

export interface SortableRow {
  key: string;
  repo: string;
  number: number;
  updatedAt: string;
}

export function compareRows(a: SortableRow, b: SortableRow, s: QueueSort): number {
  const dir = s.dir === "desc" ? -1 : 1;
  let primary: number;
  if (s.key === "activity") {
    primary = (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0);
  } else {
    primary = a.repo.localeCompare(b.repo) || a.number - b.number;
  }
  if (primary !== 0) return dir * primary;
  return a.key.localeCompare(b.key);
}

export function sortRows<T extends SortableRow>(rows: readonly T[], s: QueueSort): T[] {
  return [...rows].sort((a, b) => compareRows(a, b, s));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/queueSort-parity.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/queueSort.ts test/queueSort-parity.test.ts
git commit -m "feat(renderer): add parallel queueSort copy with parity test"
```

---

### Task 3: Persist the sort preference in Settings

**Files:**
- Modify: `src/main/settings.ts`
- Test: `test/settings.test.ts`

**Interfaces:**
- Consumes: `QueueSort`, `DEFAULT_QUEUE_SORT` from `./core/schema` (Task 1).
- Produces: `Settings["queueSort"]` field, defaulting to `{ key: "activity", dir: "desc" }`.

- [ ] **Step 1: Write the failing test**

Add this `it(...)` inside the `describe("settings", ...)` block in `test/settings.test.ts`:

```ts
  it("defaults queueSort to activity/desc and round-trips a non-default", () => {
    expect(DEFAULT_SETTINGS.queueSort).toEqual({ key: "activity", dir: "desc" });
    const dir = mkdtempSync(join(tmpdir(), "pa-"));
    saveSettings(dir, { ...DEFAULT_SETTINGS, queueSort: { key: "repo", dir: "asc" } });
    expect(loadSettings(dir).queueSort).toEqual({ key: "repo", dir: "asc" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/settings.test.ts`
Expected: FAIL — `DEFAULT_SETTINGS.queueSort` is `undefined`.

- [ ] **Step 3: Add the field to `src/main/settings.ts`**

Change the import on line 4 from:

```ts
import { Language, Effort, OperatingMode } from "./core/schema";
```

to:

```ts
import { Language, Effort, OperatingMode, QueueSort, DEFAULT_QUEUE_SORT } from "./core/schema";
```

Then add this line to the `Settings` object (e.g. right after the `showClosed` line):

```ts
  queueSort: QueueSort.default(DEFAULT_QUEUE_SORT),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/settings.test.ts`
Expected: PASS (including the new case).

- [ ] **Step 5: Commit**

```bash
git add src/main/settings.ts test/settings.test.ts
git commit -m "feat(settings): persist queueSort preference"
```

---

### Task 4: Tray menu conforms to the selected sort

**Files:**
- Modify: `src/main/tray.ts`
- Test: `test/tray.test.ts`

**Interfaces:**
- Consumes: `sortRows` from `./core/queueSort` (Task 1), `QueueSort` from `./core/schema` (Task 1).
- Produces: `TrayHandlers.getSort(): QueueSort` (new required handler; `index.ts` supplies it in Task 5).

- [ ] **Step 1: Write the failing test**

In `test/tray.test.ts`, first add `QueueSort` to the schema import on line 6:

```ts
import type { PrRecord, OperatingMode, QueueSort } from "../src/main/core/schema";
```

Extend the shared `handlers` fixture (after the `getFilters` line, inside the object literal) with:

```ts
  getSort: () => ({ key: "activity", dir: "desc" }) as QueueSort,
```

Then add this test inside `describe("buildTrayMenu", ...)`:

```ts
  it("orders PRs by the selected sort", () => {
    const records = [
      rec({ key: "k1", number: 1, repo: "zebra", state: "NEEDS_REVIEW", updatedAt: "2026-01-01T00:00:00Z" }),
      rec({ key: "k2", number: 2, repo: "alpha", state: "NEEDS_REVIEW", updatedAt: "2026-03-01T00:00:00Z" }),
    ];
    const prLabels = (h: typeof handlers) =>
      buildTrayMenu(records, h).map((m) => m.label).filter((l) => l?.startsWith("#"));

    expect(prLabels({ ...handlers, getSort: () => ({ key: "activity", dir: "desc" }) as QueueSort }))
      .toEqual(["#2 alpha — NEEDS_REVIEW", "#1 zebra — NEEDS_REVIEW"]);
    expect(prLabels({ ...handlers, getSort: () => ({ key: "repo", dir: "asc" }) as QueueSort }))
      .toEqual(["#2 alpha — NEEDS_REVIEW", "#1 zebra — NEEDS_REVIEW"]);
    expect(prLabels({ ...handlers, getSort: () => ({ key: "repo", dir: "desc" }) as QueueSort }))
      .toEqual(["#1 zebra — NEEDS_REVIEW", "#2 alpha — NEEDS_REVIEW"]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/tray.test.ts`
Expected: FAIL — ordering is state-rank based (both NEEDS_REVIEW, so tie → `repo.localeCompare` gives alpha before zebra for every case), so the repo-desc expectation fails.

- [ ] **Step 3: Update `src/main/tray.ts`**

Add imports near the top (after the existing `visibility` import on line 6):

```ts
import { sortRows } from "./core/queueSort";
import type { QueueSort } from "./core/schema";
```

Add `getSort` to the `TrayHandlers` interface (after the `getFilters` line):

```ts
  getSort(): QueueSort;
```

Delete the now-unused `RANK` constant (lines 15–18):

```ts
const RANK: Record<string, number> = {
  NEEDS_REVIEW: 0, GENERATING: 1, POSTING: 2, POSTED_AWAITING_AUTHOR: 3,
  STALE: 4, ERROR: 5, DISCOVERED: 6, DONE: 7, CLOSED: 8,
};
```

Replace the filter+sort pair (current lines 54–55):

```ts
  const visible = records.filter((r) => isQueueVisible(r, h.getFilters()));
  visible.sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || a.repo.localeCompare(b.repo));
```

with:

```ts
  const visible = sortRows(records.filter((r) => isQueueVisible(r, h.getFilters())), h.getSort());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/tray.test.ts`
Expected: PASS (all cases, including the new ordering test).

- [ ] **Step 5: Commit**

```bash
git add src/main/tray.ts test/tray.test.ts
git commit -m "feat(tray): order PR list by the selected queue sort"
```

---

### Task 5: Main wiring — setQueueSort IPC, tray getSort, ⌘R menu, preload

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/windows.ts`
- Modify: `src/main/menu.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `QueueSort` from `./core/schema`; `TrayHandlers.getSort` (Task 4); `settings.queueSort` (Task 3).
- Produces (preload `Api`): `setQueueSort(s: { key: "activity" | "repo"; dir: "asc" | "desc" }) => Promise<void>`, `onTriggerPoll(cb: () => void) => () => void`. `App.tsx` (Tasks 6–7) relies on these.
- Produces (main): IPC channel `"queue-sort:set"`; renderer→ event `"trigger-poll"`; `getMain()` in `windows.ts`.

This is wiring/glue verified by `make typecheck` + the full suite staying green (the App/tray tests exercise the consumers). No new unit test.

- [ ] **Step 1: `windows.ts` — export a main-window accessor**

After the `showMain` function (around line 34), add:

```ts
export function getMain(): BrowserWindow | null { return main; }
```

- [ ] **Step 2: `menu.ts` — callbacks object + ⌘R Poll-now item**

Replace the whole file with:

```ts
import { Menu } from "electron";

export interface AppMenuHandlers {
  onPreferences: () => void;
  onPollNow: () => void;
}

export function installAppMenu(h: AppMenuHandlers): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "PR Autopilot",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Preferences…", accelerator: "CmdOrCtrl+,", click: () => h.onPreferences() },
        { label: "Poll Now", accelerator: "CmdOrCtrl+R", click: () => h.onPollNow() },
        { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
```

- [ ] **Step 3: `ipc.ts` — deps type + handler**

Add `QueueSort` to the schema import on line 7:

```ts
import { OperatingMode, QueueSort } from "./core/schema";
```

Add to the `IpcDeps` interface (after the `setQueueFilters` line):

```ts
  setQueueSort: (s: QueueSort) => void;
```

Register the handler (after the `queue-filters:set` handler, line 40):

```ts
  ipcMain.handle("queue-sort:set", (_e, s: QueueSort) => d.setQueueSort(s));
```

- [ ] **Step 4: `index.ts` — imports, tray handler, setQueueSort, menu wiring, prefs preservation**

Update the `windows` import (line 13) to include `getMain`:

```ts
import { showMain, showPreferences, openExternal, getMain } from "./windows";
```

Add a `QueueSort` import alongside the existing `settings` import (keep both):

```ts
import { QueueSort } from "./core/schema";
```

In the `trayHandlers` object literal, add after the `getFilters` line (line 67):

```ts
      getSort: () => settings.queueSort,
```

Replace the `installAppMenu(...)` call (line 71) with:

```ts
    installAppMenu({
      onPreferences: () => showPreferences(),
      onPollNow: () => {
        const w = getMain();
        if (w && !w.isDestroyed()) w.webContents.send("trigger-poll");
        else trayHandlers.pollNow();
      },
    });
```

Add a `setQueueSort` function next to `setQueueFilters` (after line 143):

```ts
    function setQueueSort(s: QueueSort): void {
      settings = { ...settings, queueSort: QueueSort.parse(s) };
      saveSettings(dataDir, settings);
      refreshTray(() => store.list(), trayHandlers);
    }
```

In the `registerIpc({ ... })` call, add `setQueueSort,` next to `setQueueFilters,` (line 161):

```ts
      setQueueFilters,
      setQueueSort,
```

Preserve `queueSort` through the prefs-form save — in the `setSettings` callback (lines 148–153), append `queueSort: settings.queueSort` to the merged object:

```ts
        settings = { ...parsed, operatingMode: settings.operatingMode, automatedConfirmed: settings.automatedConfirmed,
          showDone: settings.showDone, showDismissed: settings.showDismissed, showClosed: settings.showClosed,
          queueSort: settings.queueSort };
```

- [ ] **Step 5: `preload/index.ts` — expose setQueueSort + onTriggerPoll**

Add after the `setQueueFilters` line (line 20):

```ts
  setQueueSort: (s: { key: "activity" | "repo"; dir: "asc" | "desc" }) => ipcRenderer.invoke("queue-sort:set", s),
```

Add after the `onFocusPr` block (before the closing `};` on line 46):

```ts
  onTriggerPoll: (cb: () => void) => {
    const fn = () => cb();
    ipcRenderer.on("trigger-poll", fn);
    return () => ipcRenderer.removeListener("trigger-poll", fn);
  },
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `make typecheck && make test`
Expected: typecheck clean; all existing tests pass (no regressions). `app.test.tsx` still passes because its `api` mock is updated only in Task 7 — until then App does not yet call the new methods.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts src/main/windows.ts src/main/menu.ts src/preload/index.ts
git commit -m "feat(main): queue-sort IPC, tray getSort, and CmdOrCtrl+R Poll-now"
```

---

### Task 6: QueueFilter — funnel icon, direction badge, sort section

**Files:**
- Modify: `src/renderer/src/components/QueueFilter.tsx`
- Modify: `src/renderer/src/styles.css`
- Test: `test/renderer/components.test.tsx`

**Interfaces:**
- Consumes: `QueueSort` from `../queueSort` (Task 2).
- Produces: `QueueFilter` now requires `sort: QueueSort` and `onSortChange: (s: QueueSort) => void` props. `App.tsx` (Task 7) passes them.

- [ ] **Step 1: Write the failing tests**

In `test/renderer/components.test.tsx`, update the `QueueFilter` `props` object (line 140) to include the new props:

```ts
  const props = { showDone: false, showDismissed: false, showClosed: false, doneCount: 2, dismissedCount: 1, closedCount: 3, onChange: vi.fn(), sort: { key: "activity", dir: "desc" } as const, onSortChange: vi.fn() };
```

Add these tests inside `describe("QueueFilter", ...)`:

```ts
  it("toggles direction when the active sort key is clicked again", () => {
    const onSortChange = vi.fn();
    render(<QueueFilter {...props} sort={{ key: "activity", dir: "desc" }} onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /recent activity/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "activity", dir: "asc" });
  });

  it("switches to the other key at descending", () => {
    const onSortChange = vi.fn();
    render(<QueueFilter {...props} sort={{ key: "activity", dir: "asc" }} onSortChange={onSortChange} />);
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /repo & number/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "repo", dir: "desc" });
  });

  it("badges the direction and marks the active key", () => {
    const { container } = render(<QueueFilter {...props} sort={{ key: "repo", dir: "asc" }} />);
    expect(container.querySelector(".filter-badge")?.textContent).toBe("↑");
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    expect(screen.getByRole("menuitemradio", { name: /repo & number/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /recent activity/i })).toHaveAttribute("aria-checked", "false");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/renderer/components.test.tsx`
Expected: FAIL — no `menuitemradio` role exists; `.filter-badge` is null.

- [ ] **Step 3: Rewrite `src/renderer/src/components/QueueFilter.tsx`**

```tsx
import { useState, useRef, useEffect } from "react";
import type { QueueSort } from "../queueSort";

interface QueueFilterProps {
  showDone: boolean;
  showDismissed: boolean;
  showClosed: boolean;
  doneCount: number;
  dismissedCount: number;
  closedCount: number;
  onChange: (next: { showDone: boolean; showDismissed: boolean; showClosed: boolean }) => void;
  sort: QueueSort;
  onSortChange: (next: QueueSort) => void;
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3" />
    </svg>
  );
}

export function QueueFilter({ showDone, showDismissed, showClosed, doneCount, dismissedCount, closedCount, onChange, sort, onSortChange }: QueueFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const arrow = (dir: QueueSort["dir"]) => (dir === "desc" ? "↓" : "↑");
  const pickSort = (key: QueueSort["key"]) =>
    onSortChange(key === sort.key ? { key, dir: sort.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });

  return (
    <div className="queue-filter" ref={ref}>
      <button
        type="button"
        className="filter-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Filter and sort"
        onClick={() => setOpen((v) => !v)}
      >
        <FunnelIcon />
        <span className="filter-badge" aria-hidden="true">{arrow(sort.dir)}</span>
      </button>
      {open && (
        <div className="filter-menu" role="menu">
          <div className="filter-section-label">Sort</div>
          <button type="button" role="menuitemradio" aria-checked={sort.key === "activity"} className="sort-opt" onClick={() => pickSort("activity")}>
            <span className="sort-arrow" aria-hidden="true">{sort.key === "activity" ? arrow(sort.dir) : "↓"}</span>
            Recent activity
          </button>
          <button type="button" role="menuitemradio" aria-checked={sort.key === "repo"} className="sort-opt" onClick={() => pickSort("repo")}>
            <span className="sort-arrow" aria-hidden="true">{sort.key === "repo" ? arrow(sort.dir) : "↓"}</span>
            Repo &amp; number
          </button>
          <div className="filter-sep" role="separator" />
          <div className="filter-section-label">Show</div>
          <label className="filter-opt filter-opt--all">
            <input
              type="checkbox"
              checked={showDone && showDismissed && showClosed}
              onChange={(e) =>
                onChange({ showDone: e.target.checked, showDismissed: e.target.checked, showClosed: e.target.checked })
              }
            />
            Show all
          </label>
          <div className="filter-sep" role="separator" />
          <label className="filter-opt">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => onChange({ showDone: e.target.checked, showDismissed, showClosed })}
            />
            Show done{doneCount ? ` (${doneCount})` : ""}
          </label>
          <label className="filter-opt">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => onChange({ showDone, showDismissed: e.target.checked, showClosed })}
            />
            Show dismissed{dismissedCount ? ` (${dismissedCount})` : ""}
          </label>
          <label className="filter-opt">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => onChange({ showDone, showDismissed, showClosed: e.target.checked })}
            />
            Show closed{closedCount ? ` (${closedCount})` : ""}
          </label>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add styles to `src/renderer/src/styles.css`**

Replace the existing `.filter-btn` / `.filter-btn:hover` / `.filter-btn[aria-expanded="true"]` rules (lines 98–115) with:

```css
.filter-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 26px;
  padding: 0;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 999px;
  cursor: pointer;
}
.filter-btn svg {
  width: 14px;
  height: 14px;
}
.filter-btn:hover {
  color: var(--fg);
  border-color: var(--accent-dim);
}
.filter-btn[aria-expanded="true"] {
  color: var(--accent);
  border-color: var(--accent-dim);
  background: rgba(70, 198, 192, 0.1);
}
.filter-badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  min-width: 13px;
  height: 13px;
  padding: 0 2px;
  display: grid;
  place-items: center;
  font: 700 9px/1 var(--ui);
  color: #0b0f14;
  background: var(--accent);
  border-radius: 999px;
}
```

Append near the existing `.filter-opt` rules (after `.filter-sep`, line 537):

```css
.filter-section-label {
  font: 600 9px/1 var(--ui);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  padding: 6px 8px 3px;
}
.sort-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 5px;
  font: 12px/1.3 var(--ui);
  color: var(--fg);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.sort-opt:hover {
  background: #1b212a;
}
.sort-opt[aria-checked="true"] {
  color: var(--accent);
}
.sort-opt .sort-arrow {
  width: 12px;
  text-align: center;
  color: var(--muted);
}
.sort-opt[aria-checked="true"] .sort-arrow {
  color: var(--accent);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run test/renderer/components.test.tsx`
Expected: PASS — the three new tests plus all pre-existing `QueueFilter` tests (the trigger button still matches `name: /filter/i` via its `aria-label`).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/QueueFilter.tsx src/renderer/src/styles.css test/renderer/components.test.tsx
git commit -m "feat(renderer): funnel icon with sort section and direction badge"
```

---

### Task 7: App integration — sort state, sorted render, ⌘R subscription

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Test: `test/renderer/app.test.tsx`

**Interfaces:**
- Consumes: `sortRows`, `DEFAULT_QUEUE_SORT`, `QueueSort` from `./queueSort` (Task 2); `api.setQueueSort`, `api.onTriggerPoll` (Task 5); `QueueFilter` `sort`/`onSortChange` props (Task 6).

- [ ] **Step 1: Update the api mock, then write failing tests**

In `test/renderer/app.test.tsx`, extend the hoisted `api` mock object with three entries:

```ts
  setQueueSort: vi.fn(async () => {}),
  onTriggerPoll: vi.fn((_cb: () => void) => () => {}),
```

and change the `getSettings` mock to include `queueSort`:

```ts
  getSettings: vi.fn(async () => ({ operatingMode: "supervised", pollIntervalSec: 600, showDone: false, showDismissed: false, showClosed: false, queueSort: { key: "activity", dir: "desc" } })),
```

Then add this `describe` block at the end of the file:

```ts
describe("App queue sort + poll shortcut", () => {
  const rows: UiRow[] = [
    { key: "old", number: 1, repo: "zebra", title: "old", state: "NEEDS_REVIEW", mode: "first-review", counts: null, dismissed: false, updatedAt: "2026-01-01T00:00:00Z" },
    { key: "new", number: 2, repo: "alpha", title: "new", state: "NEEDS_REVIEW", mode: "first-review", counts: null, dismissed: false, updatedAt: "2026-03-01T00:00:00Z" },
  ];

  it("renders the queue newest-first by default", async () => {
    api.list.mockResolvedValueOnce({ items: rows });
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelectorAll(".queue-list .row").length).toBe(2));
    const keys = Array.from(container.querySelectorAll<HTMLElement>(".queue-list .row")).map((el) => el.dataset.key);
    expect(keys).toEqual(["new", "old"]);
  });

  it("persists a sort change through api.setQueueSort", async () => {
    api.list.mockResolvedValueOnce({ items: rows });
    render(<App />);
    await waitFor(() => screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("button", { name: /filter/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /recent activity/i }));
    expect(api.setQueueSort).toHaveBeenCalledWith({ key: "activity", dir: "asc" });
  });

  it("fires a poll when the trigger-poll event arrives", async () => {
    let trigger: (() => void) | undefined;
    api.onTriggerPoll.mockImplementation((cb: () => void) => { trigger = cb; return () => {}; });
    render(<App />);
    await waitFor(() => expect(trigger).toBeDefined());
    act(() => trigger!());
    await waitFor(() => expect(api.pollNow).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/renderer/app.test.tsx`
Expected: FAIL — rows render in `list` order (`["old","new"]`), `api.setQueueSort` is never called, and `trigger` stays undefined (App does not subscribe yet).

- [ ] **Step 3: Wire sort + poll subscription into `src/renderer/src/App.tsx`**

Add the import after line 7:

```ts
import { sortRows, DEFAULT_QUEUE_SORT, type QueueSort } from "./queueSort";
```

Add sort state next to the other `useState` calls (after line 34, the `pollIntervalSec` state):

```ts
  const [sort, setSort] = useState<QueueSort>(DEFAULT_QUEUE_SORT);
```

Add a `pollNowRef` and keep it current — place these two lines right after the `pollNow` function definition (after line 91):

```ts
  const pollNowRef = useRef(pollNow);
  pollNowRef.current = pollNow;
```

Add an `applySort` function next to `applyFilters` (after line 98):

```ts
  function applySort(next: QueueSort) {
    setSort(next);
    api.setQueueSort(next);
  }
```

Load the persisted sort — in the `getSettings().then(...)` callback, extend the destructured type and add a setter. Change the callback signature (line 102) to include `queueSort?: QueueSort` and add the line:

```ts
      if (s?.queueSort) setSort(s.queueSort);
```

Subscribe to `trigger-poll` in the mount effect — add before the `return () => {` cleanup (after line 121, the `onFocusPr` subscription):

```ts
    const offPoll = api.onTriggerPoll(() => pollNowRef.current());
```

and add `offPoll();` to the cleanup block (alongside `off1(); off2();`).

Compute sorted rows — add right after the `visibleRows` line (line 135):

```ts
  const sortedRows = sortRows(visibleRows, sort);
```

Render `sortedRows` instead of `visibleRows` — change line 251 from `visibleRows.map((row) => (` to:

```ts
              sortedRows.map((row) => (
```

Pass the sort props to `QueueFilter` — add to its JSX (after the `onChange={applyFilters}` prop, line 242):

```tsx
              sort={sort}
              onSortChange={applySort}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/renderer/app.test.tsx`
Expected: PASS (the three new tests plus all existing App tests).

- [ ] **Step 5: Full verification**

Run: `make typecheck && make test`
Expected: typecheck clean; entire suite green.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx test/renderer/app.test.tsx
git commit -m "feat(renderer): sort the queue and bind CmdOrCtrl+R to Poll now"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Launch the app**

Run: `make dev`

- [ ] **Step 2: Verify the sort UI**

- The toolbar shows a funnel icon with a `↓` badge (default Recent activity, desc).
- Open the popover: **Sort** section shows "Recent activity" (checked, ↓) and "Repo & number".
- Click "Recent activity" again → badge flips to `↑`, queue reorders oldest-first.
- Click "Repo & number" → badge shows `↓`, queue groups by repo Z→A.
- Quit and relaunch → the last-selected sort is restored.

- [ ] **Step 3: Verify tray conformance**

- Open the tray menu → the PR list order matches the main queue's current sort.
- Change the sort in the window → reopen the tray → order updated.

- [ ] **Step 4: Verify ⌘R**

- With the window focused, press **⌘R** → the Poll-now button shows "Polling…" and the list refreshes. Confirm the window does **not** reload.

- [ ] **Step 5: Final commit (if any doc tweaks were needed)**

No code changes expected here; if manual testing surfaced issues, fix them under the relevant task above and re-run `make test`.

---

## Self-Review

**Spec coverage:**
- Sortable queue (model, default, reversible) → Tasks 1, 2, 7. ✓
- Persistence → Task 3, Task 5 (IPC + preserve on prefs save). ✓
- Icon toolbar + badge + sort section → Task 6. ✓
- Tray conformance (live) → Task 4 (ordering) + Task 5 (`getSort`, `refreshTray` on set). ✓
- ⌘R Poll-now → Task 5 (menu/window/preload) + Task 7 (App subscription). ✓
- Shared parallel copy + parity → Tasks 1, 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✓

**Type consistency:** `QueueSort` = `{ key: "activity" | "repo"; dir: "asc" | "desc" }` everywhere; `sortRows`/`compareRows`/`SortableRow` names match across core, renderer, and consumers; `getSort`/`setQueueSort`/`onTriggerPoll` names match between producer (Task 5) and consumers (Tasks 4, 7). ✓
