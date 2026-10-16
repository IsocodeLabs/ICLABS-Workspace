"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  getSmoothStepPath,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gavel,
  HelpCircle,
  ListChecks,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  STAGE_TYPES,
  nodeSummary,
  type NodeType,
  type Terminal,
  type WorkflowNode,
} from "@iclabs/core/workflow";

export const STAGE_ICONS: Record<NodeType, LucideIcon> = {
  form: FileText,
  assessment: ListChecks,
  task: ClipboardList,
  review_gate: Gavel,
  custom: Sparkles,
  interview: CalendarClock,
};

export type StageNodeData = {
  node: WorkflowNode;
  status: "ready" | "warning" | "error";
  selected: boolean;
};

const STATUS = {
  ready: { label: "Ready", cls: "bg-success-bg text-success-fg" },
  warning: { label: "Check setup", cls: "bg-warning-bg text-warning-fg" },
  error: { label: "Needs setup", cls: "bg-danger-bg text-danger-fg" },
} as const;

/** A stage card: type colour on the icon chip and top edge, editable via the inspector. */
export const StageNode = memo(function StageNode({ data }: NodeProps & { data: StageNodeData }) {
  const { node, status, selected } = data;
  const meta = STAGE_TYPES[node.type];
  const Icon = STAGE_ICONS[node.type];
  return (
    <div
      className={`w-[260px] rounded-[16px] border bg-surface text-text transition-[box-shadow,transform] duration-200 ${
        selected ? "-translate-y-0.5 border-brand-500" : "border-border hover:-translate-y-0.5"
      }`}
      style={{
        borderTop: `3px solid ${meta.color}`,
        boxShadow: selected
          ? "0 0 0 2px var(--brand-500), 0 10px 30px rgb(109 74 255 / 0.25)"
          : "var(--shadow-card)",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-surface !bg-brand-500"
      />
      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
          style={{ background: meta.color }}
          aria-hidden
        >
          <Icon size={17} strokeWidth={2.2} />
        </span>
        <div className="min-w-0">
          <div className="truncate font-display text-[0.98rem] font-semibold leading-tight">
            {node.title}
          </div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">
            {meta.label}
            {node.visibility === "internal" ? " · Team only" : ""}
          </div>
        </div>
      </div>
      <ul className="space-y-0.5 px-4 pb-1 pt-2.5 text-[0.85rem] text-muted">
        {nodeSummary(node).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="px-4 pb-3.5 pt-1.5">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[status].cls}`}
        >
          {STATUS[status].label}
        </span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-surface !bg-brand-500"
      />
    </div>
  );
});

const TERMINAL_META: Record<Terminal, { label: string; icon: LucideIcon; cls: string }> = {
  NEEDS_DECISION: {
    label: "Needs decision",
    icon: HelpCircle,
    cls: "bg-warning-bg text-warning-fg",
  },
  END_REJECT: { label: "Not progressing", icon: XCircle, cls: "bg-danger-bg text-danger-fg" },
  END_COMPLETE: { label: "Completed", icon: CheckCircle2, cls: "bg-success-bg text-success-fg" },
};

/** Fixed end points a connection can lead to. */
export const TerminalNode = memo(function TerminalNode({ id }: NodeProps) {
  const meta = TERMINAL_META[id as Terminal];
  const Icon = meta.icon;
  return (
    <div
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-card ${meta.cls}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-surface !bg-brand-500"
      />
      <Icon size={16} aria-hidden />
      {meta.label}
    </div>
  );
});

export type RuleEdgeData = {
  label: string;
  autoReject: boolean;
  selected: boolean;
  fallback: boolean;
};

/** Connection with a clickable rule chip. */
export function RuleEdge(props: EdgeProps & { data?: RuleEdgeData }) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } =
    props;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });
  const selected = data?.selected;
  return (
    <>
      <BaseEdge
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected
            ? "var(--brand-500)"
            : data?.autoReject
              ? "var(--danger-fg)"
              : "var(--text-muted)",
          strokeWidth: selected ? 2.5 : 1.75,
          strokeDasharray: data?.fallback ? "6 5" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`nodrag nopan pointer-events-auto absolute rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
            selected
              ? "border-brand-500 bg-brand-soft text-brand-soft-fg"
              : "border-border bg-surface text-muted"
          }`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {data?.autoReject ? "⚠ " : ""}
          {data?.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
