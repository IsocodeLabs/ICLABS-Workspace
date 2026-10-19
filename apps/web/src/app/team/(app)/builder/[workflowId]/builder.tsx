"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useStore } from "zustand";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  LayoutGrid,
  ListTree,
  Redo2,
  Rocket,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  NODE_TYPES,
  STAGE_TYPES,
  TERMINALS,
  describeCondition,
  diffWorkflows,
  isTerminal,
  validateWorkflow,
  type NodeType,
  type WorkflowConfig,
} from "@iclabs/core/workflow";
import { Btn, Input } from "@/components/admin";
import { ConfirmDialog, Dialog } from "@/components/dialog";
import { Alert } from "@/components/ui";
import {
  applyTemplateAction,
  publishAction,
  saveDraftAction,
  saveTemplateAction,
} from "../../actions";
import { autoLayout } from "./auto-layout";
import { RuleEdge, StageNode, STAGE_ICONS, TerminalNode, type StageNodeData } from "./canvas-nodes";
import { EdgeInspector } from "./edge-inspector";
import { Inspector, type TeamOption } from "./inspector";
import { createBuilderStore } from "./store";

export type BuilderProps = {
  workflow: { id: string; name: string };
  cycle: { id: string; name: string };
  role: { id: string; title: string };
  draft: { id: string; version: number; config: WorkflowConfig; etag: string } | null;
  published: { version: number; config: WorkflowConfig } | null;
  team: TeamOption[];
  templates: { id: string; name: string }[];
  canEdit: boolean;
  canPublish: boolean;
};

const nodeTypes = { stage: StageNode, terminal: TerminalNode };
const edgeTypes = { rule: RuleEdge };
type SaveState = "saved" | "saving" | "unsaved" | "conflict" | "error";

export function Builder(props: BuilderProps) {
  return (
    <ReactFlowProvider>
      <BuilderInner {...props} />
    </ReactFlowProvider>
  );
}

function BuilderInner({
  workflow,
  cycle,
  role,
  draft,
  published,
  team,
  templates,
  canEdit,
  canPublish,
}: BuilderProps) {
  const router = useRouter();
  const readOnly = !canEdit || !draft;
  const [useBuilder] = useState(() =>
    createBuilderStore(draft?.config ?? published?.config ?? emptyConfig()),
  );
  const config = useBuilder((s) => s.config);
  const selection = useBuilder((s) => s.selection);
  const actions = useBuilder.getState();
  const canUndo = useStore(useBuilder.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useBuilder.temporal, (s) => s.futureStates.length > 0);
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Canvas nodes live in local state so React Flow can apply its own changes (measuring, dragging).
  // The process config stays the source of truth: positions are committed on drag stop.
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [outline, setOutline] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<typeof selection>(null);
  // Trash bin: drop a stage on it, or click it to delete the current selection.
  const trashRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const colorMode = useColorMode();

  // ─── Validation ────────────────────────────────────────────────────────────
  const issues = useMemo(() => validateWorkflow(config), [config]);
  const errors = issues.filter((i) => i.severity === "error");
  const nodeStatus = useMemo(() => {
    const status: Record<string, StageNodeData["status"]> = {};
    for (const i of issues) {
      if (!i.nodeId) continue;
      if (i.severity === "error") status[i.nodeId] = "error";
      else status[i.nodeId] ??= "warning";
    }
    return status;
  }, [issues]);

  // ─── Autosave (debounced, optimistic concurrency) ──────────────────────────
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const etag = useRef(draft?.etag ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (readOnly) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveState("unsaved");
    const timer = setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await saveDraftAction({
          workflowId: workflow.id,
          versionId: draft!.id,
          config,
          etag: etag.current,
        });
        if (res.ok) {
          etag.current = res.etag;
          setSaveState("saved");
        } else setSaveState(res.reason === "conflict" ? "conflict" : "error");
      } catch {
        setSaveState("error");
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [config, readOnly, workflow.id, draft]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === "unsaved" || saveState === "saving") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  // ─── Canvas model ──────────────────────────────────────────────────────────
  const terminalDefaults = useMemo(() => {
    const xs = Object.values(config.layout).map((p) => p.x);
    const x = (xs.length ? Math.max(...xs) : 0) + 360;
    return Object.fromEntries(TERMINALS.map((t, i) => [t, { x, y: i * 110 }]));
  }, [config.layout]);

  const titles = useMemo(
    () => Object.fromEntries(config.nodes.map((n) => [n.id, n.title])),
    [config.nodes],
  );
  const usedTerminals = useMemo(
    () => TERMINALS.filter((t) => config.edges.some((e) => e.to === t) || !readOnly),
    [config.edges, readOnly],
  );

  const desiredNodes: Node[] = useMemo(
    () => [
      ...config.nodes.map((n, i) => ({
        id: n.id,
        type: "stage",
        position: config.layout[n.id] ?? { x: i * 340, y: 0 },
        data: {
          node: n,
          status: nodeStatus[n.id] ?? "ready",
          selected: selection?.kind === "node" && selection.id === n.id,
        } satisfies StageNodeData,
      })),
      ...usedTerminals.map((t) => ({
        id: t,
        type: "terminal",
        position: config.layout[t] ?? terminalDefaults[t]!,
        data: {},
      })),
    ],
    [config.nodes, config.layout, nodeStatus, selection, usedTerminals, terminalDefaults],
  );

  useEffect(() => {
    setRfNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return desiredNodes.map((d) => {
        const p = byId.get(d.id);
        return p
          ? { ...p, ...d, position: p.dragging ? p.position : d.position, measured: p.measured }
          : d;
      });
    });
  }, [desiredNodes]);

  const rfEdges: Edge[] = useMemo(
    () =>
      config.edges.map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        type: "rule",
        markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        data: {
          label: describeCondition(e.when),
          autoReject: !!e.autoReject,
          fallback: "always" in e.when,
          selected: selection?.kind === "edge" && selection.id === e.id,
        },
      })),
    [config.edges, selection],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const allowed = readOnly ? changes.filter((c) => c.type === "dimensions") : changes;
      setRfNodes((nds) => applyNodeChanges(allowed, nds));
    },
    [readOnly],
  );

  const isOverTrash = (e: MouseEvent | TouchEvent) => {
    const p = "changedTouches" in e ? e.changedTouches[0] : e;
    const r = trashRef.current?.getBoundingClientRect();
    return (
      !!p &&
      !!r &&
      p.clientX >= r.left &&
      p.clientX <= r.right &&
      p.clientY >= r.top &&
      p.clientY <= r.bottom
    );
  };

  const onNodeDrag = useCallback(
    (e: MouseEvent | TouchEvent, node: Node) => {
      if (readOnly || isTerminal(node.id)) return;
      setDragging(true);
      setOverTrash(isOverTrash(e));
    },
    [readOnly],
  );

  const onNodeDragStop = useCallback(
    (e: MouseEvent | TouchEvent, node: Node) => {
      setDragging(false);
      setOverTrash(false);
      if (readOnly) return;
      if (!isTerminal(node.id) && isOverTrash(e)) {
        // Snap back to where it was; the confirm dialog decides whether it goes.
        const back = config.layout[node.id];
        if (back)
          setRfNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, position: back } : n)));
        setPendingDelete({ kind: "node", id: node.id });
        return;
      }
      actions.move({ [node.id]: node.position });
    },
    [actions, readOnly, config.layout],
  );

  const deletable =
    !!selection && !(selection.kind === "node" && isTerminal(selection.id)) && !readOnly;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-stage") as NodeType;
    if (readOnly || !NODE_TYPES.includes(type)) return;
    actions.addNode(type, screenToFlowPosition({ x: e.clientX - 130, y: e.clientY - 40 }));
  };

  const addAtCenter = (type: NodeType) => {
    const xs = config.nodes.map((n) => config.layout[n.id]?.x ?? 0);
    actions.addNode(type, { x: (xs.length ? Math.max(...xs) : -340) + 340, y: 40 });
  };

  const tidy = async () => {
    actions.move(await autoLayout(config));
    requestAnimationFrame(() => fitView({ padding: 0.2, duration: 300 }));
  };

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true], dialog")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useBuilder.temporal.getState().redo();
        else useBuilder.temporal.getState().undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useBuilder.temporal.getState().redo();
      } else if (mod && e.key.toLowerCase() === "d" && selection?.kind === "node" && !readOnly) {
        e.preventDefault();
        actions.duplicateNode(selection.id);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection && !readOnly) {
        if (selection.kind === "node" && isTerminal(selection.id)) return;
        e.preventDefault();
        setPendingDelete(selection);
      } else if (e.key === "Escape") actions.select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions, selection, readOnly, useBuilder]);

  const selectedNode =
    selection?.kind === "node" ? config.nodes.find((n) => n.id === selection.id) : undefined;
  const selectedEdge =
    selection?.kind === "edge" ? config.edges.find((e) => e.id === selection.id) : undefined;

  const reorderEdge = (edgeId: string, dir: -1 | 1) => {
    const edge = config.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const siblings = config.edges
      .filter((e) => e.from === edge.from)
      .sort((a, b) => a.priority - b.priority);
    const i = siblings.findIndex((e) => e.id === edgeId);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    const other = siblings[j]!;
    actions.updateEdge(edge.id, { priority: other.priority });
    actions.updateEdge(other.id, {
      priority: edge.priority === other.priority ? other.priority - dir : edge.priority,
    });
  };

  return (
    <div className="flex h-[calc(100dvh-57px)] flex-col">
      <TopBar
        title={`${role.title} · ${cycle.name} · ${workflow.name}`}
        cycleId={cycle.id}
        draftVersion={draft?.version}
        publishedVersion={published?.version}
        saveState={readOnly ? null : saveState}
        canUndo={canUndo && !readOnly}
        canRedo={canRedo && !readOnly}
        onUndo={() => useBuilder.temporal.getState().undo()}
        onRedo={() => useBuilder.temporal.getState().redo()}
        onTidy={tidy}
        outline={outline}
        onToggleOutline={() => setOutline((o) => !o)}
        errorCount={errors.length}
        warningCount={issues.length - errors.length}
        onShowIssues={() => actions.select(null)}
        canPublish={canPublish && !!draft}
        onPublish={() => setPublishOpen(true)}
        templateMenu={
          readOnly ? null : (
            <TemplateMenu
              workflowId={workflow.id}
              templates={templates}
              onApplied={() => router.refresh()}
            />
          )
        }
      />
      {saveState === "conflict" && (
        <div className="border-b border-border bg-warning-bg px-4 py-2 text-sm text-warning-fg">
          Someone else saved this draft. Your latest changes weren't saved.{" "}
          <button className="font-semibold underline" onClick={() => router.refresh()}>
            Reload their version
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {!readOnly && <Palette onAdd={addAtCenter} />}

        <div
          className="relative min-w-0 flex-1"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          {outline ? (
            <OutlineView
              config={config}
              onSelect={(id) => actions.select({ kind: "node", id })}
              selectedId={selection?.id}
            />
          ) : (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onConnect={(c) =>
                !readOnly && c.source && c.target && actions.connect(c.source, c.target)
              }
              onNodeClick={(_, n) =>
                !isTerminal(n.id) && actions.select({ kind: "node", id: n.id })
              }
              onEdgeClick={(_, e) => actions.select({ kind: "edge", id: e.id })}
              onPaneClick={() => actions.select(null)}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.3}
              proOptions={{ hideAttribution: true }}
              colorMode={colorMode}
              className="bg-bg"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1.4}
                color="var(--border)"
              />
              <Controls
                showInteractive={false}
                className="!rounded-xl !border !border-border !shadow-card"
              />
              <MiniMap
                pannable
                zoomable
                className="!rounded-xl !border !border-border !bg-surface"
                nodeColor={(n) =>
                  n.type === "terminal" ? "var(--text-muted)" : "var(--brand-500)"
                }
              />
            </ReactFlow>
          )}
          {!readOnly && !outline && (
            <button
              ref={trashRef}
              type="button"
              aria-label={deletable ? "Delete selected" : "Trash: drag a stage here to delete it"}
              title={deletable ? "Delete selected" : "Drag a stage here to delete it"}
              disabled={!deletable && !dragging}
              onClick={() => deletable && setPendingDelete(selection)}
              className={`absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-card transition ${
                overTrash
                  ? "scale-110 border-danger-fg bg-danger-bg text-danger-fg"
                  : dragging
                    ? "border-danger-fg bg-surface text-danger-fg"
                    : deletable
                      ? "border-border bg-surface text-text hover:border-danger-fg hover:text-danger-fg"
                      : "border-border bg-surface text-muted"
              }`}
            >
              <Trash2 size={18} aria-hidden />
              {overTrash
                ? "Release to delete"
                : dragging
                  ? "Drop here to delete"
                  : deletable
                    ? "Delete selected"
                    : "Trash"}
            </button>
          )}
          {config.nodes.length === 0 && !outline && (
            <EmptyCanvas readOnly={readOnly} onStart={(type) => addAtCenter(type)} />
          )}
        </div>

        <aside
          className="w-[360px] shrink-0 border-l border-border bg-surface"
          aria-label="Inspector"
        >
          {selectedNode ? (
            <Inspector
              key={selectedNode.id}
              node={selectedNode}
              config={config}
              team={team}
              readOnly={readOnly}
              update={(fn) => actions.updateNode(selectedNode.id, fn)}
              setWeight={(w) => actions.setWeight(selectedNode.id, w)}
              connect={(to) => actions.connect(selectedNode.id, to)}
              selectEdge={(id) => actions.select({ kind: "edge", id })}
              remove={() => actions.removeNode(selectedNode.id)}
            />
          ) : selectedEdge ? (
            <EdgeInspector
              key={selectedEdge.id}
              edge={selectedEdge}
              config={config}
              readOnly={readOnly}
              update={(patch) => actions.updateEdge(selectedEdge.id, patch)}
              remove={() => actions.removeEdge(selectedEdge.id)}
              reorder={(d) => reorderEdge(selectedEdge.id, d)}
            />
          ) : (
            <IssuesPanel
              issues={issues}
              titles={titles}
              onSelect={(id) => actions.select({ kind: "node", id })}
              readOnly={readOnly}
            />
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === "edge"
            ? "Delete this path?"
            : `Delete "${titles[pendingDelete?.id ?? ""] ?? "stage"}"?`
        }
        body={
          pendingDelete?.kind === "edge"
            ? "Candidates matching this rule will fall through to the next one."
            : "Its connections and score weight are removed too. Undo with Ctrl+Z."
        }
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete?.kind === "edge") actions.removeEdge(pendingDelete.id);
          else if (pendingDelete) actions.removeNode(pendingDelete.id);
          setPendingDelete(null);
        }}
      />

      {draft && (
        <PublishDialog
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
          changes={diffWorkflows(published?.config ?? null, config)}
          errors={errors.map((e) => e.message)}
          autoRejects={issues.filter((i) => i.code === "auto_reject").map((i) => i.message)}
          unsaved={saveState !== "saved"}
          onPublish={async () => {
            const res = await publishAction({ workflowId: workflow.id, versionId: draft.id });
            if (res.ok) router.refresh();
            return res;
          }}
        />
      )}
    </div>
  );
}

/** Follows the OS theme after mount (server render is always light, so hydration matches). */
function useColorMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setMode(mq.matches ? "dark" : "light");
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return mode;
}

function emptyConfig(): WorkflowConfig {
  return { schemaVersion: 1, nodes: [], edges: [], scoring: { weights: {} }, layout: {} };
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function TopBar(p: {
  title: string;
  cycleId: string;
  draftVersion?: number;
  publishedVersion?: number;
  saveState: SaveState | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTidy: () => void;
  outline: boolean;
  onToggleOutline: () => void;
  errorCount: number;
  warningCount: number;
  onShowIssues: () => void;
  canPublish: boolean;
  onPublish: () => void;
  templateMenu: React.ReactNode;
}) {
  const saveLabel = {
    saved: "Saved",
    saving: "Saving…",
    unsaved: "Unsaved changes",
    conflict: "Not saved",
    error: "Couldn't save. Retrying on next change",
  } as const;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
      <Link
        href={`/team/roles/cycles/${p.cycleId}`}
        className="rounded-lg p-1.5 text-muted hover:bg-neutral-bg"
        aria-label="Back to round"
      >
        <ArrowLeft size={18} />
      </Link>
      <div className="mr-auto min-w-0">
        <div className="truncate font-display font-bold">{p.title}</div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {p.draftVersion ? <span>Draft v{p.draftVersion}</span> : <span>Read only</span>}
          {p.publishedVersion && <span>· Live v{p.publishedVersion}</span>}
          {p.saveState && (
            <span
              className={`flex items-center gap-1 ${p.saveState === "conflict" || p.saveState === "error" ? "text-danger-fg" : ""}`}
            >
              · <Save size={12} aria-hidden /> {saveLabel[p.saveState]}
            </span>
          )}
        </div>
      </div>
      <Btn
        size="sm"
        variant="ghost"
        onClick={p.onUndo}
        disabled={!p.canUndo}
        aria-label="Undo (Ctrl+Z)"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={16} />
      </Btn>
      <Btn
        size="sm"
        variant="ghost"
        onClick={p.onRedo}
        disabled={!p.canRedo}
        aria-label="Redo (Ctrl+Shift+Z)"
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 size={16} />
      </Btn>
      <Btn size="sm" variant="secondary" onClick={p.onTidy} title="Tidy layout">
        <LayoutGrid size={16} /> Tidy
      </Btn>
      <Btn
        size="sm"
        variant="secondary"
        onClick={p.onToggleOutline}
        aria-pressed={p.outline}
        title="Outline view"
      >
        <ListTree size={16} /> {p.outline ? "Canvas" : "Outline"}
      </Btn>
      {p.templateMenu}
      <button
        onClick={p.onShowIssues}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
          p.errorCount
            ? "bg-danger-bg text-danger-fg"
            : p.warningCount
              ? "bg-warning-bg text-warning-fg"
              : "bg-success-bg text-success-fg"
        }`}
      >
        {p.errorCount || p.warningCount ? (
          <AlertTriangle size={15} aria-hidden />
        ) : (
          <CheckCircle2 size={15} aria-hidden />
        )}
        {p.errorCount
          ? `${p.errorCount} to fix`
          : p.warningCount
            ? `${p.warningCount} to check`
            : "Ready"}
      </button>
      {p.canPublish && (
        <Btn variant="gradient" onClick={p.onPublish}>
          <Rocket size={16} /> Publish
        </Btn>
      )}
    </div>
  );
}

function Palette({ onAdd }: { onAdd: (t: NodeType) => void }) {
  return (
    <aside
      className="w-60 shrink-0 overflow-y-auto border-r border-border bg-surface p-3"
      aria-label="Stage palette"
    >
      <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Drag onto the canvas
      </div>
      <ul className="space-y-2">
        {NODE_TYPES.map((type) => {
          const meta = STAGE_TYPES[type];
          const Icon = STAGE_ICONS[type];
          return (
            <li key={type}>
              <button
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-stage", type);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onAdd(type)}
                aria-label={`Add ${meta.label} stage`}
                className="group flex w-full cursor-grab items-start gap-3 rounded-xl border border-border bg-surface p-2.5 text-left transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-card active:cursor-grabbing"
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
                  style={{ background: meta.color }}
                  aria-hidden
                >
                  <Icon size={17} />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{meta.label}</span>
                  <span className="block text-xs leading-snug text-muted">{meta.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 px-1 text-xs leading-relaxed text-muted">
        Connect stages by dragging from a card&apos;s right dot. Click a card or a path to edit it.
        Delete, Ctrl+D duplicate, Ctrl+Z undo.
      </p>
    </aside>
  );
}

function EmptyCanvas({ readOnly, onStart }: { readOnly: boolean; onStart: (t: NodeType) => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="pointer-events-auto max-w-md rounded-card border border-border bg-surface p-8 text-center shadow-card">
        <div
          className="mx-auto mb-4 h-1.5 w-16 rounded-full"
          style={{ background: "var(--accent-gradient)" }}
        />
        <h2 className="font-display text-xl font-bold">Design this selection process</h2>
        <p className="mt-2 text-muted">
          {readOnly
            ? "Nothing here yet."
            : "Drag stages from the left, or start with a form. Use Templates to reuse a process."}
        </p>
        {!readOnly && (
          <Btn className="mt-5" variant="gradient" onClick={() => onStart("form")}>
            Start with a form
          </Btn>
        )}
      </div>
    </div>
  );
}

function OutlineView({
  config,
  onSelect,
  selectedId,
}: {
  config: WorkflowConfig;
  onSelect: (id: string) => void;
  selectedId?: string;
}) {
  const ordered = [...config.nodes].sort(
    (a, b) => (config.layout[a.id]?.x ?? 0) - (config.layout[b.id]?.x ?? 0),
  );
  const titles = Object.fromEntries(config.nodes.map((n) => [n.id, n.title]));
  return (
    <ol className="mx-auto max-w-2xl space-y-3 overflow-y-auto p-6" aria-label="Process outline">
      {ordered.map((n, i) => (
        <li key={n.id}>
          <button
            onClick={() => onSelect(n.id)}
            aria-current={selectedId === n.id}
            className={`w-full rounded-card border bg-surface p-4 text-left shadow-card ${selectedId === n.id ? "border-brand-500" : "border-border"}`}
          >
            <div className="text-xs font-semibold uppercase text-muted">
              {i + 1}. {STAGE_TYPES[n.type].label}
            </div>
            <div className="font-display text-lg font-semibold">{n.title}</div>
            <ul className="mt-1 text-sm text-muted">
              {config.edges
                .filter((e) => e.from === n.id)
                .sort((a, b) => a.priority - b.priority)
                .map((e) => (
                  <li key={e.id}>
                    {describeCondition(e.when)} →{" "}
                    {isTerminal(e.to)
                      ? {
                          NEEDS_DECISION: "Needs decision",
                          END_REJECT: "Not progressing",
                          END_COMPLETE: "Completed",
                        }[e.to]
                      : titles[e.to]}
                  </li>
                ))}
            </ul>
          </button>
        </li>
      ))}
    </ol>
  );
}

function IssuesPanel({
  issues,
  titles,
  onSelect,
  readOnly,
}: {
  issues: ReturnType<typeof validateWorkflow>;
  titles: Record<string, string>;
  onSelect: (id: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="h-full overflow-y-auto p-5">
      <h2 className="font-display text-lg font-bold">{readOnly ? "Process" : "Checklist"}</h2>
      <p className="mt-1 text-sm text-muted">Click a stage or a path on the canvas to edit it.</p>
      {issues.length === 0 ? (
        <Alert tone="success">Everything is set up. Ready to publish.</Alert>
      ) : (
        <ul className="mt-4 space-y-2">
          {issues.map((i, k) => (
            <li key={k}>
              <button
                disabled={!i.nodeId}
                onClick={() => i.nodeId && onSelect(i.nodeId)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${i.severity === "error" ? "bg-danger-bg text-danger-fg" : "bg-warning-bg text-warning-fg"}`}
              >
                <span className="font-semibold">{i.severity === "error" ? "Fix" : "Check"}:</span>{" "}
                {i.message}
                {i.nodeId && titles[i.nodeId] && (
                  <span className="block text-xs opacity-80">Go to {titles[i.nodeId]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PublishDialog({
  open,
  onClose,
  changes,
  errors,
  autoRejects,
  unsaved,
  onPublish,
}: {
  open: boolean;
  onClose: () => void;
  changes: string[];
  errors: string[];
  autoRejects: string[];
  unsaved: boolean;
  onPublish: () => Promise<{ ok: boolean; errors?: string[] }>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const blocked =
    errors.length > 0 || unsaved || (autoRejects.length > 0 && !confirmed) || changes.length === 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Publish this process"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            variant="gradient"
            disabled={blocked || busy}
            onClick={async () => {
              setBusy(true);
              const res = await onPublish();
              setBusy(false);
              if (res.ok) onClose();
              else setServerErrors(res.errors ?? ["Couldn't publish."]);
            }}
          >
            <Rocket size={16} /> Publish
          </Btn>
        </>
      }
    >
      {errors.length > 0 ? (
        <Alert>
          Fix {errors.length} issue{errors.length === 1 ? "" : "s"} first (see the checklist).
        </Alert>
      ) : unsaved ? (
        <Alert tone="warning">Waiting for your latest changes to save…</Alert>
      ) : changes.length === 0 ? (
        <Alert tone="neutral">Nothing has changed since the live version.</Alert>
      ) : (
        <>
          <p className="mb-2 text-sm font-semibold">What changes</p>
          <ul className="mb-4 list-inside list-disc text-sm text-muted">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="text-sm text-muted">
            Candidates already in the process keep the version they started on. New invites use this
            one.
          </p>
        </>
      )}
      {autoRejects.length > 0 && errors.length === 0 && (
        <label className="mt-4 flex items-start gap-2 rounded-xl bg-warning-bg p-3 text-sm text-warning-fg">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {autoRejects.join(" ")} I confirm these rules may reject candidates without review.
          </span>
        </label>
      )}
      {serverErrors.map((e) => (
        <Alert key={e}>{e}</Alert>
      ))}
    </Dialog>
  );
}

function TemplateMenu({
  workflowId,
  templates,
  onApplied,
}: {
  workflowId: string;
  templates: { id: string; name: string }[];
  onApplied: () => void;
}) {
  const [mode, setMode] = useState<"none" | "save" | "apply">("none");
  const [name, setName] = useState("");
  const [pick, setPick] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <Btn size="sm" variant="secondary" onClick={() => setMode("apply")}>
        Templates
      </Btn>
      <Dialog
        open={mode === "apply"}
        onClose={() => setMode("none")}
        title="Templates"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setMode("save")}>
              Save this as a template
            </Btn>
            <Btn
              variant="danger"
              disabled={!pick}
              onClick={async () => {
                const res = await applyTemplateAction({ workflowId, templateId: pick });
                if (res.ok) {
                  setMode("none");
                  onApplied();
                } else setMessage("Couldn't apply the template. Reload and try again.");
              }}
            >
              Replace draft with template
            </Btn>
          </>
        }
      >
        {templates.length === 0 ? (
          <p className="text-muted">No templates yet. Save this process as the first one.</p>
        ) : (
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id}>
                <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-bg">
                  <input
                    type="radio"
                    name="template"
                    value={t.id}
                    checked={pick === t.id}
                    onChange={() => setPick(t.id)}
                  />
                  {t.name}
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted">
          Applying a template replaces this draft. The live version isn&apos;t affected until you
          publish.
        </p>
        {message && <Alert>{message}</Alert>}
      </Dialog>
      <Dialog
        open={mode === "save"}
        onClose={() => setMode("none")}
        title="Save as template"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setMode("none")}>
              Cancel
            </Btn>
            <Btn
              disabled={name.trim().length < 2}
              onClick={async () => {
                const res = await saveTemplateAction({ workflowId, name });
                setMessage(res.ok ? "Template saved." : res.error);
                if (res.ok) setMode("none");
              }}
            >
              Save template
            </Btn>
          </>
        }
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Intern – Standard"
          aria-label="Template name"
        />
      </Dialog>
    </>
  );
}
