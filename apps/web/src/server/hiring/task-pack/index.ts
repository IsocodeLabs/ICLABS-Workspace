import type { WorkflowConfig } from "@iclabs/core";
import problemStatements from "./problem-statements.json";

/**
 * The take-home task for the Product Management and Software Engineering tracks: a pool of client
 * briefs (each candidate is shown 5 at random and picks 1), the instructions, what to submit (one
 * ZIP), and a one-week deadline. Installed once per track by setup-roles; after that the track is
 * the team's.
 */

type Deliverable = {
  id: string;
  kind: "file" | "link" | "text";
  label: string;
  required: boolean;
  allowedDomains?: string[];
};

const pool = {
  offer: problemStatements.offer,
  items: problemStatements.items.map((p) => ({ id: p.id, title: p.title, body: p.body })),
};

const AI_NOTE = `## Use AI, and use it well

AI tools are **highly recommended**. Use them to draft faster, test ideas, find gaps and polish your work, so that what you hand in is a more finished, specific outcome for this client and not a generic one. The judgement, the numbers and the final choices must still be yours. You will explain them in the interview.`;

const PM_BRIEF = `## Your task

You are the Isocode Labs product manager on a live deal. A client has sent us the brief you pick below. Take the deal from "interested" to "ready to sign".

| | |
|---|---|
| **You submit** | One ZIP file with three documents: the PRD, the project timeline and a draft agreement |
| **Time** | 7 days from when this step opens |
| **Work** | Alone |

Isocode Labs builds custom websites, web apps and AI automations. A typical project costs ₹5–10 lakh and takes 4–8 weeks.

${AI_NOTE}

## What to do

Pick **one** problem statement from the ones shown to you. Then write:

### 1. The PRD for the whole project

- The problem, the goals and what you are **not** doing
- Users and their journeys
- Prioritised requirements: what is in the first release, what comes later, and why
- How any AI or automation behaves, and what happens when it is wrong
- Design approach and the key screens
- Data, integrations and rules the product must follow
- Risks, success measures and the open questions you would put to the client

### 2. The project timeline

- Phases, milestones and deliverables, week by week
- Who does what: the Isocode team and the client
- Dependencies, buffers and the points where the client approves work
- It must fit the budget and time the client gave you

### 3. The agreement, ready to send before the deal closes

- Scope, exclusions and deliverables
- Timeline, price in ₹ and payment milestones
- Change requests, client responsibilities and acceptance
- Ownership of the work, confidentiality and data protection, support after launch, ending the agreement
- A signature block. Mark it as a draft for legal review

## How to submit

Put the three files in **one .zip** (up to 25 MB) and upload it. Name the files clearly, for example \`PRD.pdf\`, \`Timeline.xlsx\` and \`Agreement.pdf\`.

## Rules

- Label every assumption. Do not invent facts about the client without saying so
- Use only the information in the problem statement. The "CORE BUILD" paragraph is for engineers: you plan the whole project
- Check that your numbers add up. You will explain them in the interview
- Do not say you represent Isocode Labs to anyone outside this task
- You can resubmit until the deadline; we review your latest version

## What great looks like

- A clear scope: someone could build from it without asking you anything
- A timeline and price that hold together
- An agreement a client could sign, with no gaps
- Honest trade-offs: what you cut and why
- Extra depth, well-judged ideas beyond the core and careful edge cases count in your favour

## Common mistakes

- Copying the brief back as the PRD
- A timeline with no client responsibilities or approval points
- An agreement with no exclusions or change process
- Features with no priority, and no answer for when the AI is wrong
- Generic text that could be for any client

## How you'll be scored

| Area | Weight |
|---|---|
| Quality of work | 50% |
| Problem solving | 30% |
| Communication | 20% |`;

const SDE_BRIEF = `## Your task

A client has sent us the brief you pick below. Build the product, end to end, with a great UI and UX.

| | |
|---|---|
| **You submit** | One ZIP file with two files: your Technical Design Document (TDD) and a \`deployment.md\` |
| **Time** | 7 days from when this step opens |
| **Work** | Alone |

Build a small part really well instead of the whole scope badly. The "CORE BUILD" paragraph in your problem statement says which slice must work end to end.

${AI_NOTE}

## What to do

Pick **one** problem statement from the ones shown to you. Then build it.

### Must have

- The main flows in the brief work, on realistic sample data you create. No dead buttons
- Frontend, backend, a database and sign-in. Use roles if the brief has more than one kind of user
- The AI or automation part actually works, including what happens when it is wrong or unsure
- A polished UI: a consistent design, a layout that works on a phone, and loading, empty and error states
- Tests for the most important logic, and basic security: no secrets in the repository, validated inputs, access control

## How to submit

Put these two files in **one .zip** (up to 25 MB) and upload it.

### 1. Technical Design Document (PDF or Word)

- **The GitHub URL of your project, at the top.** Also add the link to the live app if you deployed it
- The architecture and why you chose it
- The data model, the main flows and how the AI part works
- UI and design decisions: the key screens and why they look the way they do
- What you cut, and what you would do next

### 2. deployment.md

- How to run it locally, step by step
- How it is deployed, and the environment variables it needs (names only, never the values)
- Demo login details for the reviewer

## Rules

- Use only the information in the problem statement. Label every assumption in your TDD
- Keep the commit history. We read it
- Do not put secrets or real personal data in the repository
- Keep the repository public until we have finished reviewing
- You can resubmit until the deadline; we review your latest version

## What great looks like

- A product a client could try today
- Clean, readable code with a clear structure
- A UI that feels designed, not default
- Honest notes about the limits
- Extra depth, well-judged features beyond the core and careful edge cases count in your favour

## Common mistakes

- A beautiful front end with nothing behind it
- Everything built, nothing working
- No sample data, so the app looks empty
- The AI part faked, or not handling mistakes
- A TDD with no GitHub URL

## How you'll be scored

| Area | Weight |
|---|---|
| Quality of work | 50% |
| Problem solving | 30% |
| Communication | 20% |`;

export const TASK_PACKS = {
  "product-manager-intern": {
    brief: PM_BRIEF,
    deliverables: [
      {
        id: "submission",
        kind: "file",
        label: "Your ZIP: PRD, project timeline and draft agreement",
        required: true,
      },
      {
        id: "notes",
        kind: "text",
        label: "Assumptions and anything you want us to know",
        required: false,
      },
    ],
  },
  "software-engineering-intern": {
    brief: SDE_BRIEF,
    deliverables: [
      {
        id: "submission",
        kind: "file",
        label: "Your ZIP: Technical Design Document (with your GitHub URL) and deployment.md",
        required: true,
      },
      {
        id: "notes",
        kind: "text",
        label: "Anything you want us to know",
        required: false,
      },
    ],
  },
} satisfies Record<string, { brief: string; deliverables: Deliverable[] }>;

export type TaskPackSlug = keyof typeof TASK_PACKS;
export const hasTaskPack = (slug: string): slug is TaskPackSlug => slug in TASK_PACKS;

/** The process with its task step filled in: brief, what to submit, problem statements, one week. */
export function applyTaskPack(config: WorkflowConfig, slug: TaskPackSlug): WorkflowConfig {
  const pack = TASK_PACKS[slug];
  const next = structuredClone(config);
  const node = next.nodes.find((n) => n.id === "task");
  if (!node || node.type !== "task") throw new Error("the process has no task step");
  node.config = {
    ...node.config,
    brief: pack.brief,
    deliverables: pack.deliverables.map((d) => ({ ...d })),
    allowResubmit: true,
    problemStatements: structuredClone(pool),
  };
  node.deadline = { mode: "relative", daysAfterUnlock: 7, atTime: "23:59" };
  return next;
}
