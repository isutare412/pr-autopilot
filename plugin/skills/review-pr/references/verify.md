# Re-review mechanics: read threads, reply in-thread, resolve

This file covers the **re-review track** — verifying how the author responded to
your earlier review comments, then (after approval) posting in-thread replies and
resolving threads. For the batched COMMENT/APPROVE review of *new* findings, see
`posting.md`.

Derive `<host>`, `<owner>`, `<repo>`, and `<number>` from the PR URL. Every `gh`
call must be pinned to `<host>` via `--hostname <host>` or `GH_HOST=<host>`.

## Who am I? (which threads are mine to verify)

You verify the threads *you* opened. Get your own login once:

```bash
gh api --hostname <host> /user --jq .login
```

A thread is yours to verify when its **first** comment's author equals this login,
the thread is **unresolved**, and there's activity after it (an author reply, or
commits pushed since you commented).

## Reading the review threads (GraphQL)

REST exposes review comments but not the thread's resolved state or the node `id`
you need to resolve it — so use GraphQL. The thread `id` is the **node id** for
the resolve mutation; the first comment's `databaseId` is the REST id you reply
against.

```bash
gh api graphql --hostname <host> \
  -f owner='<owner>' -f repo='<repo>' -F number=<number> \
  -f query='
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      reviewThreads(first:100){
        nodes{
          id
          isResolved
          isOutdated
          comments(first:50){
            nodes{
              databaseId
              author{ login }
              body
              path
              line
              originalLine
              diffHunk
              createdAt
            }
          }
        }
      }
    }
  }
}'
```

For each thread:

- Keep `isResolved == false` and first comment authored by you.
- The whole `comments.nodes` array is the conversation, in order — read the
  author's later replies to understand how they responded.
- `path` + `line` (or `originalLine` when outdated) tells you where the thread
  points so you can read the real code there now.
- The first comment's `databaseId` is the **reply target**; the thread-level `id`
  is the **resolve target**.

To see what the author actually changed since you commented, look at the commits
pushed after your comment's `createdAt`:

```bash
gh pr view <number> --repo <host>/<owner>/<repo> --json commits \
  --jq '.commits[] | {oid: .oid[0:8], date: .committedDate, msg: .messageHeadline}'
```

and read the current state of the file the thread points at (at the head ref) —
not just the diff hunk. A reply written from the hunk alone is how you "confirm" a
fix that didn't actually land, or re-open something that's fine.

## Replying in a thread (follow-up or confirm)

Reply *in the thread* (not a new top-level comment) by posting against the first
comment's REST `databaseId`. For multi-line or non-ASCII bodies, pass the content
via a file rather than inlining it on the command line:

```bash
# body in /tmp/review-reply-<id>.txt
gh api --hostname <host> \
  --method POST \
  /repos/<owner>/<repo>/pulls/<number>/comments/<first_comment_databaseId>/replies \
  -F body=@/tmp/review-reply-<id>.txt
```

- **Follow-up** (fix was wrong/incomplete): the `replyBody` starts with the
  re-evaluated priority label, e.g. `**[Major]** The defer you added doesn't fire
  on the early return at line 42 — the call only runs on the happy path. Moving
  the defer to just after the successful request would cover all paths.`
- **Confirm** (fix is correct): a short, plain `replyBody` with no priority label,
  e.g. `Fix confirmed, thanks.` — then resolve the thread (below).

Never inline a multi-line body directly on the command line — write it to a temp
file first.

## Resolving a thread

Only after the confirm reply is posted, resolve the thread with its node `id`:

```bash
gh api graphql --hostname <host> \
  -f threadId='<thread node id>' \
  -f query='
mutation($threadId:ID!){
  resolveReviewThread(input:{threadId:$threadId}){
    thread{ id isResolved }
  }
}'
```

Resolving is the **reviewer's** prerogative — that's why this skill resolves and
the author-side skill never does. Only resolve threads the approved proposal marked
as correctly fixed; leave follow-up threads and needs-your-call threads open.

## Ordering and notifications

For a clean re-review, post in this order so the conversation reads naturally and
the author isn't spammed:

1. Post all in-thread replies (confirms and follow-ups).
2. Resolve the threads you confirmed.
3. Submit the single batched COMMENT review for any new findings (see
   `posting.md`).

Each in-thread reply and the batched review are separate notifications — that's
inherent to the different actions; batching the new findings into one review keeps
it to the minimum.

## Verify it landed

After posting, surface to the user: which threads you replied to, which you
resolved (with confirmation `isResolved: true` from the mutation response), and the
new review's `html_url` if there were new findings. If a call errors, fix it and
retry that one action — don't double-post.
