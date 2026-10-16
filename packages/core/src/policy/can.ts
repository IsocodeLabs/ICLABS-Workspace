/**
 * The single authorization check. Every route handler, server action and MCP tool calls
 * `can()` before touching data. Resources carry the facts the decision needs, so this stays
 * pure and fully unit-tested.
 */

export type TeamRole = "admin" | "hiring_manager" | "reviewer" | "interviewer";

export type ApplicationStatus =
  | "active"
  | "needs_decision"
  | "on_hold"
  | "interview_scheduled"
  | "completed"
  | "closed_rejected"
  | "closed_withdrawn";

export type NodeState =
  | "locked"
  | "unlocked"
  | "in_progress"
  | "submitted"
  | "reviewed"
  | "passed"
  | "failed"
  | "skipped";

export type Actor =
  | { kind: "candidate"; userId: string; candidateId: string; active: boolean }
  | {
      kind: "team";
      userId: string;
      role: TeamRole;
      active: boolean;
      /** Roles a hiring manager manages. */
      roleIds: string[];
      /** Tracks (workflows) a hiring manager manages. */
      workflowIds: string[];
    };

export type Resource =
  | {
      type: "application";
      candidateId: string;
      roleId: string;
      workflowId: string;
      status: ApplicationStatus;
      reviewerIds: string[];
      interviewerIds: string[];
    }
  | {
      type: "stage";
      candidateId: string;
      roleId: string;
      workflowId: string;
      applicationStatus: ApplicationStatus;
      nodeState: NodeState;
    }
  | {
      type: "submission";
      candidateId: string;
      roleId: string;
      workflowId: string;
      assignedReviewerIds: string[];
    }
  | { type: "scores"; candidateId: string; roleId: string }
  | { type: "workflow"; roleId: string; workflowId: string }
  | { type: "interview"; roleId: string; interviewerIds: string[] }
  | { type: "team_settings" }
  | { type: "mcp" };

export type Action = "read" | "write" | "submit" | "review" | "publish" | "manage" | "connect";

const CLOSED: ReadonlySet<ApplicationStatus> = new Set(["closed_rejected", "closed_withdrawn"]);
const OPEN_NODE: ReadonlySet<NodeState> = new Set(["unlocked", "in_progress"]);

export function can(actor: Actor, action: Action, resource: Resource): boolean {
  if (!actor.active) return false;
  return actor.kind === "candidate"
    ? candidateCan(actor, action, resource)
    : teamCan(actor, action, resource);
}

function candidateCan(
  actor: Extract<Actor, { kind: "candidate" }>,
  action: Action,
  r: Resource,
): boolean {
  switch (r.type) {
    case "application":
      if (r.candidateId !== actor.candidateId) return false;
      if (action === "read") return true;
      return action === "write" && !CLOSED.has(r.status);
    case "stage":
      if (r.candidateId !== actor.candidateId || r.nodeState === "locked") return false;
      if (action === "read") return true;
      return action === "submit" && !CLOSED.has(r.applicationStatus) && OPEN_NODE.has(r.nodeState);
    case "submission":
      return action === "read" && r.candidateId === actor.candidateId;
    default:
      // Scores, workflows, interviews' internals, settings and MCP are team-only.
      return false;
  }
}

function teamCan(actor: Extract<Actor, { kind: "team" }>, action: Action, r: Resource): boolean {
  // Team members never act as a candidate.
  if (action === "submit") return false;
  if (actor.role === "admin") return true;
  if (r.type === "mcp" || r.type === "team_settings" || action === "publish") return false;

  switch (actor.role) {
    case "hiring_manager":
      return "roleId" in r && inScope(actor, r.roleId, "workflowId" in r ? r.workflowId : null);
    case "reviewer":
      if (r.type === "submission") {
        return (
          (action === "read" || action === "review") && r.assignedReviewerIds.includes(actor.userId)
        );
      }
      if (r.type === "application" || r.type === "scores") {
        return (
          action === "read" && r.type === "application" && r.reviewerIds.includes(actor.userId)
        );
      }
      return false;
    case "interviewer":
      if (action !== "read") return false;
      if (r.type === "interview" || r.type === "application") {
        return r.interviewerIds.includes(actor.userId);
      }
      return false;
  }
}

function inScope(
  actor: Extract<Actor, { kind: "team" }>,
  roleId: string,
  workflowId: string | null,
): boolean {
  if (actor.roleIds.includes(roleId)) return true;
  return workflowId !== null && actor.workflowIds.includes(workflowId);
}
