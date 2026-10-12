import type { ContentStatus, RunStatus } from "../../lib/learningApi";

const CONTENT_LABELS: Record<ContentStatus, { label: string; tone: string; title: string }> = {
  ai_generated: { label: "AI generated", tone: "generated", title: "Written by AI. Not every claim passed verification; check important facts." },
  ai_verified: { label: "AI verified", tone: "verified", title: "Every claim was checked against cited sources and the quiz key was independently solved by a second model." },
  human_reviewed: { label: "Human reviewed", tone: "reviewed", title: "A reviewer confirmed this lesson." },
};

const RUN_LABELS: Record<RunStatus, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "running" },
  running: { label: "Running", tone: "running" },
  completed: { label: "Completed", tone: "verified" },
  failed: { label: "Failed", tone: "failed" },
  blocked: { label: "Blocked", tone: "generated" },
};

export function ContentStatusBadge({ status }: { status: ContentStatus }) {
  const info = CONTENT_LABELS[status] ?? CONTENT_LABELS.ai_generated;
  return <span className="lr-badge" data-tone={info.tone} title={info.title} aria-label={`${info.label}: ${info.title}`}>{info.label}</span>;
}

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const info = RUN_LABELS[status] ?? RUN_LABELS.failed;
  return <span className="lr-badge" data-tone={info.tone}>{info.label}</span>;
}
