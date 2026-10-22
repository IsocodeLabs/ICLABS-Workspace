import "server-only";
import { env } from "../env";
import { createVertexReviewer, disabledReviewer, type AiReviewer } from "./review";

let reviewer: AiReviewer | undefined;

export function aiReviewer(): AiReviewer {
  if (!reviewer) {
    const e = env();
    reviewer =
      e.AI_REVIEW_ENABLED && e.VERTEX_PROJECT_ID
        ? createVertexReviewer({
            projectId: e.VERTEX_PROJECT_ID,
            region: e.VERTEX_REGION,
            model: e.CLAUDE_MODEL,
          })
        : disabledReviewer;
  }
  return reviewer;
}

export const aiReviewEnabled = () => env().AI_REVIEW_ENABLED && !!env().VERTEX_PROJECT_ID;
