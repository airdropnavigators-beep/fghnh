import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw, TerminalSquare, WifiOff } from "lucide-react";
import type { ApiMode } from "@/services/api";
import type { Connection } from "@/hooks/useWorkflow";
import { Button } from "@/components/ui/Button";

interface OfflineNoticeProps {
  mode: ApiMode;
  connection: Connection;
  onRetry: () => void;
  onUseMock: () => void;
}

/** Shown in live mode when the backend can't be reached — with the exact fix. */
export function OfflineNotice({ mode, connection, onRetry, onUseMock }: OfflineNoticeProps) {
  const show = mode === "live" && connection === "offline";
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="border-b border-warn-100 bg-warn-50"
        >
          <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-start gap-2.5">
              <WifiOff size={15} className="mt-0.5 shrink-0 text-warn-600" />
              <div className="text-xs leading-relaxed text-ink-900">
                <span className="font-semibold">Live API unreachable.</span> Start the backend and this clears
                automatically:
                <code className="ml-1.5 inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-700 ring-1 ring-line">
                  <TerminalSquare size={11} /> cd backend && uvicorn main:app --reload
                </code>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                <RefreshCw size={13} /> Retry now
              </Button>
              <Button size="sm" variant="ghost" onClick={onUseMock}>
                Use offline demo
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
