import { describe, expect, it } from "vitest";
import { clampPercent, contentStatusCopy, describeCallableError, idempotencyScope } from "./learningUtils";

describe("describeCallableError", () => {
  it("maps Firebase callable codes to learner-friendly copy", () => {
    expect(describeCallableError(Object.assign(new Error("Limit hit"), { code: "functions/resource-exhausted" }))).toBe("Limit hit");
    expect(describeCallableError(Object.assign(new Error("x"), { code: "functions/unauthenticated" }))).toMatch(/sign in/i);
    expect(describeCallableError(new Error("boom"))).toBe("boom");
    expect(describeCallableError(undefined)).toMatch(/something went wrong/i);
  });
});

describe("idempotencyScope", () => {
  it("is stable across whitespace and casing of the goal", () => {
    expect(idempotencyScope("u1", "  Learn Subnetting ", "networking")).toBe(idempotencyScope("u1", "learn subnetting", "networking"));
    expect(idempotencyScope("u1", "a", "networking", "ip")).not.toBe(idempotencyScope("u1", "a", "networking"));
  });
});

describe("contentStatusCopy", () => {
  it("never labels unverified content as verified", () => {
    expect(contentStatusCopy("ai_generated").tone).toBe("generated");
    expect(contentStatusCopy("ai_verified").tone).toBe("verified");
    expect(contentStatusCopy("human_reviewed").label).toBe("Human reviewed");
  });
});

describe("clampPercent", () => {
  it("bounds and rounds", () => {
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent("42.6")).toBe(43);
    expect(clampPercent(Number.NaN)).toBe(0);
  });
});
