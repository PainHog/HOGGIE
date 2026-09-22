/**
 * Role -> capability model (architecture-plan §5). Replaces the old level-based god flags:
 * powers are named capabilities granted by roles, checked per command. The builder role also
 * carries an area/vnum sandbox (systems-spec §5.4) enforced by canEditVnum.
 */
export type Role = "player" | "builder" | "moderator" | "admin";

export interface StaffAccount {
  id: string;
  email: string | null;
  roles: string[];
  builderLowVnum: number | null;
  builderHighVnum: number | null;
}

/** Capabilities each role grants. `admin` is all-powerful (handled in `can`). */
const ROLE_CAPS: Record<string, string[]> = {
  player: [],
  builder: ["info.stat", "build.redit", "build.medit", "build.oedit", "world.load", "world.purge"], // build.*/world.* are vnum-range-scoped
  moderator: ["info.stat", "info.users", "world.goto", "world.transfer", "world.restore", "world.purge", "world.load"],
  admin: ["*"],
};

export function capsFor(roles: string[]): Set<string> {
  const s = new Set<string>();
  for (const r of roles) for (const c of ROLE_CAPS[r] ?? []) s.add(c);
  return s;
}

export function can(roles: string[], capability: string): boolean {
  if (roles.includes("admin")) return true;
  return capsFor(roles).has(capability);
}

export function isStaff(roles: string[]): boolean {
  return roles.some((r) => r !== "player");
}

/**
 * The scoped-builder boundary: admins/mods edit anything; a builder may only edit a vnum inside
 * their assigned range. Carries the old area/vnum sandbox forward.
 */
export function canEditVnum(account: StaffAccount, vnum: number): boolean {
  if (account.roles.includes("admin") || account.roles.includes("moderator")) return true;
  if (!account.roles.includes("builder")) return false;
  const { builderLowVnum: lo, builderHighVnum: hi } = account;
  if (lo == null || hi == null) return false;
  return vnum >= lo && vnum <= hi;
}

export const ROLE_NAMES: Role[] = ["player", "builder", "moderator", "admin"];
