import type { WorkflowConfig } from "./schema";

/** Human-readable changes between the live version and a draft, for the Publish dialog. */
export function diffWorkflows(live: WorkflowConfig | null, draft: WorkflowConfig): string[] {
  if (!live)
    return [`New process with ${draft.nodes.length} stage${draft.nodes.length === 1 ? "" : "s"}`];
  const changes: string[] = [];
  const liveNodes = new Map(live.nodes.map((n) => [n.id, n]));
  const draftNodes = new Map(draft.nodes.map((n) => [n.id, n]));

  for (const n of draft.nodes) {
    const before = liveNodes.get(n.id);
    if (!before) changes.push(`Added stage "${n.title}"`);
    else if (JSON.stringify({ ...before, title: "" }) !== JSON.stringify({ ...n, title: "" })) {
      changes.push(`Changed stage "${n.title}"`);
    } else if (before.title !== n.title) changes.push(`Renamed "${before.title}" to "${n.title}"`);
  }
  for (const n of live.nodes) if (!draftNodes.has(n.id)) changes.push(`Removed stage "${n.title}"`);

  const edgeKey = (e: WorkflowConfig["edges"][number]) =>
    JSON.stringify([e.from, e.to, e.priority, e.when, e.autoReject]);
  const liveEdges = new Set(live.edges.map(edgeKey));
  const draftEdges = new Set(draft.edges.map(edgeKey));
  const edgesChanged =
    live.edges.length !== draft.edges.length || [...draftEdges].some((k) => !liveEdges.has(k));
  if (edgesChanged) changes.push("Changed connections or rules");

  if (JSON.stringify(live.scoring) !== JSON.stringify(draft.scoring))
    changes.push("Changed score weights");
  return changes;
}
