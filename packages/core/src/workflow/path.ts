import { isTerminal, type WorkflowConfig, type WorkflowNode } from "./schema";

/** The stage a candidate starts on: the only stage nothing points to. */
export function entryNodeId(config: WorkflowConfig): string | null {
  const targets = new Set(config.edges.map((e) => e.to));
  return config.nodes.find((n) => !targets.has(n.id))?.id ?? null;
}

/**
 * The "happy path" a candidate sees on their timeline: from the start, follow the first
 * rule path at each stage (the one most candidates take), keeping candidate-facing stages.
 */
export function candidatePath(config: WorkflowConfig): WorkflowNode[] {
  const byId = new Map(config.nodes.map((n) => [n.id, n]));
  const path: WorkflowNode[] = [];
  const seen = new Set<string>();
  let current = entryNodeId(config);
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = byId.get(current);
    if (!node) break;
    if (node.visibility === "candidate") path.push(node);
    const next = config.edges
      .filter((e) => e.from === current && !isTerminal(e.to))
      .sort((a, b) => a.priority - b.priority)[0];
    current = next?.to ?? null;
  }
  return path;
}
