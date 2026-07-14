import { spawn } from "node:child_process";

export interface GhRunner {
  run(args: string[], input?: string): Promise<string>;
}

export function realGhRunner(): GhRunner {
  return {
    run(args, input) {
      return new Promise((resolve, reject) => {
        const p = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
        let out = "", err = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (err += d));
        p.on("error", reject);
        p.on("close", (code) =>
          code === 0 ? resolve(out) : reject(new Error(`gh ${args.join(" ")} exited ${code}: ${err}`)),
        );
        if (input !== undefined) p.stdin.write(input);
        p.stdin.end();
      });
    },
  };
}

export interface SearchPr {
  url: string; owner: string; repo: string; number: number; title: string;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  comments: {
    databaseId: number; authorLogin: string; body: string;
    path: string | null; line: number | null;
  }[];
}

const THREADS_QUERY = `
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      reviewThreads(first:100){ nodes{
        id isResolved
        comments(first:50){ nodes{ databaseId author{login} body path line } }
      } }
    }
  }
}`;

const ADD_REVIEW = `
mutation($prId:ID!,$oid:GitObjectID!){
  addPullRequestReview(input:{pullRequestId:$prId,commitOID:$oid}){
    pullRequestReview{ id }
  }
}`;

const ADD_THREAD = `
mutation($rid:ID!,$path:String!,$body:String!,$subject:PullRequestReviewThreadSubjectType!,
         $line:Int,$side:DiffSide,$startLine:Int,$startSide:DiffSide){
  addPullRequestReviewThread(input:{
    pullRequestReviewId:$rid, path:$path, body:$body, subjectType:$subject,
    line:$line, side:$side, startLine:$startLine, startSide:$startSide
  }){ thread{ id } }
}`;

const SUBMIT_REVIEW = `
mutation($rid:ID!,$event:PullRequestReviewEvent!,$body:String){
  submitPullRequestReview(input:{pullRequestReviewId:$rid,event:$event,body:$body}){
    pullRequestReview{ url }
  }
}`;

const PENDING_REVIEW_QUERY = `
query($owner:String!,$repo:String!,$number:Int!,$author:String!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      reviews(first:1,states:PENDING,author:$author){ nodes{ id } }
    }
  }
}`;

const REVIEW_STATE_QUERY = `
query($id:ID!){
  node(id:$id){ ... on PullRequestReview { state url } }
}`;

/** One review thread to attach to a pending review. `subjectType: "FILE"` anchors
 *  the thread to the whole file — the only way to comment on a line GitHub won't
 *  accept inline (anything outside the diff hunks). Line fields are omitted for
 *  FILE threads; per the GraphQL spec an unsupplied variable is left out of the
 *  input object entirely, so the same mutation serves both subject types. */
export interface ReviewThreadInput {
  path: string;
  body: string;
  subjectType: "LINE" | "FILE";
  line?: number;
  side?: "RIGHT" | "LEFT";
  startLine?: number;
  startSide?: "RIGHT" | "LEFT";
}

export class Gh {
  constructor(private runner: GhRunner, private host: string) {}

  private api(args: string[], input?: string): Promise<string> {
    return this.runner.run(["api", "--hostname", this.host, ...args], input);
  }

  async login(): Promise<string> {
    const out = await this.api(["/user", "--jq", ".login"]);
    return out.trim();
  }

  async searchReviewRequested(login: string): Promise<SearchPr[]> {
    const q = `is:open is:pr review-requested:${login}`;
    const out = await this.api([
      "/search/issues", "-X", "GET",
      "-f", `q=${q}`, "--jq", ".items[] | {url: .html_url, title: .title}",
    ]);
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const o = JSON.parse(line) as { url: string; title: string };
      const m = o.url.match(/https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/)!;
      return { url: o.url, owner: m[1], repo: m[2], number: Number(m[3]), title: o.title };
    });
  }

  async view(owner: string, repo: string, number: number) {
    const out = await this.runner.run([
      "pr", "view", String(number), "--repo", `${this.host}/${owner}/${repo}`,
      "--json", "title,body,author,baseRefName,headRefName,headRefOid,state,isCrossRepository,headRepositoryOwner",
    ]);
    const j = JSON.parse(out);
    return {
      title: j.title as string,
      body: (j.body ?? "") as string,
      author: (j.author?.login ?? "") as string,
      baseRefName: j.baseRefName as string,
      headRefName: j.headRefName as string,
      headRefOid: j.headRefOid as string,
      state: j.state as string,
    };
  }

  async headSha(owner: string, repo: string, number: number): Promise<string> {
    const out = await this.runner.run([
      "pr", "view", String(number), "--repo", `${this.host}/${owner}/${repo}`,
      "--json", "headRefOid", "--jq", ".headRefOid",
    ]);
    return out.trim();
  }

  async prStatus(owner: string, repo: string, number: number): Promise<{ state: string; headSha: string; nodeId: string }> {
    const out = await this.runner.run([
      "pr", "view", String(number), "--repo", `${this.host}/${owner}/${repo}`,
      "--json", "state,headRefOid,id",
    ]);
    const j = JSON.parse(out);
    return { state: j.state as string, headSha: j.headRefOid as string, nodeId: j.id as string };
  }

  async prState(owner: string, repo: string, number: number): Promise<string> {
    const out = await this.runner.run([
      "pr", "view", String(number), "--repo", `${this.host}/${owner}/${repo}`,
      "--json", "state", "--jq", ".state",
    ]);
    return out.trim();
  }

  async diff(owner: string, repo: string, number: number): Promise<string> {
    return this.runner.run([
      "pr", "diff", String(number), "--repo", `${this.host}/${owner}/${repo}`,
    ]);
  }

  async reviewThreads(owner: string, repo: string, number: number): Promise<ReviewThread[]> {
    const out = await this.api([
      "graphql", "-f", `owner=${owner}`, "-f", `repo=${repo}`,
      "-F", `number=${number}`, "-f", `query=${THREADS_QUERY}`,
    ]);
    const j = JSON.parse(out);
    const nodes = j.data.repository.pullRequest.reviewThreads.nodes as any[];
    return nodes.map((n) => ({
      id: n.id,
      isResolved: n.isResolved,
      comments: (n.comments.nodes as any[]).map((c) => ({
        databaseId: c.databaseId, authorLogin: c.author?.login ?? "",
        body: c.body, path: c.path, line: c.line,
      })),
    }));
  }

  async postReview(owner: string, repo: string, number: number, payload: object): Promise<{ html_url: string }> {
    const out = await this.api([
      "-X", "POST", `/repos/${owner}/${repo}/pulls/${number}/reviews`, "--input", "-",
    ], JSON.stringify(payload));
    return JSON.parse(out);
  }

  async postReply(owner: string, repo: string, number: number, commentDatabaseId: number, body: string): Promise<void> {
    await this.api([
      "-X", "POST",
      `/repos/${owner}/${repo}/pulls/${number}/comments/${commentDatabaseId}/replies`,
      "--input", "-",
    ], JSON.stringify({ body }));
  }

  async resolveThread(threadNodeId: string): Promise<void> {
    const mutation = `mutation($threadId:ID!){ resolveReviewThread(input:{threadId:$threadId}){ thread{ id isResolved } } }`;
    await this.api(["graphql", "-f", `threadId=${threadNodeId}`, "-f", `query=${mutation}`]);
  }

  async requestReviewer(owner: string, repo: string, number: number, login: string): Promise<void> {
    await this.api([
      "-X", "POST", `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`,
      "-f", `reviewers[]=${login}`,
    ]);
  }

  /** Open a PENDING review (no `event` → not submitted, invisible to the author). */
  async createPendingReview(prNodeId: string, commitOid: string): Promise<string> {
    const out = await this.api([
      "graphql", "-f", `prId=${prNodeId}`, "-f", `oid=${commitOid}`, "-f", `query=${ADD_REVIEW}`,
    ]);
    return JSON.parse(out).data.addPullRequestReview.pullRequestReview.id as string;
  }

  async addReviewThread(reviewId: string, input: ReviewThreadInput): Promise<void> {
    const args = [
      "graphql",
      "-f", `rid=${reviewId}`,
      "-f", `path=${input.path}`,
      "-f", `body=${input.body}`,
      "-f", `subject=${input.subjectType}`,
    ];
    // -F sends a typed literal (Int); -f sends a string. Unsupplied variables are
    // omitted from the input object, which is exactly what a FILE thread needs.
    if (input.line != null) args.push("-F", `line=${input.line}`);
    if (input.side) args.push("-f", `side=${input.side}`);
    if (input.startLine != null) args.push("-F", `startLine=${input.startLine}`);
    if (input.startSide) args.push("-f", `startSide=${input.startSide}`);
    args.push("-f", `query=${ADD_THREAD}`);
    await this.api(args);
  }

  async submitReview(reviewId: string, event: "APPROVE" | "COMMENT", body: string): Promise<{ url: string }> {
    const out = await this.api([
      "graphql", "-f", `rid=${reviewId}`, "-f", `event=${event}`, "-f", `body=${body}`,
      "-f", `query=${SUBMIT_REVIEW}`,
    ]);
    return { url: JSON.parse(out).data.submitPullRequestReview.pullRequestReview.url as string };
  }

  /** The caller's own unsubmitted review on this PR, if any. GitHub allows exactly
   *  one per user per PR, so this is how a crashed post finds its way back. */
  async findPendingReview(owner: string, repo: string, number: number, login: string): Promise<string | null> {
    const out = await this.api([
      "graphql", "-f", `owner=${owner}`, "-f", `repo=${repo}`,
      "-F", `number=${number}`, "-f", `author=${login}`, "-f", `query=${PENDING_REVIEW_QUERY}`,
    ]);
    const nodes = JSON.parse(out).data.repository.pullRequest.reviews.nodes as { id: string }[];
    return nodes[0]?.id ?? null;
  }

  /** The state and URL of a review we previously opened, or null if it no longer
   *  exists. This is what tells a resumed post whether its stored review is still
   *  a PENDING draft to resume into, or was already SUBMITTED (in which case the
   *  review landed and only our bookkeeping was lost — re-posting would duplicate
   *  it on the author's PR). GitHub answers a dangling id with an error rather
   *  than a null node, so that case is mapped to null too. */
  async reviewState(reviewId: string): Promise<{ state: string; url: string } | null> {
    let out: string;
    try {
      out = await this.api(["graphql", "-f", `id=${reviewId}`, "-f", `query=${REVIEW_STATE_QUERY}`]);
    } catch (e) {
      if (/could not resolve to a node/i.test(String(e))) return null;
      throw e;
    }
    const n = JSON.parse(out).data.node as { state: string; url: string } | null;
    // A node that resolved to something other than a PullRequestReview comes back
    // as `{}` from the inline fragment — truthy but stateless. Treat that the same
    // as a missing node rather than reporting a "landed" review with no URL.
    if (!n?.state) return null;
    return { state: n.state, url: n.url };
  }
}
