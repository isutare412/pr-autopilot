# Queue sort, icon toolbar, and ⌘R Poll-now — design

Date: 2026-07-07
Status: Approved design, pending spec review

## Summary

Three related changes to the main review window's queue toolbar
(`src/renderer/src/App.tsx` + `components/QueueFilter.tsx`):

1. **Sortable queue** — the queue list is currently unsorted (raw
   `readdirSync` order, effectively grouped by repo + PR number). Add a
   user-controlled sort with two keys — **Recent activity** (`updatedAt`) and
   **Repo & number** — each reversible. Defaults to *Recent activity,
   descending* (newest first). The preference persists across restarts.
2. **Icon toolbar** — the text **Filter** button becomes a **funnel icon**
   carrying a small **direction badge** (↓/↑) that reflects the active sort
   direction at a glance. The sort control lives inside the same popover as
   arrow-glyph rows (Option C from the visual brainstorm).
3. **⌘R shortcut for Poll now** — bind `CmdOrCtrl+R` to the existing Poll-now
   action via an app-menu accelerator. Cmd+R is currently unbound (the custom
   menu in `menu.ts` has no reload item), so there is no conflict.

## Non-goals (YAGNI)

- The **Poll now** button and the **interval `select`** keep their text — only
  Filter/Sort become symbols, per the request.
- **No `createdAt`** field is introduced; `updatedAt` is the only history signal
  and is sufficient for "historically descending".
- **No cross-window broadcast** for the sort preference. Filters broadcast
  because the tray also toggles them; nothing outside the main window mutates
  sort, so it only needs persist + load.
- The **tray menu** ordering (`tray.ts`, by review-state then repo) is unchanged.

## Sort model

State shape (shared structural type):

```ts
type QueueSort = { key: "activity" | "repo"; dir: "asc" | "desc" };
```

Interaction (in the popover):

- Click a sort row whose `key` **differs** from the active one → switch to it at
  `dir: "desc"` (both keys default to descending — uniform behavior).
- Click the **active** row again → toggle `dir` (`desc` ⟷ `asc`).
- Default on first run: `{ key: "activity", dir: "desc" }` (newest first).

Comparator semantics (descending shown; `asc` negates the result):

- **activity / desc** — newest `updatedAt` first.
- **repo / desc** — `repo` Z→A, then `number` high→low.

A stable tie-break on `key` keeps ordering deterministic.

### Where sorting happens

In the **renderer**, as a pure view concern — the list already arrives via
`api.list()` and sorting there keeps it instant and avoids widening IPC. A pure,
unit-tested module:

```
src/renderer/src/queueSort.ts
  export type QueueSort = { key: "activity" | "repo"; dir: "asc" | "desc" };
  export function compareRows(a: UiRow, b: UiRow, s: QueueSort): number
  export function sortRows(rows: UiRow[], s: QueueSort): UiRow[]   // non-mutating
```

`App.tsx` computes `sortedRows = sortRows(visibleRows, sort)` and renders that.
The existing selection-clear effect keeps using `visibleRows` for membership
(order-independent), so it is unaffected.

## Persistence

Mirror the filters path, minus the broadcast:

- **`src/main/settings.ts`** — add to the `Settings` zod object:
  ```ts
  queueSort: z
    .object({ key: z.enum(["activity", "repo"]), dir: z.enum(["asc", "desc"]) })
    .default({ key: "activity", dir: "desc" }),
  ```
  Existing settings files without the field get the default via zod. Export
  `export type QueueSort = Settings["queueSort"]`.
- **IPC** (`ipc.ts` + `index.ts`): add `IpcDeps.setQueueSort`, register
  `ipcMain.handle("queue-sort:set", (_e, s) => d.setQueueSort(s))`, and implement
  `setQueueSort` in `index.ts` to assign `settings.queueSort` and `saveSettings`.
  No `queue-sort-changed` broadcast.
- **`preload/index.ts`** — add `setQueueSort: (s) => ipcRenderer.invoke("queue-sort:set", s)` to the exposed `Api`.
- **Load** — `getSettings()` already returns the full `Settings`, so `App.tsx`
  reads `s.queueSort` in its existing mount effect.

## Toolbar UI (Option C)

`components/QueueFilter.tsx` gains two props: `sort: QueueSort` and
`onSortChange: (s: QueueSort) => void`. (Component keeps its name; the funnel now
opens a combined sort+filter popover.)

- **Trigger button** — replace the `"Filter"` text with an inline funnel `<svg>`
  plus a badge span showing `↓`/`↑` for `sort.dir`. `aria-label="Filter and sort"`,
  `title` reflects the active sort (e.g. "Recent activity, newest first").
- **Popover** — a new **Sort** section on top:
  - Two rows rendered as `<button role="menuitemradio" aria-checked>`: "Recent
    activity" and "Repo & number", each with a leading arrow glyph (active row
    shows its `dir` arrow; inactive shows a muted `↓`).
  - Click handler applies the interaction rules above via `onSortChange`.
  - A `.filter-sep` separator, then the existing **Show done/dismissed/closed**
    checkboxes, unchanged.

Icons are inline monochrome SVG using `stroke="currentColor"` (matches the app's
theme-able aesthetic; no icon font or asset dependency, consistent with the
self-contained styling already in `styles.css`).

**`styles.css`** additions: make `.filter-btn` a square icon button, add
`.filter-badge` (small accent pill, bottom-right), `.filter-icon svg` sizing, and
`.sort-opt` / `.sort-opt[aria-checked="true"]` / `.sort-arrow` /
`.filter-section-label` for the sort rows.

## ⌘R Poll now

Route the accelerator through the existing renderer Poll-now flow so the
"Polling…" button state and list refresh behave exactly like a click.

- **`src/main/windows.ts`** — add `export function getMain(): BrowserWindow | null`.
- **`src/main/menu.ts`** — change `installAppMenu` to take
  `{ onPreferences, onPollNow }`. Add to the app submenu (after Preferences,
  with a separator):
  ```ts
  { label: "Poll Now", accelerator: "CmdOrCtrl+R", click: () => onPollNow() }
  ```
- **`src/main/index.ts`** — wire `onPollNow`:
  ```ts
  onPollNow: () => {
    const w = getMain();
    if (w && !w.isDestroyed()) w.webContents.send("trigger-poll");
    else trayHandlers.pollNow();   // tray-only: poll in main + refresh tray
  }
  ```
- **`preload/index.ts`** — add `onTriggerPoll(cb)` mirroring `onFocusPr`
  (subscribe to `"trigger-poll"`, return an unsubscribe).
- **`App.tsx`** — in the mount effect, subscribe
  `const offPoll = api.onTriggerPoll(() => pollNowRef.current())` and add
  `offPoll()` to cleanup. A `pollNowRef` (reassigned to `pollNow` each render,
  like `selectedKeyRef`) ensures the once-bound subscription calls the latest
  closure, so its `if (polling) return` re-entrancy guard reads fresh state.

One accepted trade-off: this removes reload-via-⌘R during `make dev`, which is
irrelevant for a tray utility (Vite HMR handles reloads).

## File-by-file change list

| File | Change |
| --- | --- |
| `src/renderer/src/queueSort.ts` | **new** — `QueueSort` type, `compareRows`, `sortRows` |
| `src/renderer/src/App.tsx` | sort state + load/persist; render `sortedRows`; `onTriggerPoll` subscribe + `pollNowRef` |
| `src/renderer/src/components/QueueFilter.tsx` | funnel icon + badge; sort section in popover |
| `src/renderer/src/styles.css` | icon button, badge, sort-row styles |
| `src/main/settings.ts` | `queueSort` field + `QueueSort` type export |
| `src/main/ipc.ts` | `IpcDeps.setQueueSort` + `queue-sort:set` handler |
| `src/main/index.ts` | implement `setQueueSort`; `installAppMenu({ onPreferences, onPollNow })` |
| `src/main/windows.ts` | `getMain()` accessor |
| `src/main/menu.ts` | callbacks object; "Poll Now" ⌘R item |
| `src/preload/index.ts` | `setQueueSort`, `onTriggerPoll` on `Api` |

## Testing

- **`test/renderer/queueSort.test.ts`** (new) — `compareRows`/`sortRows` for
  activity desc/asc and repo desc/asc, plus tie-break stability and
  non-mutation.
- **Settings** — assert `Settings.parse({}).queueSort` equals the default, and
  that a stored `queueSort` round-trips.
- **`QueueFilter`** component test — clicking the active sort row toggles `dir`;
  clicking the other key switches at `desc`; badge reflects `dir`.
- **Manual** — ⌘R triggers a poll (button shows "Polling…"); accelerator has no
  reload side effect. Menu accelerators aren't practical to unit-test.

## Resolved decisions

- Sort lives **inside the Filter popover** (Option C), funnel carries a direction
  badge.
- **Both** sort keys default to **descending**; clicking the active key reverses.
- Sort **default is on** (newest-first) and **persists**.
- ⌘R uses a **menu accelerator** routed to the renderer Poll-now flow.
