import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import { Crosshair, Maximize2, Workflow } from "lucide-react";
import type { WorkflowDetail } from "@/types";
import { findBackEdges, findInitialState, layout } from "@/utils/layout";
import { cn } from "@/utils/cn";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tooltip } from "@/components/ui/Tooltip";
import { NODE_H, NODE_W, StateNode, type StateNodeType } from "./StateNode";

interface WorkflowGraphProps {
  detail: WorkflowDetail | null;
  /** Show a planning skeleton while the workflow is being generated. */
  loading?: boolean;
  /** Lay the flow out left→right instead of the default top→down. */
  horizontal?: boolean;
  className?: string;
}

type Camera = "follow" | "all";

const nodeTypes = { stateNode: StateNode };

function buildGraph(detail: WorkflowDetail, horizontal: boolean) {
  const initial = findInitialState(detail.states);
  const positions = layout(detail.states, initial, {
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
    direction: horizontal ? "horizontal" : "vertical",
  });
  const backEdges = findBackEdges(detail.states, initial);
  const posById = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
  const activeId = detail.current_state;
  const statusById = new Map(detail.states.map((s) => [s.id, s.status]));
  const rank = new Map(positions.map((p, i) => [p.id, i]));

  const nodes: StateNodeType[] = detail.states.map((s) => ({
    id: s.id,
    type: "stateNode",
    position: posById.get(s.id) ?? { x: 0, y: 0 },
    draggable: false,
    selectable: false,
    focusable: false,
    data: {
      label: s.label,
      description: s.description,
      type: s.type,
      status: s.status,
      index: rank.get(s.id) ?? 0,
      reached: s.id === detail.current_state,
      horizontal,
    },
  }));

  const edges: Edge[] = detail.states.flatMap((s) =>
    s.transitions.map((t, idx) => {
      const from = statusById.get(s.id);
      const to = statusById.get(t.target);
      const done = from === "completed" && (to === "completed" || to === "active" || t.target === activeId);
      const active = s.id === activeId;
      const isBack = backEdges.has(`${s.id}->${t.target}`);
      const cls = active ? "ff-edge-active" : done ? "ff-edge-done" : isBack ? "ff-edge-back" : "ff-edge-muted";
      const color = active ? "#12a08f" : done ? "#95dfd6" : "#d3d7df";
      return {
        id: `${s.id}->${t.target}-${idx}`,
        source: s.id,
        target: t.target,
        // Loops (e.g. reject → re-upload) leave from the side so they don't overlap the trunk.
        sourceHandle: isBack ? "loop-out" : undefined,
        targetHandle: isBack ? "loop-in" : undefined,
        type: isBack ? "default" : "smoothstep",
        className: cls,
        pathOptions: { borderRadius: 16 },
        focusable: false,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
        label: active || isBack ? t.condition.replace(/_/g, " ") : undefined,
        labelStyle: { fontSize: 10, fontWeight: 600, fill: active ? "#0a6a62" : "#6c7687", fontFamily: "inherit" },
        labelBgStyle: { fill: active ? "#e9f8f6" : "#ffffff", stroke: active ? "#95dfd6" : "#e6e8ee", strokeWidth: 1 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      };
    }),
  );
  return { nodes, edges };
}

/** Neighbourhood of the active state: itself, its predecessors and its targets. */
function focusSet(detail: WorkflowDetail): string[] {
  const active = detail.current_state;
  if (!active) return [];
  const ids = new Set<string>([active]);
  for (const s of detail.states) {
    if (s.id === active) s.transitions.forEach((t) => ids.add(t.target));
    else if (s.transitions.some((t) => t.target === active)) ids.add(s.id);
  }
  return [...ids];
}

function CameraController({ detail, camera }: { detail: WorkflowDetail; camera: Camera }) {
  const { fitView } = useReactFlow();
  const active = detail.current_state;
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (camera === "all") {
        void fitView({ padding: 0.1, duration: 600, maxZoom: 1 });
      } else {
        const ids = focusSet(detail);
        void fitView({
          nodes: ids.map((i) => ({ id: i })),
          padding: 0.35,
          duration: 650,
          maxZoom: 1,
          minZoom: 0.6,
        });
      }
    }, 80);
    return () => window.clearTimeout(id);
    // Re-frame when the run moves to a new state or the camera mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.workflow_id, active, detail.status, camera]);
  return null;
}

export function WorkflowGraph({ detail, loading, horizontal = false, className }: WorkflowGraphProps) {
  const [camera, setCamera] = useState<Camera>("follow");
  const { nodes, edges } = useMemo(
    () => (detail ? buildGraph(detail, horizontal) : { nodes: [], edges: [] }),
    [detail, horizontal],
  );

  if (loading) return <GraphSkeleton />;

  if (!detail) {
    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          icon={Workflow}
          title="No workflow yet"
          body="Describe a goal and the planner will lay out every step, gate and outcome here."
        />
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full", className)}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.6}
          nodesConnectable={false}
          nodesDraggable={false}
          elementsSelectable={false}
          panOnScroll
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="#d3d7df" />
          <Controls showInteractive={false} position="bottom-left" />
          <CameraController detail={detail} camera={camera} />
        </ReactFlow>
      </ReactFlowProvider>

      <div className="absolute right-3 top-3 z-10 inline-flex rounded-lg border border-line bg-surface p-0.5 shadow-raised" role="radiogroup" aria-label="Camera">
        {(
          [
            { id: "follow", icon: Crosshair, label: "Follow the active state" },
            { id: "all", icon: Maximize2, label: "Fit the whole workflow" },
          ] as const
        ).map(({ id, icon: Icon, label }) => (
          <Tooltip key={id} label={label} side="left">
            <button
              type="button"
              role="radio"
              aria-checked={camera === id}
              aria-label={label}
              onClick={() => setCamera(id)}
              className={cn(
                "grid h-7 w-7 place-items-center rounded-md transition",
                camera === id ? "bg-ink-950 text-white" : "text-ink-500 hover:bg-canvas hover:text-ink-900",
              )}
            >
              <Icon size={13} />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function GraphSkeleton() {
  return (
    <div className="relative h-full w-full overflow-hidden" role="status" aria-label="Planning workflow">
      <div
        className="absolute inset-0 opacity-70"
        style={{ backgroundImage: "radial-gradient(#d3d7df 1.2px, transparent 1.2px)", backgroundSize: "20px 20px" }}
      />
      <div className="relative flex h-full flex-col items-center justify-center gap-5 px-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col items-center gap-5">
            <div className="flex items-center gap-6">
              <Skeleton className="h-[84px] w-[220px] rounded-2xl" style={{ animationDelay: `${i * 120}ms` }} />
              {(i === 1 || i === 2) && (
                <Skeleton className="h-[84px] w-[220px] rounded-2xl opacity-50" style={{ animationDelay: `${i * 160}ms` }} />
              )}
            </div>
            {i < 3 && <Skeleton className="h-6 w-0.5 rounded-full" />}
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-6 flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-700 shadow-raised">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
          Planning workflow with the model…
        </span>
      </div>
    </div>
  );
}
