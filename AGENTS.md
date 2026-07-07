# AGENTS.md — Contributor and Agent Guidance

This file is the first thing an AI agent or human contributor should read before
working in this repo. It explains the codebase layout, the key conventions, the
reuse boundary from the predecessor project, and how the plugin and guard
mechanisms work.

---

## Repository layout

A directory-level map (not every file — browse the tree for specifics):

```
src/
  main/           Electron main process
    core/         Framework-free backend (NO Electron imports) — pure, unit-tested
                  logic. Key modules: api.ts (read-only gh API), executor.ts
                  (posts approved findings), generator.ts (launches the claude
                  subprocess), guard.ts (isMutatingGh mutation classifier),
                  orchestrator.ts (per-PR state machine), poller.ts, prompt.ts,
                  queue.ts, schema.ts (shared Zod types), store.ts (persistent
                  state), plus queueSort.ts / visibility.ts (mirrored in the
                  renderer — see "Core ↔ renderer parity").
    *.ts          Electron glue: index.ts (app entry), ipc.ts, lifecycle.ts,
                  tray.ts, menu.ts, windows.ts, notify-electron.ts, paths.ts /
                  paths-pure.ts, and settings.ts (the observable SettingsStore).
  preload/index.ts   contextBridge — exposes typed IPC to the renderer.
  renderer/       React UI — App.tsx (review/queue view), preferences, and
                  components/ (ActionsBar, Detail, FindingCard, PrefsForm, …).

plugin/           The bundled Claude Code plugin (see "The plugin" below).
build/            Packaging assets: build/bin/ (the read-only gh shim + guard.mjs
                  parity copy), guard.settings.json, entitlements, the app icon,
                  and the menu-bar tray icons — one template per operating-mode
                  state (default / disabled / automated / needs-review, each
                  @1x/@2x + .svg). Regenerate icons with `make icons`.
scripts/          Build helpers (e.g. make-icons.sh, wrapped by `make icons`).
test/             vitest suite, mirrors src/main/core/ + renderer.
docs/             Design notes and plans — gitignored, not shipped.
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

### Package manager: pnpm

The project uses **pnpm 11**, pinned via the `packageManager` field in
`package.json` (Corepack) and an `engines.pnpm` floor. pnpm-specific settings live
in `pnpm-workspace.yaml` (pnpm 11 no longer reads them from `.npmrc` or the
package.json `pnpm` field):

- `nodeLinker: hoisted` — a flat `node_modules`, because electron-builder can't
  follow pnpm's default symlinked layout when packaging the `.app`.
- `allowBuilds: { electron, esbuild }` — pnpm blocks dependency build scripts by
  default; these two need theirs (electron downloads its framework, esbuild
  installs its platform binary). Without them, `build`/`dist`/`test` fail.

Commit `pnpm-lock.yaml`. The Makefile targets wrap pnpm (`make deps` → `pnpm install`).

### TDD with vitest

All backend logic in `src/main/core/` is tested in `test/`. Run the suite with:

```bash
make test       # run once
make typecheck  # typecheck main + renderer
```

Tests use vitest. When adding or changing a module in `core/`, write or update the
corresponding test file in `test/`. Renderer component tests live in
`test/renderer/`.

### Settings, operating modes, and review effort

`src/main/settings.ts` exposes an observable **`SettingsStore`** as the single
source of truth: `get()` returns the current snapshot, `update(patch)` validates
+ persists + notifies subscribers, and `subscribe(fn)` reacts to changes. It
persists **before** committing in memory, so a failed disk write leaves state
unchanged. Settings apply live — only changing the **GitHub host** requires a
restart.

Two settings shape each run:

- **Operating mode** — `disabled` / `supervised` (default) / `automated`, set
  from the menu-bar icon or the main window. `disabled` pauses polling entirely;
  `supervised` drafts reviews and waits for your approval before posting;
  `automated` posts approved-shaped reviews on its own (first switch to it
  requires an explicit confirmation). The mode also drives the tray icon state.
- **Review effort** — `low` → `max`, passed to the generation subprocess as
  `--effort` (default `high`).

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

### Core ↔ renderer parity

Two pure helpers are duplicated so both processes can use them without crossing
the IPC boundary: `queueSort.ts` (queue ordering) and `visibility.ts` (which PRs
are shown) each live in **both** `src/main/core/` and `src/renderer/src/`. Keep
the copies behavior-identical — `test/queueSort-parity.test.ts` pins the two
`sortRows` implementations together, the same idea as the guard parity rule
above. Edit both sides in the same change.

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
