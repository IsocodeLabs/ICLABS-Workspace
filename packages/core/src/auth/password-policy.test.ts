import { describe, expect, it } from "vitest";
import { validateNewPassword } from "./password-policy";

describe("validateNewPassword", () => {
  it("accepts a 10+ character password different from the previous one", () => {
    expect(validateNewPassword("correct horse", { previous: "Kx7m-Pq4t-Wr9z" })).toEqual([]);
  });

  it("rejects passwords shorter than 10 characters", () => {
    expect(validateNewPassword("short1234")).toContain("too_short");
  });

  it("rejects passwords longer than 128 characters", () => {
    expect(validateNewPassword("a".repeat(129))).toContain("too_long");
  });

  it("rejects reusing the temporary password", () => {
    expect(validateNewPassword("Kx7m-Pq4t-Wr9z", { previous: "Kx7m-Pq4t-Wr9z" })).toContain(
      "same_as_previous",
    );
  });

  it("counts length after trimming surrounding whitespace", () => {
    expect(validateNewPassword("   abc     ")).toContain("too_short");
  });
});
