---
name: review-pr
description: >-
  Review a GitHub pull request given its URL, and post the review as inline
  comments. Findings are sorted into four priorities — Critical, Major, Minor,
  Nit — and every posted comment is tagged with its priority (e.g.
  "**[Critical]**"); comments are written in the language requested by the
  caller (default: English). The skill ALWAYS shows the full list of proposed
  findings first and loops on the user's feedback; it never writes a single
  comment to the PR until the user explicitly approves. On approval it submits
  new findings as one batched, neutral COMMENT review; the only time it Approves
  is a genuinely clean PR with zero findings, posted as "LGTM :+1:" (it never
  Requests changes). It also handles RE-REVIEW: when you re-run it on a PR where
  the author has since replied to or fixed your earlier review threads, it
  verifies each fix against the code and — after approval — posts a confirm reply
  and resolves the thread when the fix is correct, or posts a follow-up reply
  (still priority-tagged) when it isn't, while also fresh-scanning new commits
  for new issues. Use this skill whenever the user wants to review a pull
  request, re-review or re-check a PR after the author responded, verify that
  review feedback was addressed, pastes a GitHub PR link and asks for a review,
  or says things like "review this PR", "re-review this PR", "check if the fixes
  are in", "leave inline review comments on this PR", or "verify whether the
  author addressed my feedback". Even if they don't say the word "skill", a PR
  link plus a request to review, re-review, or verify fixes should trigger this.
---

# Review PR

Given a pull request URL, produce a thorough, prioritized code review and — only
after the user approves — post it as inline comments. On a re-run, also verify
how the author responded to your earlier comments and either confirm-and-resolve
or follow up.

The guiding principle: **a review is a proposal, not an action.** You gather and
sharpen findings collaboratively with the user, and the user decides what
actually lands on the PR. The author on the other end is a teammate whose time
and morale matter, so every comment must earn its place: be specific, point at a
line, explain *why* it matters, and where possible suggest the fix.

## Two modes, decided per run, not by the user telling you

Every run starts the same way: you read the PR's existing review threads (step 2).
What you find determines the shape of the review:

- **First review** — no prior review threads of yours on this PR. You do a normal
  fresh review across dimensions and propose inline comments.
- **Re-review** — there are unresolved threads *you* opened earlier, and the
  author has since replied and/or pushed commits. Now you do **two tracks in one
  pass**: (1) *verify* — check whether each of your earlier points was actually
  addressed, and (2) *fresh-scan* — review the new commits since your last review
  for any new issues. You present both together and the user approves once.

You don't ask the user which mode to run — you detect it from the threads. (If the
user explicitly says "just verify, don't look for new stuff," honor that.)

## Language: narrate in English, comment in the requested language

Talk to the *user* in English — your narration, the overall take, the summary
counts, your questions, everything you say in the conversation.

The language for **content destined for the PR** (comment bodies, reply bodies)
is determined by the caller. If the caller does not specify a language, default
to English. So in the presentation (step 7) the structure and labels are English,
but each finding's quoted comment text is in the requested language — that quoted
text is the literal string that gets posted, so the user is reviewing the real
wording while you discuss it with them in English. The overall take and the
per-priority counts live only in that English presentation; they are *not* posted
to the PR.

## Priority labels go *in* the posted comment

Every posted finding leads with its priority as a bold bracketed English label so
the author can triage at a glance:

- `**[Critical]**`, `**[Major]**`, `**[Minor]**`, `**[Nit]**` — then a space,
  then the comment body (in the requested language).

This is the one piece of priority information that *does* go to the PR (the counts
and overall take still don't). The same applies to a follow-up reply in a
re-review when a fix wasn't right — it carries the priority of the still-open
issue. A confirm-and-resolve reply is not a finding, so it has no priority label.

## Hard rule: never post or resolve without explicit approval

You MUST present the full proposal — new findings, verify verdicts, and which
threads you'd resolve — and get the user's explicit "yes, post it" (or "APPROVE",
"post it", "go ahead") before running anything that writes to the PR. Posting a
review, posting a reply, and resolving a thread are all outward-facing actions
against a shared repo that ping a real teammate — there is no undo that un-sends
the notification, and resolving changes the thread's state for everyone.

- "looks good" about *one* finding is not approval to post the whole batch.
- Editing or trimming findings, flipping a verify verdict, or dropping a resolve
  is part of the loop, not approval — re-show the revised proposal and ask again.
- If you are even slightly unsure whether the user meant "post it now," ask.

The only thing that ends the loop is the user clearly approving the current
proposal.

## Pin every `gh` call to the PR's host

Derive `<host>` from the PR URL (everything between `https://` and the first `/`
of the path). You may be authenticated to more than one GitHub host, so an
unpinned `gh` call could silently resolve against the wrong host. Always pin:

- `gh api --hostname <host> ...`
- `gh pr ... --repo <host>/<owner>/<repo>` (or `GH_HOST=<host> gh pr ...`)
- `gh api graphql --hostname <host> ...`

For example, given `https://github.com/<owner>/<repo>/pull/42`, `<host>` is
`github.com`. Given `https://github.example.com/<owner>/<repo>/pull/7`,
`<host>` is `github.example.com`.

## Workflow

### 1. Parse the PR link

The user gives a URL like `https://github.com/<owner>/<repo>/pull/42`.

Extract four things from it:

- **host** → `github.com` (everything between `https://` and the first `/`)
- **owner** → the repository owner or organization
- **repo** → the repository name
- **number** → the pull request number

You'll pass `--repo <host>/<owner>/<repo>` to `gh` so it targets the correct host
regardless of the current working directory. If the user gives a bare number
instead of a URL and you're inside the repo, use the local repo's `origin` to
resolve owner/repo.

### 2. Check out the PR branch, then gather context and detect prior threads

#### Get the code locally first

A review reads far better off a real working tree than a raw diff — you can open
the changed files *and* the callers around them, navigate with code-aware tools,
and build/lint/test the change. So when you're sitting in a clone of the PR's
repo, try to get its head branch checked out before reviewing. PRs from forks
often mean registering the fork as a named git remote and checking out a tracking
branch.

**Never switch the user's branch on your own — checking out is their call.** Walk
this decision tree:

- **Not in a clone of this repo** (wrong repo, or not a git repo at all) → skip
  the checkout entirely and review remotely (`gh pr diff` + `gh api`). Tell the
  user you're reviewing without a local checkout.
- **Already on the PR's head branch** (`headRefName`, the *source* branch — not
  the base) → nothing to do; proceed to review.
- **In the repo but on another branch** → **ask the user whether to check out
  `<headRefName>` before reviewing.** They may be mid-task and not want their
  branch switched — that's fine, and a "no" just means you review remotely. Only
  on a "yes" do you check out.
  - If it's a **fork PR and that fork's remote isn't registered**, *offer* to add
    it (show the `git remote add` command, get a yes, then run it) — it mutates
    their git config, so it's gated on confirmation.
  - If the **working tree is dirty**, surface that and let the user stash/decide
    rather than clobbering their changes.

The exact commands — fork-URL derivation, the dirty-tree guard, fork vs. same-repo
checkout, and the remote fallback — are in `references/checkout.md`. The
`gh pr view` below already fetches the fields the checkout needs
(`headRefName`, `isCrossRepository`, `headRepositoryOwner`), so run it first and
reuse it.

#### Gather context

A good review needs more than the raw diff. Run these (independent calls can be
batched):

- PR metadata — title, body, author, base, head sha, state, plus the fields the
  checkout above needs (`headRefName`, `isCrossRepository`, `headRepositoryOwner`):
  `gh pr view <number> --repo <host>/<owner>/<repo> --json title,body,author,baseRefName,headRefName,headRefOid,state,additions,deletions,files,isCrossRepository,headRepositoryOwner,headRepository`
- The diff: `gh pr diff <number> --repo <host>/<owner>/<repo>`
- **Existing review threads** — read them now to decide first-review vs.
  re-review, and to know who *you* are. Get your own login
  (`gh api --hostname <host> /user --jq .login`) and the PR's review threads via
  the GraphQL query in `references/verify.md`. A thread is yours to verify when
  its **first** comment's author is you, it is **unresolved**, and the author has
  since replied or pushed commits. If there are any such threads, this run has a
  **verify track** (step 3); otherwise it's a plain first review.

Then deepen your understanding before judging:

- **Read the PR description and any linked issue or ticket.** The diff tells you
  *what* changed; the description and ticket tell you *what it was supposed to
  do*. A change can be flawless code yet not match its intent — you can only catch
  that if you know the intent. If the title or body references a ticket key or
  issue link, follow it if you have access.
- **Read surrounding code, not just the diff hunks.** A changed function often
  only makes sense alongside its callers, the types it touches, and the existing
  conventions of the file. If you checked the branch out above, read the actual
  files in the working tree for full context. If you didn't (remote review), fetch
  what you need via `gh api` at the head ref. Reviews that only look at the
  `+`/`-` lines miss the bugs that live in the interaction between changed and
  unchanged code.

### 3. Verify the author's responses (re-review track only)

Skip this step entirely on a first review. When there are prior threads of yours,
go through each one and judge honestly whether your point was addressed. To do
that well you need to see *what actually changed since you commented*, not just
the author's words — read the current state of the code the thread points at, and
look at the commits the author pushed after your review.

For each prior thread, land on one verdict:

- **Fixed correctly → confirm + resolve.** The author made the change (or gave an
  explanation that genuinely holds) and the issue is gone. You'll post a short
  confirm reply (in the requested language) and resolve the thread.
- **Not fixed / incorrect / partial → follow up.** The fix misses the point, only
  half-addresses it, introduces a new problem, or the author's explanation doesn't
  hold up against the code. You'll post a follow-up reply (in the requested
  language) that says concretely what's still wrong — and because the issue is
  still open, it carries a priority label (re-evaluate the severity; it may have
  changed).
- **Needs the user's call.** The author pushed back with a legitimate tradeoff or
  something only the user knows. Surface it as a question rather than silently
  deciding to resolve or re-open.

Be fair in both directions: resolve generously when the author clearly did the
work, but don't rubber-stamp a fix that doesn't actually solve the problem just to
close the thread.

### 4. Review the changes across dimensions

Look for real problems, in roughly this order of importance. Don't pad the review
to hit every category — only raise what's actually there. On a re-review, weight
your attention toward the **new commits since your last review**, and don't
re-raise something an existing thread already covers — that belongs in the verify
track, not as a new finding.

- **Correctness** — logic errors, off-by-one, wrong conditionals, nil/null
  dereferences, unhandled error returns, race conditions, resource leaks
  (unclosed bodies/files/connections), incorrect handling of the change's own
  stated goal.
- **Security & data safety** — injection, missing authz/authn checks, secrets in
  code, unsafe deserialization, PII leakage into logs, data loss on the failure
  path.
- **Edge cases & error handling** — empty/nil inputs, boundary values, partial
  failures, retries/idempotency, what happens when the happy path doesn't happen.
- **API & contract changes** — backward compatibility, breaking changes to
  exported signatures or wire formats, migration concerns.
- **Tests** — does new behavior have coverage? Do the tests actually assert the
  thing that changed, or just pass trivially?
- **Readability & maintainability** — naming, dead code, needless complexity,
  duplicated logic, misleading comments.
- **Consistency** — does this match the conventions already in the codebase
  (error wrapping style, logging, naming, layering)? Inconsistency is usually a
  Minor/Nit, but flag it.

### 5. Classify each finding by priority

Use exactly these four levels. The priority answers "what should the author do?"
and becomes the bracketed label on the posted comment.

| Priority     | Label            | Meaning                                                                 |
|--------------|------------------|-------------------------------------------------------------------------|
| **Critical** | `**[Critical]**` | Blocks merge. Bugs, security holes, data loss, broken behavior. Must fix.|
| **Major**    | `**[Major]**`    | Should fix before merge. Real problems that aren't strictly blocking — missing error handling, absent test for risky logic, a meaningful edge case. |
| **Minor**    | `**[Minor]**`    | Worth fixing but optional. Readability, small refactors, mild inconsistency.|
| **Nit**      | `**[Nit]**`      | Trivial / stylistic. Naming, formatting, a typo. |

Be honest about severity — inflating a Nit to Major erodes the author's trust in
your reviews; downplaying a real bug is worse. If you genuinely found nothing
that needs changing, say so rather than inventing Nits — a clean PR is a real
outcome. In that case the review becomes a simple approval: propose posting
`LGTM :+1:` (see step 8), still subject to the same explicit-approval rule.

### 6. Write each finding / reply as a draft comment

For every finding, prepare what will actually be posted:

- **path** and **line** — the file and the line in the PR's *new* version the
  comment anchors to (see `references/posting.md` for the line/side rules; getting
  this right is what lets the comment land inline instead of in a wall of text).
- **comment body** (field: `body`), in the requested language, prefixed with the
  priority label. Lead with `**[Critical]**` / `**[Major]**` / `**[Minor]**` /
  `**[Nit]**`, then a space, then terse, concrete text: state the problem, say why
  it matters, and propose a fix. One issue per comment.
- **phrase fixes as suggestions, not orders.** The author is a peer, and a review
  reads better as "what if we…" than "do this." Prefer a questioning, indirect
  form that invites a conversation — for example, "Would it be safer to add X
  here?" or "Might renaming this to Y make the intent clearer?" — over flat
  imperatives. The softer framing leaves room for the author to push back if
  you've misread the code. This isn't about hedging the *finding* — be clear that
  something is wrong when it is (especially for Critical issues) — it's about the
  *fix* being an offer.
- **a suggestion block when a concrete code fix fits** — GitHub renders a
  ` ```suggestion ` block as a one-click "commit this" button, which is the
  highest-leverage thing a reviewer can offer. Use it whenever you can write the
  exact replacement lines.

Comment body examples (English; adapt tone to the requested language):

> **[Critical]** The response body is never closed, which will leak connections
> on every request. Would it be safer to add `defer resp.Body.Close()` right
> after the successful call, so it fires on all paths including early returns?

> **[Nit]** `cnt` is a bit terse — would `retryCount` make the intent clearer?

For the **verify track** (re-review), prepare the reply text (`replyBody`) for
each prior thread:

- **Fixed correctly → confirm reply.** Short and factual, no priority label, no
  gush. The thread is about to be resolved; the reply just acknowledges it.
  e.g. "Fix confirmed, thanks."
- **Not fixed / incorrect → follow-up reply.** Carries the (re-evaluated) priority
  label, then concretely what's still wrong and what would address it. Same
  suggestion-not-order tone as a fresh finding.
  e.g. "**[Major]** The `defer` you added doesn't fire on the early return at
  line 42 — the call to `resp.Body.Close()` is only reached by the happy path.
  Moving the defer to just after the successful request would cover all paths."

Keep the tone short and factual, not effusive — one acknowledgement is enough, no
exclamation marks or padded pleasantries.

### 7. Present everything and loop on feedback

Show the user the full proposal in one place. On a first review this is just the
findings; on a re-review it's the verify verdicts *and* any new findings. Number
items so the user can refer to them ("drop #3", "soften #5", "actually #2's fix is
fine, resolve it"), and include the location and the actual draft comment text for
each — the user is approving the *exact words* that will be posted, so don't
summarize them away.

Use this structure:

```
## Review draft — <owner>/<repo> #<number>: <PR title>   (re-review)

**Overall:** <1–2 line take: what changed since last time / headline concern>
**Verify:** <n> resolve · <n> follow-up · <n> needs-your-call     (omit on first review)
**New findings:** Critical <n> · Major <n> · Minor <n> · Nit <n>

### Verify — your earlier threads        (omit this whole block on first review)
**V1 — resolve · `path/to/file.go:142`**
> author replied: "<quoted>"  / pushed `<sha>`
**Verdict:** <English: why it's correctly fixed>
**Confirm reply:** "Fix confirmed, thanks."

**V2 — follow-up · `path/to/other.go:30`**
> author replied: "<quoted>"
**Verdict:** <English: why it's still open>
**Reply:** "**[Major]** <draft follow-up>"

### New findings
**#1 — `path/to/file.go:88`**
> **[Critical]** <draft comment, including any ```suggestion block>
…
```

Then ask plainly: anything to change, or should I post it? Take the feedback
("remove the nits", "this isn't actually a bug because …", "merge #2 and #4",
"make #1 less harsh", "don't resolve V2, follow up instead"), apply it, and
**re-show the full revised proposal**. The user may also teach you something that
invalidates a finding or flips a verdict — accept that gracefully.

If there is **nothing to post** — a first review with no findings, or a re-review
where every thread *of yours* is correctly fixed and the new commits are clean —
present that as its own outcome: a one-line take and a proposal to approve with
`LGTM :+1:` (plus resolving the verified threads, on a re-review). Other
reviewers' still-open threads don't change this outcome; note them as context but
don't let them downgrade your proposal from "approve" to "wait." Feedback can
still flow the other way — the user might point at something you missed.

Loop here until the user explicitly approves. Do not post or resolve in this step.

### 8. Post — only after explicit approval

Once approved, perform the posting actions. On a re-review there can be up to
three kinds; do each that applies:

1. **New findings** → submit everything as **one** review with `event: COMMENT`
   (never `REQUEST_CHANGES` — the change-or-not verdict stays with humans). All
   inline comments go in that single submission, so the author gets one
   notification. The review `body` stays empty (priority labels live inside each
   comment, not in a summary). See `references/posting.md`.
2. **Follow-up replies** (incorrect fixes) → post *in the thread* against the
   original comment, so it threads under your earlier comment instead of starting
   a new top-level one. See `references/verify.md`.
3. **Confirm + resolve** (correct fixes) → post the short confirm reply in the
   thread, then resolve the thread with the `resolveReviewThread` mutation. See
   `references/verify.md`. Resolving is *your* call as the reviewer — that's why
   this skill resolves and the author-side skill never does.

When the whole thing is clean (a first review with zero findings, and the user
approved), submit a single `event: APPROVE` review whose body is `LGTM :+1:`. This
is the **only** path that approves — the moment there is even one finding, it's a
`COMMENT` review. On a re-review where everything verified clean and there are no
new findings, resolving the threads is the substantive action; propose an LGTM
approve too once the user is on board.

Scope "clean" to *your own* work, not the whole PR. Your approval is your
individual sign-off — it says the things *you* raised are addressed and you found
nothing else, not that every reviewer is satisfied. So once all of your threads
are resolved and you have no open findings, approving is the right call **even if
other teammates still have open threads**: those threads are theirs to resolve,
each reviewer owns their own approval, and the platform won't merge on your
approval alone anyway. Don't withhold your approval as a stand-in for someone
else's review — it just leaves your verdict ambiguous without actually protecting
the PR. Do still surface any unresolved threads from others to the user as
context, so nothing gets lost before merge — but as an FYI, not a reason to hold
back.

Follow `references/posting.md` for the COMMENT/APPROVE review call and the
line/side mapping, and `references/verify.md` for reading threads, in-thread
replies, and the resolve mutation. After posting, report the review URL (or the PR
URL) and say which threads you resolved, so the user can see it landed. Then run
step 9 to keep yourself in the review queue when findings are still open.

If any individual inline comment can't be anchored to a line in the diff (the API
rejects lines outside the changed hunks), don't fail the whole review — fold that
point into the otherwise-empty review body instead and tell the user you did so.
That fallback is the only thing that ever goes in the body.

### 9. Re-request review for yourself when findings remain

GitHub removes you from the PR's *requested reviewers* the moment you submit a
review — so the PR drops out of your "review requested" queue even though you're
expecting to come back and check the author's fixes. When your review leaves
something open, re-add yourself as a requested reviewer so the PR stays in your
queue (and so a fresh re-request surfaces when the author responds):

```bash
gh api --hostname <host> \
  --method POST \
  /repos/<owner>/<repo>/pulls/<number>/requested_reviewers \
  -f "reviewers[]=<your-login>"
```

`<your-login>` is the login you already fetched in step 2
(`gh api --hostname <host> /user --jq .login`).

**When to do it** — only when findings remain, i.e. you just posted a
`COMMENT` review with findings, or a re-review that left follow-up or
needs-your-call threads open. In those cases you intend to come back and verify,
so staying queued is the point.

**When to skip it** — a clean `LGTM :+1:` approve (a first review with zero
findings, or a re-review where every thread verified clean and you approved).
You're done with the PR, so there's no reason to re-queue yourself.

This is a **self-only state change** — it re-queues *you* and doesn't ping the
author or other reviewers — so unlike posting/resolving it doesn't need its own
approval gate. Just do it as the last posting action and tell the user you
re-requested yourself so the PR stays in their queue. If the call errors (e.g.
you're somehow the PR author, who can't be a reviewer), don't fail the run —
report that it didn't apply and move on.
