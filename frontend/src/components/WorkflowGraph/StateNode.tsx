import { memo } from "react";
import { motion } from "framer-motion";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Check,
  FileText,
  Flag,
  MessageSquareText,
  Rocket,
  ShieldCheck,
  UserCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { StateStatus, StateType } from "@/types";
import { STATE_TYPE_LABELS } from "@/types";
import { cn } from "@/utils/cn";

export type StateNodeData = {
  label: string;
  description: string;
  type: StateType;
  status: StateStatus;
  /** Rank in execution order (for a staggered entrance). */
  index: number;
  /** Terminal state that the run actually ended on. */
  reached?: boolean;
  horizontal?: boolean;
};

export type StateNodeType = Node<StateNodeData, "stateNode">;

export const NODE_W = 232;
export const NODE_H = 88;

const ICONS: Record<StateType, LucideIcon> = {
  automatic: Zap,
  user_input: MessageSquareText,
  document_required: FileText,
  human_approval: UserCheck,
  validation: ShieldCheck,
  execution: Rocket,
  terminal: Flag,
};

const STATUS: Record<
  StateStatus,
  { card: string; icon: string; chip: string; label: string; title: string }
> = {
  pending: {
    card: "border-line bg-surface",
    icon: "bg-canvas text-ink-500 border-line",
    chip: "chip-neutral",
    label: "Pending",
    title: "text-ink-700",
  },
  active: {
    card: "border-brand-500 bg-surface shadow-[0_0_0_4px_rgba(18,160,143,0.12)]",
    icon: "bg-brand-600 text-white border-brand-600",
    chip: "chip-brand",
    label: "Active",
    title: "text-ink-950",
  },
  completed: {
    card: "border-line bg-surface",
    icon: "bg-ok-50 text-ok-600 border-ok-100",
    chip: "chip-ok",
    label: "Done",
    title: "text-ink-900",
  },
  warning: {
    card: "border-warn-500/60 bg-surface",
    icon: "bg-warn-50 text-warn-600 border-warn-100",
    chip: "chip-warn",
    label: "Warning",
    title: "text-ink-900",
  },
  blocked: {
    card: "border-err-500/60 bg-surface",
    icon: "bg-err-50 text-err-600 border-err-100",
    chip: "chip-err",
    label: "Blocked",
    title: "text-ink-900",
  },
  failed: {
    card: "border-err-500/60 bg-surface",
    icon: "bg-err-50 text-err-600 border-err-100",
    chip: "chip-err",
    label: "Failed",
    title: "text-ink-900",
  },
};

function StateNodeComponent({ data }: NodeProps<StateNodeType>) {
  const { label, description, type, status, index, reached, horizontal } = data;
  const Icon = ICONS[type] ?? Zap;
  const s = STATUS[status] ?? STATUS.pending;
  const isTerminal = type === "terminal";
  const untouched = status === "pending" && isTerminal && !reached;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: untouched ? 0.55 : 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.045, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      style={{ width: NODE_W, height: NODE_H }}
      className={cn(
        "relative rounded-2xl border shadow-card transition-[border-color,box-shadow] duration-300",
        s.card,
        status === "active" && "animate-pulse-ring",
      )}
      role="group"
      aria-label={`${label}: ${s.label}`}
    >
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} isConnectable={false} />
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} isConnectable={false} />
      <Handle id="loop-out" type="source" position={horizontal ? Position.Bottom : Position.Left} isConnectable={false} />
      <Handle id="loop-in" type="target" position={horizontal ? Position.Bottom : Position.Left} isConnectable={false} />

      <div className="flex h-full flex-col justify-between p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition-colors",
                s.icon,
              )}
            >
              {status === "completed" ? <Check size={15} strokeWidth={2.5} /> : <Icon size={15} />}
            </span>
            <div className="min-w-0">
              <p className={cn("truncate text-[13px] font-semibold leading-tight", s.title)}>{label}</p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-400">
                {STATE_TYPE_LABELS[type] ?? type}
              </p>
            </div>
          </div>
          <span className={cn("chip shrink-0", s.chip)}>
            {status === "active" && (
              <span className="relative mr-0.5 flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
            )}
            {s.label}
          </span>
        </div>
        <p className="line-clamp-1 text-[11.5px] leading-snug text-ink-500" title={description}>{description}</p>
      </div>
    </motion.div>
  );
}

export const StateNode = memo(StateNodeComponent);
