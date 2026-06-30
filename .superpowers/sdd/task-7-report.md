# Task 7 Report — Renderer: Operating-Mode Segmented Control

## Status: DONE

## What was implemented

Three files changed in commit `9594bc3`:

### `test/renderer/app.test.tsx`
- Added `getSettings`, `setMode`, `onModeChanged` to the `vi.hoisted` api mock.
- Added `describe("App — mode switch")` with one test: verifies the rendered "Supervised" button has `aria-pressed="true"` on mount (from `getSettings`), and that clicking "Automated" calls `api.setMode("automated")`.

### `src/renderer/src/App.tsx`
- Added `OperatingMode` type and `MODE_LABEL` label map above the component.
- Added `mode` state (`useState<OperatingMode>("supervised")`).
- Extended the mount `useEffect` to:
  - Call `api.getSettings()` on mount and set the initial mode.
  - Subscribe via `api.onModeChanged` (callback cast `string → OperatingMode`).
  - Clean up `offMode()` alongside existing `off1()` / `off2()`.
- Inserted the segmented control `<div className="mode-switch" role="group" aria-label="Operating mode">` with three `<button className="mode-seg" aria-pressed={mode === m}>` elements, placed after `.tagline` and before `.poll-btn`.
- No optimistic local flip on click — only calls `api.setMode(m)`; the broadcast updates the UI.

### `src/renderer/src/styles.css`
- Removed `margin-left: auto` from `.poll-btn` (moved to `.mode-switch`).
- Added `.mode-switch`, `.mode-seg`, `.mode-seg + .mode-seg`, `.mode-seg:hover`, `.mode-seg[aria-pressed="true"]` rules immediately before the `/* ---- Two-pane layout ---- */` comment.

## TDD evidence

**RED** (before implementation):
```
❯ test/renderer/app.test.tsx (4 tests | 1 failed)
  × App — mode switch > reflects the loaded mode and calls api.setMode on click
    → Unable to find role="button" and name "Supervised"
```

**GREEN** (after implementation):
```
✓ test/renderer/app.test.tsx (4 tests) 70ms
```

## Full suite + typecheck

```
pnpm typecheck   → clean (no errors)
make test        → 19 test files, 191 tests, all passed
```

One minor adjustment from the brief: the `onModeChanged` callback type in `api.ts` (from Task 4) is `(m: string) => void`, so the App's callback was written as `(m: string) => setMode(m as OperatingMode)` instead of the brief's `(m: OperatingMode) => setMode(m)`. This avoids a TS2345 incompatibility and is semantically equivalent.

## Files changed

- `src/renderer/src/App.tsx`
- `src/renderer/src/styles.css`
- `test/renderer/app.test.tsx`

## Commit

`9594bc3  feat: main-window operating-mode segmented control`

## Concerns

None. The only deviation from the brief was narrowing the callback parameter type to avoid a TypeScript error — functionally identical, all tests pass.

---

## Review Fix — 2026-06-30

Two issues found by code review, both fixed in one commit.

### Fix 1 (Important) — strengthen initial-mode test

**File:** `test/renderer/app.test.tsx`, `describe("App — mode switch")` test.

**Problem:** the test previously mocked `api.getSettings` returning `{ operatingMode: "supervised" }`, which is the same as the `useState` default. The "Supervised is aria-pressed" assertion therefore passed from the default alone — the `api.getSettings()` load was never actually exercised.

**Change:** mock now resolves `{ operatingMode: "disabled" }` (differs from default). Assertions updated to:
- `await waitFor(() => expect(screen.getByRole("button", { name: "Disabled" })).toHaveAttribute("aria-pressed", "true"))` — can only pass if the loaded value drove state.
- `expect(screen.getByRole("button", { name: "Supervised" })).toHaveAttribute("aria-pressed", "false")` — confirms Supervised is NOT pressed.
- `fireEvent.click(screen.getByRole("button", { name: "Automated" }))` + `await waitFor(() => expect(api.setMode).toHaveBeenCalledWith("automated"))` — click path unchanged.

### Fix 2 (Minor) — guard getSettings against rejected promise

**File:** `src/renderer/src/App.tsx`, mount `useEffect`.

**Change:** chained `.catch((e) => console.error("[getSettings]", e))` onto the `api.getSettings()` promise so a rejected call (corrupted settings / IPC error on startup) does not produce an unhandled rejection.

### Covering test result

```
npx vitest run test/renderer/app.test.tsx

 ✓ test/renderer/app.test.tsx (4 tests) 73ms
 Test Files  1 passed (1) | Tests  4 passed (4)
```

### Typecheck result

```
pnpm typecheck → clean (no errors)
```

### Commit

See commit following this section.
