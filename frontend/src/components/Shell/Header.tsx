import { Loader2, ScrollText, Server, Wifi, WifiOff } from "lucide-react";
import type { ApiMode } from "@/services/api";
import type { Connection } from "@/hooks/useWorkflow";
import type { WorkflowStatus } from "@/types";
import { STATUS_LABELS } from "@/types";
import { cn } from "@/utils/cn";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";

interface HeaderProps {
  status: WorkflowStatus | null;
  busy: boolean;
  mode: ApiMode;
  connection: Connection;
  serverInfo: { environment: string; demo_mode: boolean } | null;
  auditCount: number;
  onModeChange: (mode: ApiMode) => void;
  onAudit: () => void;
  onRetryConnection: () => void;
}

const STATUS_TONE: Record<WorkflowStatus, Tone> = {
  in_progress: "brand",
  completed: "ok",
  cancelled: "neutral",
  failed: "err",
  generation_failed: "err",
};

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink-950 shadow-raised" aria-hidden>
        <svg viewBox="0 0 32 32" className="h-5 w-5">
          <path d="M9 9h6v14H9z" fill="#12a08f" />
          <path d="M17 9h6v6h-6z" fill="#95dfd6" />
          <path d="M17 17h6v6h-6z" fill="#fff" opacity="0.9" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink-950">FlowForge</span>
    </span>
  );
}

function ModeSwitch({ mode, onChange }: { mode: ApiMode; onChange: (m: ApiMode) => void }) {
  return (
    <div role="radiogroup" aria-label="API mode" className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-medium">
      {(["mock", "live"] as ApiMode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            "rounded-md px-2.5 py-1 capitalize transition",
            mode === m ? "bg-surface text-ink-950 shadow-card" : "text-ink-500 hover:text-ink-900",
          )}
        >
          {m === "mock" ? "Offline demo" : "Live API"}
        </button>
      ))}
    </div>
  );
}

function ConnectionPill({
  mode,
  connection,
  serverInfo,
  onRetry,
}: {
  mode: ApiMode;
  connection: Connection;
  serverInfo: HeaderProps["serverInfo"];
  onRetry: () => void;
}) {
  if (mode === "mock") {
    return (
      <Tooltip label="Deterministic in-browser mock — no backend required">
        <span>
          <Badge tone="neutral" dot>
            <Server size={11} className="mr-0.5" /> mock
          </Badge>
        </span>
      </Tooltip>
    );
  }
  if (connection === "checking") {
    return (
      <Badge tone="neutral">
        <Loader2 size={11} className="mr-0.5 animate-spin" /> connecting
      </Badge>
    );
  }
  if (connection === "offline") {
    return (
      <Tooltip label="Backend unreachable — click to retry">
        <button type="button" onClick={onRetry} className="chip chip-err cursor-pointer hover:bg-err-100">
          <WifiOff size={11} className="mr-0.5" /> offline
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={serverInfo ? `${serverInfo.environment} · ${serverInfo.demo_mode ? "DEMO_MODE (mock providers)" : "AWS providers"}` : "connected"}>
      <span>
        <Badge tone="ok" dot pulse>
          <Wifi size={11} className="mr-0.5" /> {serverInfo?.demo_mode ? "live · demo" : "live"}
        </Badge>
      </span>
    </Tooltip>
  );
}

export function Header({
  status,
  busy,
  mode,
  connection,
  serverInfo,
  auditCount,
  onModeChange,
  onAudit,
  onRetryConnection,
}: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/80 px-4 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Logo />
        <span className="hidden h-5 w-px bg-line sm:block" />
        <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-[13px] text-ink-500 sm:flex">
          <span>Workflows</span>
          <span className="text-ink-300">/</span>
          <span className="font-medium text-ink-900">Scholarship demo</span>
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:block">
          <ModeSwitch mode={mode} onChange={onModeChange} />
        </div>
        <ConnectionPill mode={mode} connection={connection} serverInfo={serverInfo} onRetry={onRetryConnection} />
        {status && (
          <Badge tone={STATUS_TONE[status]} dot pulse={status === "in_progress"} className="hidden sm:inline-flex">
            {busy && <Loader2 size={11} className="mr-0.5 animate-spin" />}
            {STATUS_LABELS[status]}
          </Badge>
        )}
        <Button variant="secondary" size="sm" onClick={onAudit} className="gap-1.5">
          <ScrollText size={14} />
          <span className="hidden sm:inline">Audit</span>
          {auditCount > 0 && <span className="rounded-md bg-ink-950 px-1.5 py-px font-mono text-[10px] text-white">{auditCount}</span>}
        </Button>
      </div>
    </header>
  );
}

export { ModeSwitch };
