import { describe, expect, it } from "vitest";
import type { Rubric } from "../workflow/schema";
import {
  aggregateReviews,
  compositeScore,
  isBorderline,
  pickReviewers,
  rubricPct,
  scaleMax,
  validateScores,
} from "./review";

const rubric: Rubric = {
  scale: "1-5",
  criteria: [
    { id: "quality", name: "Quality", weight: 50 },
    { id: "thinking", name: "Problem solving", weight: 30, mustPassMin: 2 },
    { id: "comms", name: "Communication", weight: 20 },
  ],
};

describe("rubricPct", () => {
  it("weights criteria and expresses the result as a percentage of the scale", () => {
    // (5*50 + 3*30 + 4*20) / (5*100) = 420/500
    expect(rubricPct(rubric, { quality: 5, thinking: 3, comms: 4 })).toEqual({
      pct: 84,
      failedMustPass: false,
    });
  });

  it("flags a must-pass criterion scored below its minimum", () => {
    expect(rubricPct(rubric, { quality: 5, thinking: 1, comms: 5 }).failedMustPass).toBe(true);
  });

  it("treats pass/fail as 100 / 0", () => {
    const pf: Rubric = {
      scale: "pass-fail",
      criteria: [
        { id: "a", name: "A", weight: 1 },
        { id: "b", name: "B", weight: 1 },
      ],
    };
    expect(rubricPct(pf, { a: 1, b: 0 }).pct).toBe(50);
    expect(scaleMax(pf)).toBe(1);
  });
});

describe("validateScores", () => {
  it("requires every criterion, within the scale, as whole numbers", () => {
    expect(validateScores(rubric, { quality: 5, thinking: 3, comms: 4 })).toBeNull();
    expect(validateScores(rubric, { quality: 5, thinking: 3 })).toMatch(/Communication/);
    expect(validateScores(rubric, { quality: 6, thinking: 3, comms: 4 })).toMatch(/Quality/);
    expect(validateScores(rubric, { quality: 2.5, thinking: 3, comms: 4 })).toMatch(/Quality/);
  });
});

describe("aggregateReviews", () => {
  it("averages reviewers per criterion and overall", () => {
    const agg = aggregateReviews(rubric, [
      { scores: { quality: 4, thinking: 4, comms: 4 }, recommendation: "yes" },
      { scores: { quality: 5, thinking: 4, comms: 2 }, recommendation: "strong_yes" },
    ]);
    expect(agg.criteria).toEqual({ quality: 4.5, thinking: 4, comms: 3 });
    expect(agg.pct).toBe(81); // reviews score 80% and 82%
    expect(agg.recommendations).toEqual(["yes", "strong_yes"]);
    expect(agg.divergent).toBe(true); // comms 4 vs 2
  });

  it("isn't divergent when reviewers broadly agree", () => {
    expect(
      aggregateReviews(rubric, [
        { scores: { quality: 4, thinking: 4, comms: 4 }, recommendation: "yes" },
        { scores: { quality: 5, thinking: 4, comms: 3 }, recommendation: "yes" },
      ]).divergent,
    ).toBe(false);
  });
});

describe("compositeScore", () => {
  it("weights stage scores and re-normalises over the stages scored so far", () => {
    expect(compositeScore({ quiz: 30, task: 70 }, { quiz: 50, task: 90 })).toBe(78);
    expect(compositeScore({ quiz: 30, task: 70 }, { quiz: 50 })).toBe(50);
    expect(compositeScore({}, { quiz: 50 })).toBeNull();
  });
});

describe("isBorderline", () => {
  it("is true inside cutoff ± band", () => {
    expect(isBorderline(55, { cutoff: 60, band: 8 })).toBe(true);
    expect(isBorderline(68, { cutoff: 60, band: 8 })).toBe(true);
    expect(isBorderline(69, { cutoff: 60, band: 8 })).toBe(false);
    expect(isBorderline(55, undefined)).toBe(false);
  });
});

describe("pickReviewers", () => {
  const pool = ["a", "b", "c"];
  it("takes turns: fewest reviews on this stage first, never the same person twice", () => {
    expect(
      pickReviewers({
        pool,
        count: 2,
        method: "round_robin",
        stageCounts: { a: 3, b: 1, c: 2 },
        openLoad: {},
        exclude: [],
      }),
    ).toEqual(["b", "c"]);
  });
  it("lightest queue uses open assignments", () => {
    expect(
      pickReviewers({
        pool,
        count: 1,
        method: "load",
        stageCounts: {},
        openLoad: { a: 5, b: 0, c: 2 },
        exclude: [],
      }),
    ).toEqual(["b"]);
  });
  it("respects exclusions and manual mode", () => {
    expect(
      pickReviewers({
        pool,
        count: 1,
        method: "round_robin",
        stageCounts: {},
        openLoad: {},
        exclude: ["a"],
      }),
    ).toEqual(["b"]);
    expect(
      pickReviewers({
        pool,
        count: 1,
        method: "manual",
        stageCounts: {},
        openLoad: {},
        exclude: [],
      }),
    ).toEqual([]);
  });
});
