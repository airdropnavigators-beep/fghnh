import type { Progress, WorkflowDetail } from "../types";

/**
 * Progress along the path actually taken. The raw `progress` counts every state
 * (including the terminal branches that will never be visited), which reads as
 * "70% complete" on a finished run — so a completed/cancelled workflow is 100%.
 */
export function effectiveProgress(detail: WorkflowDetail | null): Progress | null {
  if (!detail) return null;
  if (detail.status !== "in_progress") {
    return { completed: detail.progress.total, total: detail.progress.total, ratio: 1 };
  }
  return detail.progress;
}
