# AGENTS.md — Contributor and Agent Guidance

This file is the first thing an AI agent or human contributor should read before
working in this repo. It explains the codebase layout, the key conventions, the
reuse boundary from the predecessor project, and how the plugin and guard
mechanisms work.

---

## Repository layout

```
src/
  main/           Electron main process
    core/         Framework-free backend modules (no Electron imports allowed)
      api.ts      gh API wrappers (read-only: fetch PR data, threads, diffs)
      executor.ts posts approved findings to GitHub via IPC-injected gh args
      generator.ts launches the Claude Code subprocess with --plugin-dir
      gh.ts       gh subprocess helpers
      guard.ts    isMutatingGh() — the authoritative mutation classifier
      orchestrator.ts drives the per-PR lifecycle state machine
      poller.ts   polls GitHub for review-requested PRs
      prompt.ts   builds the claude invocation arguments
      queue.ts    bounded async queue
      schema.ts   shared Zod schemas (Language, Priority, PrState, Finding, …)
      store.ts    persistent PR state (userData dir)
    index.ts      Electron app entry
    ipc.ts        IPC handlers bridging main ↔ renderer
    lifecycle.ts  app-level lifecycle (ready, before-quit)
    menu.ts       tray context menu
    notify-electron.ts  macOS notification wrapper
    paths.ts      userData / resource paths (Electron-aware)
    paths-pure.ts platform-path helpers (Electron-free, testable)
    settings.ts   Settings schema + load/save
    tray.ts       Tray construction and update
    windows.ts    BrowserWindow management
  preload/
    index.ts      contextBridge — exposes typed IPC to the renderer
  renderer/
    index.html        main window shell
    preferences.html  preferences window shell
    src/
      App.tsx          main review/queue view
      preferences.tsx  preferences form mount
      api.ts           typed IPC calls from renderer
      types.ts         renderer-side types
      settings.ts      renderer settings helpers
      components/      React components (ActionsBar, Detail, FindingCard, …)

plugin/
  .claude-plugin/
    plugin.json        plugin manifest (name: pr-autopilot, version: 0.1.0)
  skills/
    review-pr/
      SKILL.md         the always-on review entry point
      references/      checkout.md, posting.md, verify.md — reference docs

build/
  bin/
    gh               read-only gh shim (prepended to PATH during generation)
    guard.mjs        parity copy of src/main/core/guard.ts :: isMutatingGh
    guard.d.mts      type declarations for guard.mjs
  guard.settings.json  Claude Code settings injected for the generation subprocess
  entitlements.mac.plist
  trayTemplate.png

test/                  vitest test suite (mirrors src/main/core/ + renderer)
```

---

## Reuse boundary: ported from pr-cockpit

The backend modules in `src/main/core/` are ported from `pr-cockpit` (the
predecessor web-server + launchd daemon). What changed in the port:

- **`server.ts` removed** — the HTTP layer is gone. All communication between the
  main process and the renderer goes through Electron IPC (`ipc.ts` +
  `preload/index.ts` contextBridge).
- **Field renames** — the `pr-cockpit` schema used language-specific suffixes:
  `bodyKo`, `replyBodyKo`, `editedBodyKo`. These are renamed to the neutral
  `body`, `replyBody`, `editedBody` in `src/main/core/schema.ts`.
- **`core/` isolation** — modules inside `src/main/core/` must not import
  Electron. They are pure TypeScript business logic so they can be unit-tested
  without an Electron runtime. Electron-specific concerns (paths, notifications,
  IPC) live in the modules directly under `src/main/`.

---

## The plugin: what it is and why

The code-review skill ships as a **namespaced Claude Code plugin** rather than a
bare skill file. Here is why this matters and how it works.

### Why a plugin (collision precedence)

Claude Code applies skills in priority order:
**enterprise > personal > project > plugin > built-in**

A skill loaded from a plugin is namespaced by the plugin name. The entry point is
`/pr-autopilot:review-pr`, not bare `review-pr`. Because the name is prefixed, a
user's personal or project skill named `review-pr` does **not** shadow the bundled
skill — both coexist. This means PR Autopilot's review skill is always the one it
invokes, regardless of what skills the user has installed.

### How it is loaded

The generator (`src/main/core/generator.ts`) passes `--plugin-dir <path>` to the
`claude` invocation, pointing at the bundled `plugin/` directory inside the `.app`
resources. The entry point `/pr-autopilot:review-pr` is then available for that
subprocess only.

### Plugin structure

```
plugin/
  .claude-plugin/plugin.json    { "name": "pr-autopilot", "version": "0.1.0" }
  skills/review-pr/SKILL.md     the entry-point skill
  skills/review-pr/references/  auxiliary reference docs
```

To add a skill, create `plugin/skills/<name>/SKILL.md` and reference it from
`review-pr/SKILL.md` via `/pr-autopilot:<name>`. Run `make install` to rebuild
and reinstall. See README.md for a worked example.

---

## Conventions

### TDD with vitest

All backend logic in `src/main/core/` is tested in `test/`. Run the suite with:

```bash
make test       # run once
make typecheck  # typecheck main + renderer
```

Tests use vitest. When adding or changing a module in `core/`, write or update the
corresponding test file in `test/`. Renderer component tests live in
`test/renderer/`.

### The read-only generation guard

During the `claude` subprocess that runs the review skill, the app must not allow
the AI to mutate GitHub state (post comments, merge PRs, etc.) — that gate belongs
exclusively to the user's explicit approval in the review window. The guard is
implemented as three cooperating pieces:

1. **`build/guard.settings.json`** — a Claude Code settings file injected via
   `CLAUDE_SETTINGS_PATH` for the generation subprocess. It registers a
   `PreToolUse` hook on `Bash` commands. The hook checks whether the command
   contains a mutating `gh` call (write HTTP methods, write subcommands,
   `mutation`, `/requested_reviewers`, `/replies`) and returns `{"decision":
   "block"}` if so.

2. **`build/bin/gh` shim** — a shell script prepended to `PATH` during generation.
   It delegates the mutation decision to `guard.mjs` and, if the call is mutating,
   exits 97 without invoking the real `gh`. Non-mutating calls pass through to the
   real `gh` found later in `PATH`.

3. **`src/main/core/guard.ts` :: `isMutatingGh()`** — the authoritative TypeScript
   implementation of the mutation classifier. It is the single source of truth for
   what counts as a write operation.

**Parity rule:** `build/bin/guard.mjs` is a standalone copy of `isMutatingGh()`
kept in sync with `src/main/core/guard.ts`. The test file `test/guard-shim.test.ts`
enforces parity between the two. When you change the guard logic in `guard.ts`,
update `guard.mjs` and verify `make test` passes.

### UI work: use the `frontend-design` skill

When making changes to the renderer (`src/renderer/`), invoke the `frontend-design`
skill before writing any new component or reshaping an existing one. It provides
aesthetic direction and helps avoid generic-looking output.

### CLAUDE_CONFIG_DIR

The app accepts a `claudeConfigDir` setting (default: `~/.claude`) and passes it
as `CLAUDE_CONFIG_DIR` to the `claude` subprocess. This variable is used **for
authentication only** — it points Claude at the correct credentials. Do not use it
to inject skills or settings into the generation subprocess; that is the
`--plugin-dir` and `CLAUDE_SETTINGS_PATH` mechanism's job.

---

## Authoring the default skill cleanly

`plugin/skills/review-pr/SKILL.md` (and any skills you add) must remain general:

- No company names, team names, or internal project references.
- No hardcoded GitHub hostnames — the skill derives `<host>` from the PR URL.
- No hardcoded language — the caller (the generator) injects the comment language
  from the user's settings. The skill receives it as a parameter.
- No hardcoded repository allow/deny lists — those live in app settings.

Keep skills focused on the *how* of reviewing, not the *who* or *where*.

---

## Running

```bash
make deps       # install dependencies
make dev        # run with HMR (development; connects to Electron)
make test       # run the vitest suite
make typecheck  # typecheck main + renderer
make build      # compile (no packaging)
make dist       # build + package the macOS .app
make install    # build + package + copy to /Applications
make help       # full target list
```

App data (state, settings) lives in
`~/Library/Application Support/pr-autopilot/`. Logs: `make logs` tails the app
log.
