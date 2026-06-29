import type { Draft, Language } from "./schema";
import { LANGUAGE_LABEL } from "./schema";

const SCHEMA_DOC = `Emit a single JSON object with this exact shape:
{
  "overallEn": string,              // English take (never posted), Markdown with real newlines — see formatting rule below
  "counts": { "critical": int, "major": int, "minor": int, "nit": int },  // NEW findings only
  "findings": [ {
    "id": string, "ref": "#1",      // ref is "#1","#2",... in order
    "path": string, "line": int, "side": "RIGHT"|"LEFT",
    "startLine": int|null, "startSide": "RIGHT"|"LEFT"|null,
    "anchorable": boolean,          // false if the line is outside the diff hunks
    "priority": "Critical"|"Major"|"Minor"|"Nit",
    "body": string,                 // comment in the configured language, prefixed with the bold priority label
    "suggestion": string|null       // a \`\`\`suggestion block body, or null
  } ],
  "verify": [ {                     // re-review only; [] on a first review
    "id": string, "ref": "V1",      // ref is "V1","V2",... in order
    "threadNodeId": string,         // GraphQL node id of the thread (for resolve)
    "replyTargetDatabaseId": int,   // first comment's REST databaseId (for reply)
    "path": string, "line": int,
    "verdict": "resolve"|"follow-up"|"needs-call",
    "rationaleEn": string,          // English: why resolved / still open / needs the user
    "replyBody": string             // confirm reply (resolve) or labeled follow-up; "" for needs-call
  } ]
}`;

export function buildPrompt(input: { url: string; outFile: string; priorDraft?: Draft; feedback?: string; language: Language }): string {
  const lines: string[] = [];
  lines.push(`Use the /pr-autopilot:review-pr skill to analyze this pull request: ${input.url}`);
  lines.push(`Run its full analysis and (if there are prior threads of yours) its verify track.`);
  lines.push(`This is UNATTENDED automation. Talk to no one and ask no questions.`);
  lines.push(``);
  lines.push(`HARD RULES:`);
  lines.push(`- Do NOT post, reply, resolve, approve, or re-request reviewers.`);
  lines.push(`- Do NOT run any mutating gh command (no POST/PUT/PATCH/DELETE, no graphql mutation, no gh pr review/comment).`);
  lines.push(`- Your ONLY output is a JSON file. Use available read-only gh/api calls to gather context.`);
  lines.push(``);
  lines.push(`Write every PR-destined comment/reply body in ${LANGUAGE_LABEL[input.language]}.`);
  lines.push(``);
  lines.push(`When done, WRITE the JSON to this exact file path (overwrite it): ${input.outFile}`);
  lines.push(`Write nothing else to that file. Do not print the JSON to stdout.`);
  lines.push(``);
  lines.push(SCHEMA_DOC);
  lines.push(``);
  lines.push(`"overallEn" is shown in a reading pane, so format it for at-a-glance scanning: a one-line verdict, then a blank line, then "- " bullets — one key point or open risk per line. Use real newlines (it is rendered as Markdown). Do NOT return a single long paragraph.`);
  if (input.priorDraft) {
    lines.push(``);
    lines.push(`This is a RE-DRAFT. Here is the previous draft (item refs are stable — the user references them):`);
    lines.push("```json");
    lines.push(JSON.stringify(input.priorDraft, null, 2));
    lines.push("```");
    lines.push(`The user's feedback on that draft: """${input.feedback ?? ""}"""`);
    lines.push(`Revise the draft accordingly and write the new JSON to the out-file.`);
  }
  return lines.join("\n");
}
