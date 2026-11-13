import { describe, expect, it } from "vitest";
import {
  emailBoundInvitationCode,
  invitationEmailBindingMatches,
  normalizeInviteEmail,
} from "./domain";

describe("email-bound station invitations", () => {
  it("accepts only the normalized recipient email", () => {
    const code = emailBoundInvitationCode(" Staff@Example.Test ");
    expect(invitationEmailBindingMatches(code, "staff@example.test")).toBe(
      true
    );
    expect(invitationEmailBindingMatches(code, "other@example.test")).toBe(
      false
    );
  });

  it("rejects tampered and malformed bound codes", () => {
    const code = emailBoundInvitationCode("staff@example.test");
    expect(
      invitationEmailBindingMatches(`${code.slice(0, -1)}0`, "staff@example.test")
    ).toBe(false);
    expect(
      invitationEmailBindingMatches("v2.invalid.invalid", "staff@example.test")
    ).toBe(false);
  });

  it("identifies legacy codes for backwards-compatible acceptance", () => {
    expect(
      invitationEmailBindingMatches(
        "legacy-random-code-that-still-works",
        "staff@example.test"
      )
    ).toBeNull();
  });

  it("normalizes and validates recipient addresses", () => {
    expect(normalizeInviteEmail(" Staff@Example.Test ")).toBe(
      "staff@example.test"
    );
    expect(() => normalizeInviteEmail("not-an-email")).toThrow();
  });
});
