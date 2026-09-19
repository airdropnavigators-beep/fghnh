/**
 * Deterministic auto-layout for the workflow graph (top-down by default).
 *
 * 1. DFS from the initial state marks back-edges (loops such as
 *    "reject → re-upload documents") so they never push a node downstream.
 * 2. Longest-path layering over the remaining DAG puts every state below all
 *    of its predecessors.
 * 3. Within a layer the "happy path" (first transition of each state) sits on
 *    the centre column; alternative branches fan out left/right.
 */

import type { Transition, WorkflowState } from "../types";

export interface LayoutPos {
  id: string;
  x: number;
  y: number;
  /** 0-based layer (execution depth). */
  layer: number;
  /** True when the node is on the primary path from the initial state. */
  primary: boolean;
}

export type LayoutDirection = "vertical" | "horizontal";

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  /** Gap between layers (along the flow). */
  layerGap?: number;
  /** Gap between siblings (across the flow). */
  siblingGap?: number;
  direction?: LayoutDirection;
}

const DEFAULTS: Required<LayoutOptions> = {
  nodeWidth: 232,
  nodeHeight: 96,
  layerGap: 44,
  siblingGap: 28,
  direction: "vertical",
};

/** Pick the initial state: explicit id if present, else the only state nothing points at. */
export function findInitialState(states: WorkflowState[], preferred?: string | null): string {
  if (preferred && states.some((s) => s.id === preferred)) return preferred;
  const targets = new Set(states.flatMap((s) => s.transitions.map((t) => t.target)));
  const roots = states.filter((s) => !targets.has(s.id));
  return (roots[0] ?? states[0])?.id ?? "";
}

/** Edges that close a cycle when walking from `start` (source→target pairs). */
export function findBackEdges(states: WorkflowState[], start: string): Set<string> {
  const byId = new Map(states.map((s) => [s.id, s]));
  const back = new Set<string>();
  const state = new Map<string, "open" | "done">();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const t of byId.get(id)?.transitions ?? []) {
      if (!byId.has(t.target)) continue;
      const st = state.get(t.target);
      if (st === "open") back.add(`${id}->${t.target}`);
      else if (!st) visit(t.target);
    }
    state.set(id, "done");
  };
  if (byId.has(start)) visit(start);
  for (const s of states) if (!state.has(s.id)) visit(s.id);
  return back;
}

export function layout(states: WorkflowState[], initial: string, opts: LayoutOptions = {}): LayoutPos[] {
  const { nodeWidth, nodeHeight, layerGap, siblingGap, direction } = { ...DEFAULTS, ...opts };
  if (states.length === 0) return [];

  const byId = new Map(states.map((s) => [s.id, s]));
  const start = byId.has(initial) ? initial : findInitialState(states);
  const back = findBackEdges(states, start);
  const forward = (from: string, to: string) => byId.has(to) && !back.has(`${from}->${to}`);

  // Topological order (Kahn) over forward edges, seeded from `start` for stability.
  const indeg = new Map<string, number>(states.map((s) => [s.id, 0]));
  for (const s of states) for (const t of s.transitions) if (forward(s.id, t.target)) indeg.set(t.target, (indeg.get(t.target) ?? 0) + 1);
  const queue = [start, ...states.map((s) => s.id).filter((id) => id !== start && indeg.get(id) === 0)];
  const topo: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    topo.push(id);
    for (const t of byId.get(id)?.transitions ?? []) {
      if (!forward(id, t.target)) continue;
      indeg.set(t.target, (indeg.get(t.target) ?? 1) - 1);
      if (indeg.get(t.target) === 0) queue.push(t.target);
    }
  }
  for (const s of states) if (!seen.has(s.id)) topo.push(s.id); // safety: anything left over

  // Longest-path layers + primary path (follow first forward transition).
  const layer = new Map<string, number>([[start, 0]]);
  for (const id of topo) {
    const l = layer.get(id) ?? 0;
    layer.set(id, l);
    for (const t of byId.get(id)?.transitions ?? []) {
      if (!forward(id, t.target)) continue;
      layer.set(t.target, Math.max(layer.get(t.target) ?? 0, l + 1));
    }
  }
  const primary = new Set<string>();
  let cursor: string | undefined = start;
  while (cursor && !primary.has(cursor)) {
    const here: string = cursor;
    primary.add(here);
    const next: Transition | undefined = byId.get(here)?.transitions.find((t) => forward(here, t.target));
    cursor = next?.target;
  }

  // Group by layer preserving topo order; centre the primary node, alternate the rest.
  const layers: string[][] = [];
  for (const id of topo) (layers[layer.get(id) ?? 0] ??= []).push(id);
  const slot = new Map<string, number>();
  for (const col of layers) {
    if (!col) continue;
    const main = col.find((id) => primary.has(id)) ?? col[0];
    slot.set(main, 0);
    let k = 1;
    for (const id of col) {
      if (id === main) continue;
      slot.set(id, k % 2 ? Math.ceil(k / 2) : -Math.ceil(k / 2));
      k++;
    }
  }

  const stepAlong = (direction === "vertical" ? nodeHeight : nodeWidth) + layerGap;
  const stepAcross = (direction === "vertical" ? nodeWidth : nodeHeight) + siblingGap;
  return states.map((s) => {
    const l = layer.get(s.id) ?? 0;
    const k = slot.get(s.id) ?? 0;
    const along = l * stepAlong;
    const across = k * stepAcross;
    return direction === "vertical"
      ? { id: s.id, x: across, y: along, layer: l, primary: primary.has(s.id) }
      : { id: s.id, x: along, y: across, layer: l, primary: primary.has(s.id) };
  });
}
