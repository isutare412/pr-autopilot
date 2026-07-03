import { useState, useEffect, useRef } from "react";
import { UiRecord } from "../types";

interface GeneratingPaneProps {
  record: UiRecord;
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function ActivityLog({ activity }: { activity?: string[] }) {
  const items = activity ?? [];
  if (!items.length) {
    return <div className="act-line act-wait">▸ warming up — fetching the PR…</div>;
  }
  return (
    <>
      {items.map((a, i) => {
        const last = i === items.length - 1;
        return (
          <div key={i} className={`act-line${last ? " act-active" : ""}`}>
            {last ? "▸" : "·"} {a}
          </div>
        );
      })}
    </>
  );
}

export function GeneratingPane({ record }: GeneratingPaneProps) {
  const startedMs = Date.parse(record.updatedAt) || Date.now();
  const [elapsed, setElapsed] = useState(() => fmtElapsed(Date.now() - startedMs));

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(fmtElapsed(Date.now() - startedMs));
    }, 1000);
    return () => clearInterval(timer);
  }, [startedMs]);

  // Log-tail auto-follow: keep the newest line in view, but pause following the
  // moment the user scrolls up to read history; resume when they return to the bottom.
  const logRef = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  useEffect(() => {
    const el = logRef.current;
    if (el && stuckToBottom.current) el.scrollTop = el.scrollHeight;
  }, [record.genActivity]);

  return (
    <div className="gen">
      <div className="gen-head">
        <span className="gen-spark" />
        <span className="gen-title">DRAFTING REVIEW</span>
        <span className="gen-clock">
          elapsed <span id="gen-elapsed">{elapsed}</span>
        </span>
      </div>
      <div id="gen-log" className="gen-log" ref={logRef} onScroll={onScroll}>
        <ActivityLog activity={record.genActivity} />
      </div>
    </div>
  );
}
