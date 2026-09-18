/**
 * Wire protocol shared by the game server and every client (test client now, Expo later).
 * One JSON envelope per message; `t` is the discriminant.
 *
 * Phase 1 carries only connection-level traffic (ping / echo). Gameplay messages
 * (`cmd`, room/vitals/panel events) land in later phases and extend these unions.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

/** Max characters accepted in any single inbound text field (abuse guard). */
export const MAX_TEXT = 4000;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export const ClientMessageSchema = z.discriminatedUnion("t", [
  /** Liveness probe; server replies `pong`. */
  z.object({ t: z.literal("ping") }),
  /** Phase 1 loopback: server echoes `text` straight back. */
  z.object({ t: z.literal("echo"), text: z.string().max(MAX_TEXT) }),
  /** A raw MUD command line, parsed server-side. Wired up from Phase 2 on. */
  z.object({ t: z.literal("cmd"), raw: z.string().max(MAX_TEXT) }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  /** First frame after connect: identity + protocol handshake. */
  | { t: "welcome"; connectionId: string; server: string; protocol: number }
  /** Reply to `ping`. */
  | { t: "pong" }
  /** Reply to `echo`. */
  | { t: "echo"; text: string }
  /** Out-of-band server notice (status, not gameplay narrative). */
  | { t: "system"; text: string }
  /** A rejected or malformed request. */
  | { t: "error"; message: string };

/** Parse + validate an inbound frame. Returns null on any malformed input. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}

export function encode(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
