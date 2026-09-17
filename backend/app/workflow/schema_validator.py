"""Structural + safety validation for generated workflows.

A workflow that fails validation is NEVER executed. The generator retries exactly once
then reports `workflow_generation_failed`.

Checks implemented here:
  1. unique state ids
  2. initial/terminal states exist and are distinct
  3. every transition target exists
  4. terminal states have no outgoing transitions; non-terminal states have >= 1
  5. every transition condition is a known, registered predicate
  6. every state is reachable from the initial state
  7. at least one terminal state is reachable
  8. no uncontrolled execution: on every path to an `execution` state there is at
     least one prior `human_approval` state
  9. no automatic-only cycles (every cycle passes a human-gated state), preventing
     an autonomous infinite loop
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Deque, Set, Tuple

from ..models.enums import StateType
from ..models.workflow import State, Workflow
from .conditions import is_known_condition, known_conditions
from .errors import WorkflowValidationError

GATED_TYPES = {StateType.USER_INPUT, StateType.DOCUMENT_REQUIRED, StateType.HUMAN_APPROVAL}


@dataclass
class ValidationReport:
    valid: bool
    errors: list[str] = field(default_factory=list)


def _report(errors: list[str]) -> ValidationReport:
    return ValidationReport(valid=not errors, errors=errors)


def validate(workflow: Workflow) -> ValidationReport:
    errors: list[str] = []
    states = workflow.state_map()

    # 1. unique ids (dict already de-duplicates; compare ordering)
    if len(states) != len(workflow.states):
        errors.append("duplicate state ids are not allowed")

    # 2. initial / terminal existence
    if workflow.initial_state not in states:
        errors.append(f"initial_state '{workflow.initial_state}' does not exist")
    for t in workflow.terminal_states:
        if t not in states:
            errors.append(f"terminal_state '{t}' does not exist")
    if not workflow.terminal_states:
        errors.append("workflow must define at least one terminal state")
    if workflow.initial_state and workflow.initial_state in workflow.terminal_states:
        errors.append("initial_state cannot be terminal")

    # 3/4/5. transitions
    for s in workflow.states:
        target_types = []
        for tr in s.transitions:
            if tr.target not in states:
                errors.append(f"state '{s.id}' transitions to unknown state '{tr.target}'")
            if not is_known_condition(tr.condition):
                errors.append(
                    f"state '{s.id}' uses unknown condition '{tr.condition}'. "
                    f"known: {sorted(known_conditions())}"
                )
            target_types.append(states.get(tr.target).type if tr.target in states else None)
        if s.type == StateType.TERMINAL and s.transitions:
            errors.append(f"terminal state '{s.id}' has outgoing transitions")
        if s.type != StateType.TERMINAL and not s.transitions:
            errors.append(f"non-terminal state '{s.id}' has no outgoing transitions")
        if any(tt is None for tt in target_types):
            continue
        if s.type == StateType.EXECUTION and StateType.EXECUTION in target_types:
            errors.append(f"execution state '{s.id}' must not chain directly to another execution state")

    _walk_checks(workflow, errors)
    return _report(errors)


def _walk_checks(workflow: Workflow, errors: list[str]) -> None:
    """Reachability, approval-precedes-execution, and cycle gating."""
    states = workflow.state_map()
    initial = workflow.initial_state
    if initial not in states:
        return

    reachable = _reachable(states, initial)

    # 6. every state reachable
    for s in workflow.states:
        if s.id not in reachable:
            errors.append(f"state '{s.id}' is unreachable from the initial state")

    # 7. terminal reachable
    terminal_reach = {t for t in workflow.terminal_states if t in reachable}
    if not terminal_reach:
        errors.append("no terminal state is reachable from the initial state")
    for t in workflow.terminal_states:
        if t in states and t not in terminal_reach:
            errors.append(f"terminal state '{t}' is unreachable")

    # 8. approval precedes execution on every path
    if _execution_without_approval(states, initial, reachable):
        errors.append(
            "unsafe workflow: an execution state is reachable without passing a "
            "human_approval state first"
        )

    # 9. every cycle passes a gated state (no automatic infinite loop)
    for cycle in _elementary_cycles(states, initial, reachable):
        if not any(states[n].type in GATED_TYPES for n in cycle):
            errors.append(
                f"uncontrolled loop detected: cycle [{', '.join(cycle)}] contains no "
                "human-gated state"
            )


def _reachable(states: dict[str, State], start: str) -> set[str]:
    seen: set[str] = set()
    stack = [start]
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        if node not in states:
            continue
        seen.add(node)
        state = states[node]
        for tr in state.transitions:
            if tr.target not in seen and tr.target in states:
                stack.append(tr.target)
    return seen


def _execution_without_approval(
    states: dict[str, State], initial: str, reachable: set[str]
) -> bool:
    """True if any path from `initial` reaches an execution state without having
    passed a human_approval state. Tracks (node, approved_yet) pairs."""
    execution_ids = {
        sid for sid in reachable if states[sid].type == StateType.EXECUTION
    }
    if not execution_ids:
        return False
    seen: Set[Tuple[str, bool]] = set()
    stack: Deque[Tuple[str, bool]] = Deque([(initial, False)])
    while stack:
        node, approved = stack.popleft()
        state = states.get(node)
        if state is None:
            continue
        if state.type == StateType.HUMAN_APPROVAL:
            approved = True
        if state.type == StateType.EXECUTION and not approved:
            return True
        for tr in state.transitions:
            key = (tr.target, approved)
            if key not in seen:
                seen.add(key)
                stack.append(key)
    return False


def _elementary_cycles(
    states: dict[str, State], initial: str, reachable: set[str]
) -> list[set[str]]:
    """Detect cycles in the reachable subgraph (cycle = set of nodes forming a loop)."""
    if initial not in states:
        return []
    adj = {sid: [tr.target for tr in states[sid].transitions] for sid in reachable}

    # Use Tarjan SCC to find real cycles (node sets with >1 node or self-loop).
    sccs = _tarjan(adj)
    cycles: list[set[str]] = []
    for scc in sccs:
        if len(scc) > 1:
            cycles.append(scc)
        else:
            node = next(iter(scc))
            if adj.get(node) and node in adj[node]:
                cycles.append({node})
    return cycles


def _tarjan(adj: dict[str, list[str]]) -> list[set[str]]:
    index: dict[str, int] = {}
    low: dict[str, int] = {}
    on_stack: dict[str, bool] = {}
    stack: list[str] = []
    sccs: list[set[str]] = []
    counter = [0]

    def strongconnect(v: str) -> None:
        index[v] = low[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on_stack[v] = True
        for w in adj.get(v, []):
            if w not in index:
                strongconnect(w)
                low[v] = min(low[v], low[w])
            elif on_stack.get(w, False):
                low[v] = min(low[v], index[w])
        if low[v] == index[v]:
            comp: set[str] = set()
            while True:
                w = stack.pop()
                on_stack[w] = False
                comp.add(w)
                if w == v:
                    break
            sccs.append(comp)

    for v in adj:
        if v not in index:
            strongconnect(v)
    return sccs


def validate_or_raise(workflow: Workflow) -> None:
    report = validate(workflow)
    if not report.valid:
        raise WorkflowValidationError(
            f"workflow '{workflow.workflow_id}' failed validation",
            errors=report.errors,
        )
