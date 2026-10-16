import { describe, expect, it } from "vitest";
import { can, type Actor, type Resource } from "./can";

const candidateA: Actor = { kind: "candidate", userId: "u-a", candidateId: "c-a", active: true };
const candidateB: Actor = { kind: "candidate", userId: "u-b", candidateId: "c-b", active: true };

const team = (
  role: "admin" | "hiring_manager" | "reviewer" | "interviewer",
  extra: Partial<Extract<Actor, { kind: "team" }>> = {},
): Actor => ({
  kind: "team",
  userId: `t-${role}`,
  role,
  active: true,
  roleIds: [],
  workflowIds: [],
  ...extra,
});

const appOfA: Resource = {
  type: "application",
  candidateId: "c-a",
  roleId: "sde",
  workflowId: "sde-backend",
  status: "active",
  reviewerIds: ["t-reviewer"],
  interviewerIds: [],
};

const stageOfA = (nodeState: "locked" | "unlocked" | "in_progress" | "submitted") =>
  ({
    type: "stage",
    candidateId: "c-a",
    roleId: "sde",
    workflowId: "sde-backend",
    applicationStatus: "active",
    nodeState,
  }) satisfies Resource;

const submissionOfA: Resource = {
  type: "submission",
  candidateId: "c-a",
  roleId: "sde",
  workflowId: "sde-backend",
  assignedReviewerIds: ["t-reviewer"],
};

describe("candidate isolation", () => {
  it("lets a candidate read their own application", () => {
    expect(can(candidateA, "read", appOfA)).toBe(true);
  });

  it("never lets a candidate read another candidate's application, stage or submission", () => {
    expect(can(candidateB, "read", appOfA)).toBe(false);
    expect(can(candidateB, "read", stageOfA("unlocked"))).toBe(false);
    expect(can(candidateB, "submit", stageOfA("unlocked"))).toBe(false);
    expect(can(candidateB, "read", submissionOfA)).toBe(false);
  });

  it("only lets a candidate open or submit unlocked stages of an active application", () => {
    expect(can(candidateA, "read", stageOfA("locked"))).toBe(false);
    expect(can(candidateA, "submit", stageOfA("locked"))).toBe(false);
    expect(can(candidateA, "submit", stageOfA("unlocked"))).toBe(true);
    expect(can(candidateA, "submit", stageOfA("in_progress"))).toBe(true);
    expect(can(candidateA, "submit", stageOfA("submitted"))).toBe(false);
    expect(can(candidateA, "read", stageOfA("submitted"))).toBe(true);
  });

  it("makes a closed application read-only for its candidate", () => {
    const closed = { ...appOfA, status: "closed_rejected" } as const;
    expect(can(candidateA, "read", closed)).toBe(true);
    expect(can(candidateA, "write", closed)).toBe(false);
    const closedStage = { ...stageOfA("unlocked"), applicationStatus: "closed_rejected" } as const;
    expect(can(candidateA, "submit", closedStage)).toBe(false);
  });

  it("never exposes scores or reviews to candidates, even their own", () => {
    expect(can(candidateA, "review", submissionOfA)).toBe(false);
    expect(can(candidateA, "read", { type: "scores", candidateId: "c-a", roleId: "sde" })).toBe(
      false,
    );
  });

  it("blocks disabled candidates entirely", () => {
    expect(can({ ...candidateA, active: false }, "read", appOfA)).toBe(false);
  });

  it("does not let candidates touch workflows, settings or MCP", () => {
    expect(can(candidateA, "read", { type: "workflow", roleId: "sde", workflowId: "x" })).toBe(
      false,
    );
    expect(can(candidateA, "manage", { type: "team_settings" })).toBe(false);
    expect(can(candidateA, "connect", { type: "mcp" })).toBe(false);
  });
});

describe("team permissions", () => {
  const workflow: Resource = { type: "workflow", roleId: "sde", workflowId: "sde-backend" };

  it("gives admins everything except acting as a candidate", () => {
    const admin = team("admin");
    expect(can(admin, "publish", workflow)).toBe(true);
    expect(can(admin, "read", submissionOfA)).toBe(true);
    expect(can(admin, "connect", { type: "mcp" })).toBe(true);
    expect(can(admin, "manage", { type: "team_settings" })).toBe(true);
    expect(can(admin, "submit", stageOfA("unlocked"))).toBe(false);
  });

  it("scopes hiring managers to their roles and stops them publishing", () => {
    const hm = team("hiring_manager", { roleIds: ["sde"] });
    expect(can(hm, "write", workflow)).toBe(true);
    expect(can(hm, "publish", workflow)).toBe(false);
    expect(can(hm, "read", appOfA)).toBe(true);
    expect(can(hm, "review", submissionOfA)).toBe(true);
    const pmApp = { ...appOfA, roleId: "pm", workflowId: "pm-main" };
    expect(can(hm, "read", pmApp)).toBe(false);
    expect(can(hm, "connect", { type: "mcp" })).toBe(false);
  });

  it("lets a hiring manager scoped to one track see only that track", () => {
    const hm = team("hiring_manager", { workflowIds: ["sde-backend"] });
    expect(can(hm, "read", appOfA)).toBe(true);
    expect(can(hm, "read", { ...appOfA, workflowId: "sde-frontend" })).toBe(false);
  });

  it("limits reviewers to submissions assigned to them", () => {
    const reviewer = team("reviewer");
    expect(can(reviewer, "read", submissionOfA)).toBe(true);
    expect(can(reviewer, "review", submissionOfA)).toBe(true);
    expect(can(reviewer, "read", appOfA)).toBe(true);
    const other = { ...submissionOfA, assignedReviewerIds: ["someone-else"] };
    expect(can(reviewer, "read", other)).toBe(false);
    expect(can(reviewer, "read", { ...appOfA, reviewerIds: [] })).toBe(false);
    expect(can(reviewer, "write", workflow)).toBe(false);
  });

  it("limits interviewers to their own interviews", () => {
    const interviewer = team("interviewer");
    const interview: Resource = {
      type: "interview",
      roleId: "sde",
      interviewerIds: ["t-interviewer"],
    };
    expect(can(interviewer, "read", interview)).toBe(true);
    expect(can(interviewer, "read", { ...interview, interviewerIds: [] })).toBe(false);
    expect(can(interviewer, "read", { ...appOfA, interviewerIds: ["t-interviewer"] })).toBe(true);
    expect(can(interviewer, "read", appOfA)).toBe(false);
    expect(can(interviewer, "review", submissionOfA)).toBe(false);
  });

  it("denies inactive team members", () => {
    expect(can(team("admin", { active: false }), "read", appOfA)).toBe(false);
  });

  it("allows only admins to connect the MCP server", () => {
    for (const role of ["hiring_manager", "reviewer", "interviewer"] as const) {
      expect(can(team(role, { roleIds: ["sde"] }), "connect", { type: "mcp" })).toBe(false);
    }
  });
});
