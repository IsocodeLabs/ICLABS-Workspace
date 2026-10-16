import ELK from "elkjs/lib/elk.bundled.js";
import { TERMINALS, type WorkflowConfig } from "@iclabs/core/workflow";

const elk = new ELK();

/** Tidy left-to-right layout of stages and end points. */
export async function autoLayout(
  config: WorkflowConfig,
): Promise<Record<string, { x: number; y: number }>> {
  const usedTerminals = TERMINALS.filter((t) => config.edges.some((e) => e.to === t));
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.nodeNode": "60",
    },
    children: [
      ...config.nodes.map((n) => ({ id: n.id, width: 260, height: 150 })),
      ...usedTerminals.map((t) => ({ id: t, width: 170, height: 40 })),
    ],
    edges: config.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  });
  return Object.fromEntries(
    (graph.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]),
  );
}
