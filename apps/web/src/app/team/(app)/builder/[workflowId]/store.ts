"use client";

import { create } from "zustand";
import { temporal } from "zundo";
import { ulid } from "ulid";
import {
  createNode,
  isTerminal,
  type NodeType,
  type WorkflowConfig,
  type WorkflowEdge,
  type WorkflowNode,
} from "@iclabs/core/workflow";

export type Selection = { kind: "node" | "edge"; id: string } | null;

type State = {
  config: WorkflowConfig;
  selection: Selection;
  select: (s: Selection) => void;
  replace: (config: WorkflowConfig) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => string;
  updateNode: (id: string, update: (node: WorkflowNode) => WorkflowNode) => void;
  removeNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  move: (positions: Record<string, { x: number; y: number }>) => void;
  connect: (from: string, to: string) => void;
  updateEdge: (id: string, patch: Partial<WorkflowEdge>) => void;
  removeEdge: (id: string) => void;
  setWeight: (nodeId: string, weight: number) => void;
};

/** Editor state. Only `config` is tracked for undo/redo (50 steps). */
export const createBuilderStore = (initial: WorkflowConfig) =>
  create<State>()(
    temporal(
      (set, get) => ({
        config: initial,
        selection: null,
        select: (selection) => set({ selection }),
        replace: (config) => set({ config, selection: null }),

        addNode: (type, position) => {
          const node = createNode(type);
          set(({ config }) => ({
            config: {
              ...config,
              nodes: [...config.nodes, node],
              layout: { ...config.layout, [node.id]: position },
            },
            selection: { kind: "node", id: node.id },
          }));
          return node.id;
        },

        updateNode: (id, update) =>
          set(({ config }) => ({
            config: { ...config, nodes: config.nodes.map((n) => (n.id === id ? update(n) : n)) },
          })),

        removeNode: (id) =>
          set(({ config }) => {
            const { [id]: _pos, ...layout } = config.layout;
            const { [id]: _w, ...weights } = config.scoring.weights;
            return {
              config: {
                ...config,
                nodes: config.nodes.filter((n) => n.id !== id),
                edges: config.edges.filter((e) => e.from !== id && e.to !== id),
                layout,
                scoring: { weights },
              },
              selection: null,
            };
          }),

        duplicateNode: (id) => {
          const original = get().config.nodes.find((n) => n.id === id);
          if (!original) return;
          const copy = {
            ...structuredClone(original),
            id: ulid(),
            title: `${original.title} (copy)`,
          };
          const pos = get().config.layout[id] ?? { x: 0, y: 0 };
          set(({ config }) => ({
            config: {
              ...config,
              nodes: [...config.nodes, copy],
              layout: { ...config.layout, [copy.id]: { x: pos.x + 40, y: pos.y + 40 } },
            },
            selection: { kind: "node", id: copy.id },
          }));
        },

        move: (positions) =>
          set(({ config }) => ({
            config: { ...config, layout: { ...config.layout, ...positions } },
          })),

        connect: (from, to) => {
          if (isTerminal(from) || from === to) return;
          const { edges } = get().config;
          if (edges.some((e) => e.from === from && e.to === to)) return;
          const outs = edges.filter((e) => e.from === from);
          // First connection is the "otherwise" path; later ones start as a score rule to edit.
          const hasFallback = outs.some((e) => "always" in e.when);
          const edge: WorkflowEdge = {
            id: ulid(),
            from,
            to,
            priority: hasFallback
              ? Math.max(-1, ...outs.filter((e) => !("always" in e.when)).map((e) => e.priority)) +
                1
              : 100,
            when: hasFallback
              ? { metric: "auto_score_pct", op: ">=", value: 60 }
              : { always: true },
          };
          set(({ config }) => ({
            config: { ...config, edges: [...config.edges, edge] },
            selection: { kind: "edge", id: edge.id },
          }));
        },

        updateEdge: (id, patch) =>
          set(({ config }) => ({
            config: {
              ...config,
              edges: config.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)),
            },
          })),

        removeEdge: (id) =>
          set(({ config }) => ({
            config: { ...config, edges: config.edges.filter((e) => e.id !== id) },
            selection: null,
          })),

        setWeight: (nodeId, weight) =>
          set(({ config }) => {
            const weights = { ...config.scoring.weights };
            if (weight > 0) weights[nodeId] = weight;
            else delete weights[nodeId];
            return { config: { ...config, scoring: { weights } } };
          }),
      }),
      {
        limit: 50,
        partialize: (s) => ({ config: s.config }),
        equality: (a, b) => a.config === b.config,
      },
    ),
  );

export type BuilderStore = ReturnType<typeof createBuilderStore>;
