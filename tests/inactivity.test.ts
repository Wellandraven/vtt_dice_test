import { describe, expect, it } from "vitest";
import { isSessionInactive, SESSION_INACTIVITY_MS } from "../study/inactivity.js";

describe("session inactivity", () => {
  it("keeps sessions active before fifteen minutes", () => {
    expect(isSessionInactive(1_000, 1_000 + SESSION_INACTIVITY_MS - 1)).toBe(false);
  });

  it("expires sessions at fifteen minutes", () => {
    expect(isSessionInactive(1_000, 1_000 + SESSION_INACTIVITY_MS)).toBe(true);
  });
});
