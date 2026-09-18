import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, RefreshCw, WifiOff, X } from "lucide-react";
import type { UiError } from "@/hooks/useWorkflow";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/Button";

interface ErrorBannerProps {
  error: UiError | null;
  onDismiss: () => void;
  className?: string;
}

const TITLE: Record<UiError["kind"], string> = {
  network: "Backend unreachable",
  timeout: "Request timed out",
  http: "The backend rejected the request",
  parse: "Unexpected response",
  unknown: "Something went wrong",
};

export function ErrorBanner({ error, onDismiss, className }: ErrorBannerProps) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.22 }}
          className={cn("overflow-hidden", className)}
        >
          <div className="flex items-start gap-3 rounded-2xl border border-err-100 bg-err-50 p-3.5 shadow-card">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface text-err-600 shadow-card">
              {error.kind === "network" || error.kind === "timeout" ? <WifiOff size={14} /> : <AlertOctagon size={14} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-ink-950">
                {TITLE[error.kind]}
                {error.status ? <span className="ml-1.5 font-mono text-[10.5px] font-medium text-err-600">HTTP {error.status}</span> : null}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-700">{error.message}</p>
              {error.retry && (
                <Button variant="secondary" size="sm" className="mt-2.5" onClick={error.retry}>
                  <RefreshCw size={13} /> {error.kind === "http" ? "Re-sync with server" : "Retry"}
                </Button>
              )}
            </div>
            <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-500 transition hover:bg-surface hover:text-ink-900">
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
