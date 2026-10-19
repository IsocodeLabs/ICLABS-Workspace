import { describe, expect, it } from "vitest";
import { validateFormAnswers, wordCount } from "./forms";

const essay = { id: "story", label: "Your story", kind: "long_text", required: true } as const;

describe("form answers", () => {
  it("counts words the way a person would", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  one two\n\nthree\tfour  ")).toBe(4);
  });

  it("enforces a word limit when one is set", () => {
    const limited = { ...essay, maxWords: 3 };
    expect(validateFormAnswers([limited], { story: "one two three" })).toEqual({});
    expect(validateFormAnswers([limited], { story: "one two three four" })).toEqual({
      story: "too_many_words",
    });
    expect(validateFormAnswers([essay], { story: "one two three four" })).toEqual({});
  });
});
