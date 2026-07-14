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
}
