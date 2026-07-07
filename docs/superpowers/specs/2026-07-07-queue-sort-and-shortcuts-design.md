# Queue sort, icon toolbar, tray conformance, and ⌘R Poll-now — design

Date: 2026-07-07
Status: Approved design (revised for tray conformance), pending plan

## Summary

Four related changes centered on a new user-controlled queue sort:

1. **Sortable queue** — the queue list is currently unsorted (raw
   `readdirSync` order, effectively grouped by repo + PR number). Add a sort
   with two keys — **Recent activity** (`updatedAt`) and **Repo & number** —
   each reversible. Defaults to *Recent activity, descending* (newest first).
   The preference persists across restarts.
2. **Icon toolbar** — the text **Filter** button becomes a **funnel icon**
   carrying a small **direction badge** (↓/↑) reflecting the active sort
   direction. The sort control lives inside the same popover as arrow-glyph rows
   (Option C from the visual brainstorm).
3. **Tray conforms to the sort** — the tray menu's PR list currently orders by a
   fixed review-state rank then repo (`tray.ts`). It should instead order by the
   **same selected sort** as the main queue, updating live when the sort changes.
4. **⌘R shortcut for Poll now** — bind `CmdOrCtrl+R` to the existing Poll-now
   action via an app-menu accelerator. Cmd+R is currently unbound (the custom
   menu in `menu.ts` has no reload item), so there is no conflict.

## Non-goals (YAGNI)

- The **Poll now** button and the **interval `select`** keep their text — only
  Filter/Sort become symbols, per the request.
- **No `createdAt`** field; `updatedAt` is the only history signal and is
  sufficient for "historically descending".
- **No cross-window broadcast** for the sort preference. Only the main window
  mutates it (and it holds its own state locally); the main process re-reads it
  from `settings` when rebuilding the tray. No `queue-sort-changed` event.

## Sort model

```ts
type QueueSort = { key: "activity" | "repo"; dir: "asc" | "desc" };
```

Interaction (in the popover):

- Click a sort row whose `key` **differs** from the active one → switch to it at
  `dir: "desc"` (both keys default to descending — uniform behavior).
- Click the **active** row again → toggle `dir` (`desc` ⟷ `asc`).
- Default on first run: `{ key: "activity", dir: "desc" }` (newest first).

Comparator semantics — direction flips the **primary** key only; ties break on
`key` for a stable, direction-independent order:

- **activity** — by `Date.parse(updatedAt)` (invalid/empty → `0`). `desc` = newest
  first.
- **repo** — `repo.localeCompare` then `number` ascending. `desc` = repo Z→A,
  number high→low.

## Shared comparator (parallel copies, per house convention)

The comparator runs on **two surfaces** — the renderer queue and the main-process
tray — but **the renderer bundle cannot import from `core/`** (see the note in
`src/renderer/src/visibility.ts`). So it follows the established parallel-copy
pattern used for `visibility` and the `guard`:

- **`src/main/core/queueSort.ts`** (authoritative) — `SortableRow`,
  `compareRows`, `sortRows`. Consumed by `tray.ts`.
- **`src/renderer/src/queueSort.ts`** (parallel copy) — same logic + the
  `QueueSort` type and `DEFAULT_QUEUE_SORT`. Consumed by `App.tsx` /
  `QueueFilter.tsx`.
- **`test/queueSort-parity.test.ts`** — asserts both copies order an identical
  fixture identically across all four `{key, dir}` combinations (mirrors
  `guard-shim.test.ts`).

Both operate on the structural shape `{ key; repo; number; updatedAt }`, which
`UiRow` (renderer) and `PrRecord` (main) both satisfy.

The **zod** schema for validation/persistence lives once in
`src/main/core/schema.ts` (`QueueSort`, `DEFAULT_QUEUE_SORT`); `settings.ts`
imports it. The renderer copy redefines the plain TS type (it cannot import
core), and the parity test guards against drift.

### Where sorting is applied

- **Renderer** — `App.tsx` computes `sortedRows = sortRows(visibleRows, sort)`
  and renders that. The selection-clear/title effects keep using `visibleRows`
  (order-independent), so they are unaffected.
- **Tray** — `buildTrayMenu` replaces its `RANK`-based `.sort(...)` with
  `sortRows(visible, h.getSort())`.

## Persistence & wiring

- **`settings.ts`** — add `queueSort: QueueSort.default(DEFAULT_QUEUE_SORT)`
  (importing both from `core/schema`). Old settings files get the default via
  zod. In `index.ts`, `setSettings` (the prefs-form path) must **preserve**
  `queueSort` alongside the other live main-window controls, so saving prefs
  never clobbers it.
- **IPC** — add `IpcDeps.setQueueSort`, register
  `ipcMain.handle("queue-sort:set", (_e, s) => d.setQueueSort(s))`. In
  `index.ts`, `setQueueSort` assigns `settings.queueSort`, `saveSettings`, and
  **`refreshTray(...)`** (so the tray reorders live). No broadcast.
- **`preload/index.ts`** — add `setQueueSort` to the exposed `Api`.
- **Tray handler** — add `getSort(): QueueSort` to `TrayHandlers`; `index.ts`
  supplies `() => settings.queueSort`.
- **Load** — `getSettings()` already returns the full `Settings`, so `App.tsx`
  reads `s.queueSort` in its existing mount effect.

## Toolbar UI (Option C)

`components/QueueFilter.tsx` gains `sort: QueueSort` and
`onSortChange: (s: QueueSort) => void`.

- **Trigger button** — replace `"Filter"` text with an inline funnel `<svg>` plus
  a `.filter-badge` span showing `↓`/`↑` for `sort.dir`. `aria-label="Filter and
  sort"`.
- **Popover** — a **Sort** section on top: two `<button role="menuitemradio"
  aria-checked>` rows ("Recent activity", "Repo & number"), each with a leading
  arrow glyph (active row shows its `dir`; inactive shows a muted `↓`). Click
  applies the interaction rules. Then the existing **Show** checkboxes, unchanged.

Icons are inline monochrome SVG (`stroke="currentColor"`), consistent with the
existing self-contained styling in `styles.css` (no icon font/asset).

## ⌘R Poll now

Route the accelerator through the existing renderer Poll-now flow so the
"Polling…" button state and list refresh behave exactly like a click.

- **`windows.ts`** — add `export function getMain(): BrowserWindow | null`.
- **`menu.ts`** — `installAppMenu(h: { onPreferences; onPollNow })`; add
  `{ label: "Poll Now", accelerator: "CmdOrCtrl+R", click: () => h.onPollNow() }`
  after Preferences.
- **`index.ts`** — `onPollNow`: if `getMain()` is live, `send("trigger-poll")`;
  else fall back to `trayHandlers.pollNow()` (tray-only case).
- **`preload/index.ts`** — add `onTriggerPoll(cb)` mirroring `onFocusPr`.
- **`App.tsx`** — subscribe `api.onTriggerPoll(() => pollNowRef.current())`; a
  `pollNowRef` (reassigned each render, like `selectedKeyRef`) lets the
  once-bound subscription call the latest `pollNow`, so its `if (polling) return`
  guard reads fresh state.

Trade-off: removes reload-via-⌘R during `make dev`, irrelevant for a tray utility.

## File-by-file change list

| File | Change |
| --- | --- |
| `src/main/core/schema.ts` | `QueueSort` zod + type + `DEFAULT_QUEUE_SORT` |
| `src/main/core/queueSort.ts` | **new** — `SortableRow`, `compareRows`, `sortRows` |
| `src/renderer/src/queueSort.ts` | **new** — parallel copy + `QueueSort` type + default |
| `src/main/settings.ts` | `queueSort` field (default) |
| `src/main/tray.ts` | `getSort` on `TrayHandlers`; `sortRows(...)` replaces `RANK` sort |
| `src/main/ipc.ts` | `IpcDeps.setQueueSort` + `queue-sort:set` handler |
| `src/main/index.ts` | `setQueueSort` (+tray refresh); `trayHandlers.getSort`; preserve `queueSort` in `setSettings`; `installAppMenu({onPreferences,onPollNow})` + `onPollNow` |
| `src/main/windows.ts` | `getMain()` accessor |
| `src/main/menu.ts` | callbacks object; "Poll Now" ⌘R item |
| `src/preload/index.ts` | `setQueueSort`, `onTriggerPoll` on `Api` |
| `src/renderer/src/components/QueueFilter.tsx` | funnel icon + badge; sort section |
| `src/renderer/src/App.tsx` | sort state + load/persist; render `sortedRows`; `onTriggerPoll` + `pollNowRef` |
| `src/renderer/src/styles.css` | icon button, badge, sort-row styles |

## Testing

- **`test/queueSort.test.ts`** (new) — `compareRows`/`sortRows` for activity
  desc/asc and repo desc/asc, tie-break stability, non-mutation.
- **`test/queueSort-parity.test.ts`** (new) — core vs renderer copy identical
  ordering across all four `{key, dir}`.
- **`test/settings.test.ts`** — `DEFAULT_SETTINGS.queueSort` default; round-trip a
  non-default.
- **`test/tray.test.ts`** — extend the handler fixture with `getSort`; add a test
  that `buildTrayMenu` orders PRs per `getSort` (activity-desc vs repo-asc vs
  repo-desc).
- **`test/renderer/components.test.tsx`** — extend `QueueFilter` props; assert the
  active-key click toggles `dir`, the other-key click switches at `desc`, and the
  badge reflects `dir`.
- **`test/renderer/app.test.tsx`** — extend the `api` mock (`setQueueSort`,
  `onTriggerPoll`, `getSettings.queueSort`); assert default newest-first order,
  that a sort click calls `api.setQueueSort`, and that a `trigger-poll` fires
  `api.pollNow`.
- **Manual** — ⌘R triggers a poll ("Polling…" shows); no reload side effect.

## Resolved decisions

- Sort lives **inside the Filter popover** (Option C); funnel carries a direction
  badge.
- **Both** sort keys default to **descending**; clicking the active key reverses.
- Sort **default is on** (newest-first) and **persists**.
- **Tray order follows the same sort**, refreshed live on change.
- Comparator is a **parallel copy** (core ↔ renderer) with a **parity test**.
- ⌘R uses a **menu accelerator** routed to the renderer Poll-now flow.
