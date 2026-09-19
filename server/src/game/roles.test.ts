import { describe, expect, it } from "vitest";
import { can, canEditVnum, capsFor, isStaff, type StaffAccount } from "./roles.ts";

function acct(roles: string[], low: number | null = null, high: number | null = null): StaffAccount {
  return { id: "x", email: "e", roles, builderLowVnum: low, builderHighVnum: high };
}

describe("roles & capabilities (Phase 5)", () => {
  it("players hold no staff capabilities", () => {
    expect(can(["player"], "world.goto")).toBe(false);
    expect(can(["player"], "info.stat")).toBe(false);
    expect(isStaff(["player"])).toBe(false);
  });

  it("admin can do everything", () => {
    expect(can(["admin"], "world.goto")).toBe(true);
    expect(can(["admin"], "anything.at.all")).toBe(true);
    expect(isStaff(["admin"])).toBe(true);
  });

  it("moderator vs builder capability split", () => {
    expect(can(["moderator"], "world.goto")).toBe(true);
    expect(can(["moderator"], "info.users")).toBe(true);
    expect(can(["moderator"], "build.redit")).toBe(false);
    expect(can(["builder"], "build.redit")).toBe(true);
    expect(can(["builder"], "world.goto")).toBe(false);
    expect(capsFor(["builder"]).has("info.stat")).toBe(true);
  });

  it("builder sandbox: only edits vnums inside the assigned range", () => {
    const b = acct(["player", "builder"], 21000, 21500);
    expect(canEditVnum(b, 21100)).toBe(true);
    expect(canEditVnum(b, 21500)).toBe(true);
    expect(canEditVnum(b, 20999)).toBe(false);
    expect(canEditVnum(b, 30000)).toBe(false);
    // no range assigned -> cannot build anywhere
    expect(canEditVnum(acct(["builder"]), 21100)).toBe(false);
    // admins/mods edit anything
    expect(canEditVnum(acct(["admin"]), 999999)).toBe(true);
    expect(canEditVnum(acct(["moderator"]), 999999)).toBe(true);
    // plain players never
    expect(canEditVnum(acct(["player"]), 21100)).toBe(false);
  });
});
