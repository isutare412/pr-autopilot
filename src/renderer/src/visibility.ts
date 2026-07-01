export interface QueueFilters {
  showDone: boolean;
  showDismissed: boolean;
}

// Parallel copy of src/main/core/visibility.ts (the UI bundle cannot import core/).
export function isQueueVisible(
  rec: { state: string; dismissed?: boolean },
  f: QueueFilters,
): boolean {
  if (rec.dismissed && !f.showDismissed) return false;
  if (rec.state === "DONE" && !f.showDone) return false;
  return true;
}
