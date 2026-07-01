export interface QueueFilters {
  showDone: boolean;
  showDismissed: boolean;
}

/** A record is visible in the queue/tray unless it is dismissed (and the
 *  dismissed bucket is hidden) or DONE (and the done bucket is hidden). The two
 *  buckets are independent view filters over the lifecycle `state`. */
export function isQueueVisible(
  rec: { state: string; dismissed?: boolean },
  f: QueueFilters,
): boolean {
  if (rec.dismissed && !f.showDismissed) return false;
  if (rec.state === "DONE" && !f.showDone) return false;
  return true;
}
