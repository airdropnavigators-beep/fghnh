import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast, Toaster } from "sonner";
import { Activity, FileText, PanelLeftOpen, UserCheck, X } from "lucide-react";
import { ApprovalModal, type Decision } from "@/components/ApprovalModal/ApprovalModal";
import { AuditLog } from "@/components/AuditLog/AuditLog";
import { ChatPanel } from "@/components/ChatPanel/ChatPanel";
import { SideRail } from "@/components/ChatPanel/SideRail";
import { DocumentUpload } from "@/components/DocumentUpload/DocumentUpload";
import { DocumentDetails } from "@/components/DocumentDetails/DocumentDetails";
import { GoalInput } from "@/components/GoalInput/GoalInput";
import { ProgressBar } from "@/components/ProgressBar/ProgressBar";
import { ValidationResults } from "@/components/ValidationResults/ValidationResults";
import { WorkflowGraph } from "@/components/WorkflowGraph/WorkflowGraph";
import { ErrorBanner } from "@/components/Shell/ErrorBanner";
import { Header } from "@/components/Shell/Header";
import { OfflineNotice } from "@/components/Shell/OfflineNotice";
import { OutcomeCard } from "@/components/Shell/OutcomeCard";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogTitle, SheetContent } from "@/components/ui/Dialog";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { useMediaQuery, BP } from "@/hooks/useMediaQuery";
import { useWorkflow, type DemoPhase } from "@/hooks/useWorkflow";
import { NEEDS_LABELS } from "@/types";
import { cn } from "@/utils/cn";

const PANEL_TABS: { id: "action" | "documents" | "activity"; label: string; icon: typeof Activity }[] = [
  { id: "action", label: "Action", icon: UserCheck },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "activity", label: "Activity", icon: Activity },
];

export function Demo() {
  const wf = useWorkflow();
  const { state, mode, setMode, connection, serverInfo, checkHealth, start, advance, upload, loadAudit, clear, dismissError } = wf;
  const { phase, detail, documents, audit, busy, pending, error, workflowId } = state;

  const isDesktop = useMediaQuery(BP.xl);
  const isTablet = useMediaQuery(BP.md);

  const [auditOpen, setAuditOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
  const [tab, setTab] = useState<(typeof PANEL_TABS)[number]["id"]>("action");
  const [gateDismissed, setGateDismissed] = useState<string | null>(null);

  const gateVariant: "review" | "approval" | null =
    phase === "review" ? "review" : phase === "approval" ? "approval" : null;
  const gateKey = detail ? `${detail.workflow_id}:${detail.current_state}` : null;
  const gateOpen = gateVariant !== null && gateKey !== null && gateDismissed !== gateKey;

  // Re-open the gate whenever the workflow reaches a new one.
  useEffect(() => {
    setGateDismissed(null);
  }, [gateKey]);

  // Jump the side panel to the relevant tab as the phase changes.
  useEffect(() => {
    if (phase === "documents") setTab("action");
    if (phase === "review" || phase === "approval" || phase === "done") setTab("action");
  }, [phase]);

  // Toasts for the important transitions (independent of which panel is visible).
  const [lastToastKey, setLastToastKey] = useState<string | null>(null);
  useEffect(() => {
    if (!detail) return;
    const key = `${detail.workflow_id}:${detail.status}:${detail.current_state}`;
    if (key === lastToastKey) return;
    setLastToastKey(key);
    if (detail.status === "completed") toast.success("Workflow completed", { description: detail.last_message ?? undefined });
    else if (detail.status === "cancelled") toast("Workflow ended", { description: detail.last_message ?? undefined });
    else if (detail.validation && detail.needs === "approval" && phase === "review")
      toast.warning("Validation needs review", { description: detail.validation.issues[0]?.message });
  }, [detail, phase, lastToastKey]);

  const handleDecision = useCallback(
    (decision: Decision) => {
      void advance(decision);
    },
    [advance],
  );

  const handleModeChange = useCallback(
    (next: typeof mode) => {
      if (next === mode) return;
      setMode(next);
      toast(next === "live" ? "Switched to the live API" : "Switched to the offline demo", {
        description: next === "live" ? "Requests go to the FastAPI backend via /api." : "Everything runs in the browser.",
      });
    },
    [mode, setMode],
  );

  const title = useMemo(() => phaseTitle(phase, detail?.needs ?? null), [phase, detail?.needs]);

  const actionPanel = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={phase}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.22 }}
        className="space-y-3"
      >
        {phase === "documents" && (
          <DocumentUpload
            detail={detail}
            busy={busy}
            disabled={mode === "live" && connection === "offline"}
            onUpload={upload}
            onContinue={() => void advance({})}
          />
        )}

        {(phase === "review" || phase === "approval") && detail && (
          <>
            <ValidationResults result={detail.validation ?? null} />
            <div className="panel flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[13px] font-semibold text-ink-950">
                  {phase === "review" ? "Resolve the warning to continue" : "Awaiting your approval"}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">The workflow is paused at a human gate.</p>
              </div>
              <Button variant="dark" size="sm" onClick={() => setGateDismissed(null)}>
                <UserCheck size={14} /> Open gate
              </Button>
            </div>
          </>
        )}

        {phase === "input" && detail && (
          <div className="panel p-5">
            <span className="eyebrow">Step · Input</span>
            <h3 className="mt-1 text-[15px] font-semibold text-ink-950">This step needs information</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">{detail.last_message}</p>
            <Button variant="dark" className="mt-4 w-full" loading={busy} onClick={() => void advance({ confirm: true })}>
              Continue
            </Button>
          </div>
        )}

        {phase === "done" && detail && (
          <OutcomeCard detail={detail} confirmationId={state.confirmationId} onStartOver={clear} onAudit={() => setAuditOpen(true)} />
        )}

        {(phase === "documents" || phase === "review" || phase === "approval") && isDesktop && (
          <DocumentDetails documents={documents} />
        )}
      </motion.div>
    </AnimatePresence>
  );

  const railPanel = (
    <SideRail detail={detail} loading={pending === "create"} className="shrink-0" />
  );

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-canvas">
        <Header
          status={detail?.status ?? null}
          busy={busy}
          mode={mode}
          connection={connection}
          serverInfo={serverInfo}
          auditCount={audit.length}
          onModeChange={handleModeChange}
          onAudit={() => setAuditOpen(true)}
          onRetryConnection={() => void checkHealth()}
        />
        <OfflineNotice mode={mode} connection={connection} onRetry={() => void checkHealth()} onUseMock={() => handleModeChange("mock")} />

        {phase === "goal" ? (
          <main className="slim-scroll relative flex-1 overflow-y-auto">
            <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(#d3d7df_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" />
            <div className="relative mx-auto flex min-h-full max-w-5xl flex-col justify-center px-4 py-10 sm:px-6 sm:py-16">
              <ErrorBanner error={error} onDismiss={dismissError} className="mx-auto mb-6 w-full max-w-3xl" />
              <GoalInput busy={pending === "create"} disabled={mode === "live" && connection === "offline"} onStart={(g) => void start(g)} />
              <div className="mt-6 lg:hidden">
                <p className="text-center text-[11px] text-ink-400">API mode</p>
                <div className="mt-2 flex justify-center">
                  <ModeSwitchInline mode={mode} onChange={handleModeChange} />
                </div>
              </div>
            </div>
          </main>
        ) : (
          <div className={cn("flex min-h-0 flex-1", isTablet ? "flex-row" : "flex-col")}>
            {/* Left rail (desktop only; sheet elsewhere) */}
            {isDesktop && (
              <aside className="slim-scroll flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-line bg-canvas p-3">
                {railPanel}
                <ChatPanel events={audit} open={activityOpen} onToggle={() => setActivityOpen((o) => !o)} className="min-h-0 flex-1" />
              </aside>
            )}

            {/* Centre: graph */}
            <main className={cn("relative flex min-h-0 min-w-0 flex-col", isTablet ? "flex-1" : "h-[46vh] shrink-0 border-b border-line")}>
              <div className="flex items-center justify-between gap-2 border-b border-line bg-surface/70 px-4 py-2 backdrop-blur">
                <div className="flex min-w-0 items-center gap-2">
                  {!isDesktop && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRailOpen(true)} aria-label="Open run status">
                      <PanelLeftOpen size={15} />
                    </Button>
                  )}
                  <span className="eyebrow truncate">Workflow graph</span>
                  {detail && (
                    <span className="hidden truncate text-xs text-ink-500 sm:inline">· {detail.goal}</span>
                  )}
                </div>
                <span className="shrink-0 text-[11px] font-medium text-ink-700">{title}</span>
              </div>
              <div className="relative min-h-0 flex-1">
                <WorkflowGraph detail={detail} loading={pending === "create"} />
              </div>
            </main>

            {/* Right / bottom panel */}
            <aside
              className={cn(
                "slim-scroll flex min-h-0 flex-col overflow-y-auto bg-canvas",
                isTablet ? "w-[340px] shrink-0 border-l border-line lg:w-[380px] xl:w-[400px]" : "flex-1",
              )}
            >
              {!isDesktop && (
                <div className="sticky top-0 z-10 flex gap-1 border-b border-line bg-canvas/90 px-3 py-2 backdrop-blur">
                  {PANEL_TABS.map((t) => {
                    const Icon = t.icon;
                    const count = t.id === "documents" ? documents.length : t.id === "activity" ? audit.filter((e) => e.event_type !== "state_activated").length : 0;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        aria-pressed={tab === t.id}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition",
                          tab === t.id ? "bg-surface text-ink-950 shadow-card" : "text-ink-500 hover:text-ink-900",
                        )}
                      >
                        <Icon size={13} /> {t.label}
                        {count > 0 && <span className="rounded-md bg-canvas px-1 font-mono text-[10px] text-ink-500">{count}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex-1 space-y-3 p-3">
                <ErrorBanner error={error} onDismiss={dismissError} />
                {isDesktop || tab === "action" ? actionPanel : null}
                {!isDesktop && tab === "documents" && <DocumentDetails documents={documents} />}
                {!isDesktop && tab === "activity" && (
                  <ChatPanel events={audit} open onToggle={() => undefined} />
                )}
              </div>
            </aside>
          </div>
        )}

        <footer className="shrink-0 border-t border-line bg-surface/80 backdrop-blur">
          <ProgressBar detail={detail} busy={busy} />
        </footer>

        {gateVariant && (
          <ApprovalModal
            detail={detail}
            variant={gateVariant}
            open={gateOpen}
            busy={busy}
            onDecision={handleDecision}
            onOpenChange={(o) => {
              if (!o && gateKey) setGateDismissed(gateKey);
              if (o) setGateDismissed(null);
            }}
          />
        )}

        <AuditLog open={auditOpen} onOpenChange={setAuditOpen} events={audit} workflowId={workflowId} onRefresh={loadAudit} />

        {/* Mobile / tablet: run status in a left sheet */}
        <Dialog open={railOpen && !isDesktop} onOpenChange={setRailOpen}>
          <SheetContent side="left" className="max-w-[340px] p-3" aria-describedby={undefined}>
            <div className="flex items-center justify-between px-1 pb-2">
              <DialogTitle className="eyebrow">Run status</DialogTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRailOpen(false)} aria-label="Close">
                <X size={15} />
              </Button>
            </div>
            <div className="slim-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {railPanel}
              <ChatPanel events={audit} open onToggle={() => undefined} className="min-h-0 flex-1" />
            </div>
          </SheetContent>
        </Dialog>

        <Toaster position="bottom-right" richColors closeButton toastOptions={{ duration: 4200 }} />
      </div>
    </TooltipProvider>
  );
}

function phaseTitle(phase: DemoPhase, needs: string | null): string {
  switch (phase) {
    case "documents":
      return "Collecting documents";
    case "review":
      return "Review required";
    case "approval":
      return "Approval required";
    case "input":
      return NEEDS_LABELS[needs ?? ""] ?? "Input needed";
    case "done":
      return "Finished";
    default:
      return "";
  }
}

function ModeSwitchInline({ mode, onChange }: { mode: "mock" | "live"; onChange: (m: "mock" | "live") => void }) {
  return (
    <div role="radiogroup" aria-label="API mode" className="inline-flex rounded-lg border border-line bg-surface p-0.5 text-xs font-medium shadow-card">
      {(["mock", "live"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={cn("rounded-md px-3 py-1.5 transition", mode === m ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900")}
        >
          {m === "mock" ? "Offline demo" : "Live API"}
        </button>
      ))}
    </div>
  );
}
