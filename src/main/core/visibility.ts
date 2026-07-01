export interface QueueFilters {
  showDone: boolean;
  showDismissed: boolean;
  showClosed: boolean;
}

/** A record is visible in the queue/tray unless it is dismissed, DONE, or CLOSED
 *  and the corresponding bucket is hidden. The three buckets are independent view
 *  filters over the lifecycle `state`. */
export function isQueueVisible(
  rec: { state: string; dismissed?: boolean },
  f: QueueFilters,
): boolean {
  if (rec.dismissed && !f.showDismissed) return false;
  if (rec.state === "DONE" && !f.showDone) return false;
  if (rec.state === "CLOSED" && !f.showClosed) return false;
  return true;
}
