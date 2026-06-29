# Posting the review with `gh api`

This file covers the mechanics of submitting the review **after the user has
approved it**. Do not run any of this before approval.

This file covers the batched **COMMENT / APPROVE review** for *new* findings. For
re-review actions on existing threads — in-thread follow-up replies and the
resolve mutation — see `verify.md` instead.

The whole review goes in a **single** request to the reviews endpoint, so the
author gets one notification with all inline comments at once.

**The review body stays empty.** The posted review is *only* the inline comment
blocks — no overall summary, no per-priority counts, no headline take. The author
wanted exactly the findings on their lines and nothing sitting apart from them.
The priority label is the one piece of priority info that ships — but it lives
*inside* each comment's `body` field (`**[Critical]**` …), not in the review body.
The one exception to the empty body is the unanchorable-finding fallback below: a
point that can't attach to a diff line goes in the `body` rather than being
dropped.

## The call

Build the payload as JSON, write it to a temp file, and POST it. Pass
`--hostname` so it targets the correct host no matter the working directory.

```bash
gh api --hostname <host> \
  --method POST \
  /repos/<owner>/<repo>/pulls/<number>/reviews \
  --input /tmp/review-<number>.json
```

`<host>`, `<owner>`, `<repo>`, `<number>` are the values parsed from the PR URL
in step 1.

## The JSON payload

```json
{
  "commit_id": "<head sha>",
  "event": "COMMENT",
  "body": "",
  "comments": [
    {
      "path": "src/handler.go",
      "line": 142,
      "side": "RIGHT",
      "body": "**[Critical]** The response body is never closed, which will leak connections on every request. Would it be safer to add `defer resp.Body.Close()` right after the successful call, so it fires on all paths including early returns?"
    },
    {
      "path": "src/handler.go",
      "start_line": 30,
      "start_side": "RIGHT",
      "line": 34,
      "side": "RIGHT",
      "body": "**[Minor]** This entire block duplicates the retry logic in `client.go:88` — would extracting it into a shared helper reduce the duplication?"
    }
  ]
}
```

- **`commit_id`** — the PR head sha (`headRefOid` from `gh pr view`). Anchors the
  comments to the exact reviewed commit.
- **`event`** — `COMMENT` when there are findings. The only exception is the
  clean-PR approval case below.
- **`body`** — empty (`""`). No summary, no counts. The only thing that ever goes
  here is an unanchorable finding (see "When a comment can't be anchored").
- **`comments[]`** — one entry per inline finding. Each `body` starts with the
  priority label (`**[Critical]**` / `**[Major]**` / `**[Minor]**` / `**[Nit]**`)
  followed by the comment text in the requested language.

### Generating the JSON safely

Multi-line comment bodies and non-ASCII text will break a hand-typed heredoc.
Build the payload with `jq` (or write each comment body to a file and assemble)
so quoting and newlines are handled correctly. Write the result to the temp file,
then `--input` it. Do not inline a giant `-f body=...` for multi-line text.

## Line and side mapping — the part that actually trips you up

GitHub only accepts inline comments on lines that appear in the diff. Map each
finding like this, reading from the diff hunks (`gh pr diff`):

- **Commenting on an added or unchanged line** (the usual case — you're reviewing
  the new code): use the line number **in the new file** and `"side": "RIGHT"`.
- **Commenting on a removed line**: use the line number **in the old file** and
  `"side": "LEFT"`.
- **Spanning multiple lines**: add `"start_line"` + `"start_side"` for the first
  line and keep `"line"` + `"side"` as the last line.

Line numbers come from the hunk headers (`@@ -oldStart,oldCount +newStart,newCount @@`)
— count forward from `newStart` for RIGHT-side comments. A comment on a line that
isn't part of any hunk will be rejected by the API.

## When a comment can't be anchored

If a point is about a line outside the diff (e.g. an unchanged function the change
breaks, or a whole-file concern), you can't attach it inline. Don't drop it and
don't let it fail the request — put that point in the otherwise-empty `body`,
clearly labeled with the file/line it refers to, and tell the user you folded it
in. This is the *only* thing that ever lands in the body; if every finding anchors
inline, the body stays `""`.

## Verify it landed

`gh api` prints the created review JSON; surface the `html_url` to the user. If
the call errors (commonly: a `line` outside the diff, or `commit_id` mismatch),
read the message, fix the offending comment (re-map its line or move it to the
body), and retry the single call — don't post a partial review and then a second
one.

## Clean PR — the LGTM approval case

When the review turned up **no findings at all** and the user approves posting,
submit an approval instead of a comment review:

```json
{
  "commit_id": "<head sha>",
  "event": "APPROVE",
  "body": "LGTM :+1:"
}
```

(no `comments` array). This is the **only** case where `event` is `APPROVE` —
whenever there is even one finding, the review is always `COMMENT` and the merge
verdict is left to a human. Posting still requires the user's explicit approval
first, exactly like the comment case.
