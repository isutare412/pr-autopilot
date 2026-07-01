import { describe, it, expect } from "vitest";
import { isQueueVisible } from "../src/main/core/visibility";

describe("isQueueVisible", () => {
  const F = (over = {}) => ({ showDone: false, showDismissed: false, showClosed: false, ...over });

  it("shows an active NEEDS_REVIEW record with both filters off", () => {
    expect(isQueueVisible({ state: "NEEDS_REVIEW" }, F())).toBe(true);
  });
  it("hides a DONE record unless showDone", () => {
    expect(isQueueVisible({ state: "DONE" }, F())).toBe(false);
    expect(isQueueVisible({ state: "DONE" }, F({ showDone: true }))).toBe(true);
  });
  it("hides a dismissed record unless showDismissed", () => {
    expect(isQueueVisible({ state: "NEEDS_REVIEW", dismissed: true }, F())).toBe(false);
    expect(isQueueVisible({ state: "NEEDS_REVIEW", dismissed: true }, F({ showDismissed: true }))).toBe(true);
  });
  it("treats the two filters independently", () => {
    // showDone does not reveal a dismissed record...
    expect(isQueueVisible({ state: "NEEDS_REVIEW", dismissed: true }, F({ showDone: true }))).toBe(false);
    // ...and showDismissed does not reveal a plain DONE record.
    expect(isQueueVisible({ state: "DONE" }, F({ showDismissed: true }))).toBe(false);
  });
  it("requires both filters for a dismissed DONE record", () => {
    const rec = { state: "DONE", dismissed: true };
    expect(isQueueVisible(rec, F({ showDone: true }))).toBe(false);
    expect(isQueueVisible(rec, F({ showDismissed: true }))).toBe(false);
    expect(isQueueVisible(rec, F({ showDone: true, showDismissed: true }))).toBe(true);
  });
  it("hides a CLOSED record unless showClosed", () => {
    expect(isQueueVisible({ state: "CLOSED" }, F())).toBe(false);
    expect(isQueueVisible({ state: "CLOSED" }, F({ showClosed: true }))).toBe(true);
  });
  it("treats showClosed independently of showDone/showDismissed", () => {
    expect(isQueueVisible({ state: "CLOSED" }, F({ showDone: true }))).toBe(false);
    expect(isQueueVisible({ state: "DONE" }, F({ showClosed: true }))).toBe(false);
  });
});
