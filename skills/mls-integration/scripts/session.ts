// Session memory for multi-turn property searches.
//
// This keeps the handbook's API (getSession / updateSession / clearSession and
// an in-memory Map), plus one addition: each session is also saved to a small
// JSON file. The agent runs this skill as a new process for every WhatsApp
// message, and a Map alone would be empty again on the next message.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ListingRow } from "./queries.ts";

export interface UserSession {
  // From the handbook
  city?: string;
  maxPrice?: number;
  beds?: number;
  baths?: number;
  type?: string;
  pool?: string;
  lastResults?: ListingRow[];
  conversationStep: number;

  // Added so every Week 2 filter can be remembered and refined
  sqft?: number;
  hasView?: string;
  maxHOA?: number;
  // Questions the user answered with "any" / "no preference"
  skipped?: ("maxPrice" | "type")[];
  // Current results page, for "more"
  page?: number;
  // Last time this session changed (ms since 1970), used for expiry
  updatedAt?: number;
  // The last message handled and the reply sent, so a repeated call can be ignored
  lastMessage?: string;
  lastMessageAt?: number;
  lastReply?: string;
}

// A session is forgotten after 30 minutes without messages.
export const SESSION_TTL_MS = 30 * 60 * 1000;

const sessions = new Map<string, UserSession>();

function sessionDir(): string {
  return process.env.MLS_SESSION_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../sessions");
}

// User IDs come from outside (phone numbers, chat IDs). Keep only safe
// characters so an ID like "../../secrets" can't point outside the sessions folder.
export function safeUserId(userId: string): string {
  const id = String(userId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return id || "anonymous";
}

function sessionFile(userId: string): string {
  return path.join(sessionDir(), `${safeUserId(userId)}.json`);
}

function loadFromDisk(userId: string): UserSession | null {
  try {
    const saved = JSON.parse(readFileSync(sessionFile(userId), "utf8")) as UserSession;
    const fresh = Date.now() - (saved.updatedAt ?? 0) < SESSION_TTL_MS;
    return fresh ? saved : null;
  } catch {
    return null; // no file yet, or unreadable: start a new session
  }
}

export function getSession(userId: string): UserSession {
  if (!sessions.has(userId)) {
    sessions.set(userId, loadFromDisk(userId) ?? { conversationStep: 0 });
  }
  return sessions.get(userId)!;
}

export function updateSession(userId: string, updates: Partial<UserSession>): UserSession {
  const session = { ...getSession(userId), ...updates, updatedAt: Date.now() };
  sessions.set(userId, session);
  mkdirSync(sessionDir(), { recursive: true });
  writeFileSync(sessionFile(userId), JSON.stringify(session, null, 2));
  return session;
}

export function clearSession(userId: string): void {
  sessions.delete(userId);
  rmSync(sessionFile(userId), { force: true });
}

// For tests: forget the in-memory copies, as if this were a new process.
export function resetMemoryForTests(): void {
  sessions.clear();
}
