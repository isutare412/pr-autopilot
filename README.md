# PR Autopilot

PR Autopilot is a native macOS menu-bar app that drafts AI code reviews for your
review-requested pull requests and lets you approve, edit, and post them. It polls
GitHub in the background, generates a structured and prioritized review using
Claude Code and a bundled skill, and surfaces it in a review window where you
refine findings and give explicit approval before a single comment is posted to the
PR. PR Autopilot replaces a localhost web-server workflow with a locally installed
`.app` that requires no daemon, no browser, and no always-on service — just a
standard macOS menu-bar icon.

---

## Prerequisites

- **`gh`** authenticated to the GitHub host you use
  (`gh auth login --hostname <host>` if not already done)
- **`claude`** CLI authenticated (`claude` must be on your PATH and signed in)
- **Node.js >= 20** (required for the generation subprocess)
- **pnpm 11** — the project's package manager (pinned via the `packageManager`
  field in `package.json`; run `corepack enable` to use the exact pinned version,
  or install pnpm yourself)

---

## Install

```bash
make install
```

This builds the app, packages it, and copies `PR Autopilot.app` into
`/Applications`. Because the app is unsigned, macOS will refuse to open it on the
first launch via double-click. Instead:

1. In Finder, navigate to `/Applications`.
2. **Right-click** `PR Autopilot.app` and choose **Open**.
3. Click **Open** in the Gatekeeper prompt.

From that point the app opens normally. It lives in the menu bar (no Dock icon).

---

## First-run setup

Open **Preferences** from the menu-bar icon or press `Cmd+,`. Set:

| Setting | What it does |
|---|---|
| **GitHub host** | The hostname of your GitHub instance (default: `github.com`). Use your enterprise hostname if applicable. |
| **Comment language** | Language for comments posted to PRs — **English**, **Korean**, or **Japanese**. |
| **Review effort** | Reasoning effort for each review, **Low** → **Max** (default: **High**). Higher is more thorough but slower. |
| **Poll every (seconds)** | How often to check GitHub for review-requested PRs (default: `600`). |
| **Review concurrency** | How many reviews may generate at once (default: `2`). |
| **Retain reviews (days)** | How long finished reviews are kept before cleanup (default: `30`). |
| **Claude config dir** | Path to your Claude config directory (default: `~/.claude`). Used only for authentication — the app does not write to it. |
| **Claude path** | Full path to the `claude` binary. Leave empty to auto-detect from `PATH`. |
| **Send notifications** | Post a macOS notification when a review needs your attention (default: on). |
| **Launch at login** | Start PR Autopilot automatically when you log in (default: on). |

All settings apply immediately — only changing the **GitHub host** takes effect
after the app restarts.

---

## How reviews run: operating modes

PR Autopilot has three operating modes, switched from the menu-bar icon (the tray
icon changes to reflect the current one):

| Mode | Behavior |
|---|---|
| **Disabled** | Polling is paused — no PRs are fetched and no reviews are generated. |
| **Supervised** *(default)* | Review-requested PRs are fetched and reviewed automatically, but nothing is posted. Each draft waits in the review window for you to refine and approve, and the tray icon marks when a review needs your attention. |
| **Automated** | Reviews are generated and posted without waiting for approval. Switching into this mode the first time asks for an explicit confirmation. |

Regardless of mode, the review-generation subprocess is **read-only** against
GitHub — it can never post, merge, or otherwise mutate a PR. Posting happens only
from the app itself, after your approval (Supervised) or automatically
(Automated). See the guard mechanism in [AGENTS.md](AGENTS.md) for how that is
enforced.

---

## Customizing your review skills

> This is the central customization story of PR Autopilot. Read this section
> carefully if you want to tailor what the AI looks for in every review.

### How the skills system works

The code-review intelligence lives in **skills** — Claude Code skill files that
tell the AI how to analyze a PR. All skills ship **bundled inside the `.app`**;
they are sourced from the `plugin/` directory in this repo and packaged at install
time. There is no separate runtime skills folder and no in-app editor — you edit
the source and reinstall.

The always-on entry point is `plugin/skills/review-pr/SKILL.md`. Every time PR
Autopilot runs a review it invokes the `/pr-autopilot:review-pr` skill. That skill
is your extension hook: you add new skills alongside it and have `review-pr`
delegate to them.

### Skill collision and namespacing

The plugin is loaded with `--plugin-dir` and its entry point is prefixed by the
plugin name: `/pr-autopilot:review-pr`. Claude Code's collision precedence is
enterprise > personal > project > plugin > built-in. Because the entry point is
namespaced, a personal or project skill you happen to name `review-pr` cannot
shadow it — both coexist safely.

### Adding a skill: worked example

Suppose you want every review to include a dedicated security pass. Here is the
full two-step process:

**Step 1 — create the skill file**

```
plugin/skills/security-audit/SKILL.md
```

Minimal content:

```markdown
---
name: security-audit
description: >-
  Focused security analysis of a pull request: injection vulnerabilities,
  authentication and authorization bypass, secrets committed in code, unsafe
  deserialization, PII leakage into logs, and data-loss paths. Called by
  review-pr to augment the standard review.
---

# Security Audit

Perform a focused security pass on the PR diff. Look specifically for:

- Injection (SQL, shell, template, path traversal)
- Missing or bypassable auth checks
- Secrets or credentials in code or config
- Unsafe deserialization or eval-equivalent patterns
- PII written to logs or error messages
- Silent data-loss on failure paths

Emit findings in the same priority format (Critical / Major / Minor / Nit)
as the calling skill. Return them to the caller — do not post independently.
```

**Step 2 — reference it from `review-pr`**

Open `plugin/skills/review-pr/SKILL.md` and add one line inside the review
workflow where you want the security pass to run — for example, just before you
classify findings by priority:

```
For a thorough security pass on the diff, invoke `/pr-autopilot:security-audit`.
```

**Step 3 — apply the change**

```bash
make install
```

`make install` rebuilds the app, repackages the plugin, and copies the new bundle
into `/Applications`. The updated skill takes effect on the next review PR Autopilot
runs. No restart required — the generation subprocess is launched fresh each time.

### Key rules for skill authors

- Keep skills **general** — no company names, no hardcoded hostnames, no
  hardcoded languages. The app injects language from the Preferences setting.
- New skills live in `plugin/skills/<name>/SKILL.md`. Reference materials
  (API call patterns, posting rules) go in `plugin/skills/<name>/references/`.
- `review-pr` is the entry point; it coordinates and delegates. New skills should
  do one focused job and return results to the caller rather than posting directly.
- After every edit: `make install` to rebuild and reinstall.

---

## Build from source

```bash
make deps     # install dependencies
make dev      # run with hot-module reload (development)
make dist     # build and package the macOS .app
make install  # build + package + copy to /Applications
```

Run `make help` for the full list of targets.

---

## License

[MIT](LICENSE) © Redshore
