# Checking out the PR branch locally

A review reads far better off a real working tree than off a raw diff: you can
open the changed files *and* their callers, jump around with code-aware tools, and
even build / lint / test the change. So before reviewing, get the PR's head branch
checked out — **but only when it's safe and makes sense**, and never switch the
user's branch without asking.

Derive `<host>`, `<owner>`, `<repo>`, and `<number>` from the PR URL. Every `gh`
call must be pinned to `<host>` via `--hostname <host>` or `GH_HOST=<host>`.

## What you need from the PR metadata

The `gh pr view` you run for context already carries the checkout inputs — fetch
these fields:

```bash
GH_HOST=<host> gh pr view <number> --repo <host>/<owner>/<repo> \
  --json headRefName,headRefOid,baseRefName,isCrossRepository,headRepositoryOwner,headRepository
```

- **`headRefName`** — the PR's source branch, e.g. `feature/add-retry-logic`.
  This is the branch you want checked out. ("Already on the right branch" means
  the current branch equals this, *not* the base branch.)
- **`isCrossRepository`** — `true` when the PR comes from a fork.
- **`headRepositoryOwner.login`** — the fork owner's username. This is the name
  to give the fork's git remote.
- **`headRepository.name`** — the repo name on the fork (normally identical to
  `<repo>`).

## The decision tree

```
Are we inside a clone of THIS repo?
  └─ no  → skip checkout, review remotely (see "Remote fallback"). Tell the user.
  └─ yes →
       Is the current branch already headRefName?
         └─ yes → no checkout needed. Optionally fetch latest. Proceed to review.
         └─ no  → ASK the user: "Check out <headRefName> before reviewing?"
                    └─ user says no → review remotely. Tell the user.
                    └─ user says yes →
                         Working tree dirty?  → surface it, let the user
                                                 stash/commit/abort. Don't clobber.
                         Cross-repository (fork)?
                           └─ yes → fork remote registered? → if not, OFFER to add
                                     it, confirm, run it. Then fetch + checkout.
                           └─ no  → fetch origin + checkout.
```

### Are we in the right repo?

Match by repo **name + host**, not by owner — your `origin` might be your own fork
of the upstream, so requiring `origin == <owner>` would wrongly reject a valid
clone.

```bash
git rev-parse --is-inside-work-tree 2>/dev/null   # are we in a git repo at all?
git remote get-url origin                          # inspect host + repo name
```

If `origin`'s URL host is `<host>` and its repo name is `<repo>`, you're in the
right clone. If not (different repo, or not a git repo), skip the checkout flow
and review remotely.

### Already on the branch

```bash
git branch --show-current
```

If this equals `headRefName`, you're set — just proceed. You may `git fetch` the
branch's remote to make sure you're at the latest commit, but don't reset or pull
over the user's local state without asking.

### Dirty working tree

Switching branches with uncommitted changes can fail or carry changes across, so
check first and never force:

```bash
git status --porcelain
```

If it prints anything, stop and tell the user what's uncommitted. Let them decide
(stash, commit, or skip the checkout and review remotely). Don't auto-stash or
`checkout -f`.

## Fork PR: register the remote (after confirming), then check out

The remote is named after the fork owner. First see whether it already exists:

```bash
git remote   # is <headRepositoryOwner.login> already here?
```

If it's missing, **offer** to add it — show the exact command, get a yes, then run
it. Adding a remote is local and reversible, but it still mutates the user's git
config, so it's gated on their confirmation:

```bash
# Mirror origin's protocol. If origin is SSH (git@<host>:...), use SSH:
git remote add <fork_owner> git@<host>:<fork_owner>/<repo>.git
# If origin is HTTPS (https://<host>/...), use HTTPS instead:
git remote add <fork_owner> https://<host>/<fork_owner>/<repo>.git
```

Check `git remote get-url origin` to see which protocol to mirror. If the user
declines to add the remote, fall back to a remote review.

Then fetch just that branch and check it out as a tracking branch:

```bash
git fetch <fork_owner> <headRefName>
git checkout -t <fork_owner>/<headRefName>
```

If a local branch of that name already exists, check it out and fast-forward
instead of `-t`:

```bash
git checkout <headRefName>
git pull --ff-only <fork_owner> <headRefName>
```

## Same-repo PR: just fetch origin and check out

When `isCrossRepository` is `false`, the branch lives on `origin` — no remote to
register:

```bash
git fetch origin <headRefName>
git checkout <headRefName>        # tracks origin/<headRefName>
# or, if no local branch yet:  git checkout -t origin/<headRefName>
```

## Remote fallback (no local checkout)

When you skip the checkout — wrong repo, not a git repo, the user declined, or a
dirty tree they didn't want to disturb — review the way the skill does without a
working tree: `gh pr diff` for the diff and `gh api` to read individual files at
the head ref. The review still works; you just lose the convenience of local
navigation. Say plainly that you're reviewing without a local checkout so the user
knows the surrounding-code reading came from `gh api`, not their working tree.

## Worked example

PR `https://github.com/<owner>/<repo>/pull/42`, from
`alice:feature/add-retry-logic`, current branch `main`:

```bash
# in the <repo> clone, on main
git branch --show-current                       # main ≠ feature/add-retry-logic → ask
# user approves checkout; tree is clean; it's a fork; no `alice` remote yet
#   → offer the remote-add, user confirms:
git remote add alice git@github.com:alice/<repo>.git
git fetch alice feature/add-retry-logic
git checkout -t alice/feature/add-retry-logic
# now review off the working tree
```
