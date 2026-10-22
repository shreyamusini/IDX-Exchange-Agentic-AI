// Multi-turn conversation logic.
//
// Each WhatsApp message goes through handleMessage(). It reads what the user
// said with the Week 2 parser, merges it into their session, then either asks
// the next follow-up question or searches rets_property with the Week 3 query layer.
//
// Questions are asked in this order, skipping anything already known:
//   1. city (required)
//   2. budget (can be skipped with "any" / "no limit")
//   3. property type, optionally with bedrooms (can be skipped with "any")
import { parsePropertyQuery } from "../../property_search/scripts/parser.ts";
import {
  sanitizeFilters,
  searchActiveListings,
  type ListingRow,
  type PagedResult,
  type PropertyFilters,
} from "./queries.ts";
import { describeFilters, listingCard, toListing, type Listing } from "./format.ts";
import { clearSession, getSession, updateSession, type UserSession } from "./session.ts";

export const STEP = { START: 0, ASK_CITY: 1, ASK_BUDGET: 2, ASK_TYPE: 3, RESULTS: 4 } as const;

export const RESULTS_PER_PAGE = 5;

// If the same message from the same person arrives again within this window, it's
// a duplicate call (for example, the agent running two commands for one message),
// so the previous reply is returned instead of moving the conversation forward twice.
export const DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

// Filters the user mentioned in one message (no nulls).
type Found = { [K in keyof PropertyFilters]?: NonNullable<PropertyFilters[K]> };

export type SearchFn = (filters: PropertyFilters, page: number, limit: number) => Promise<PagedResult<ListingRow>>;

export type TurnResult = {
  reply: string;
  step: number;
  filters: PropertyFilters;
  searched: boolean;
  duplicate?: boolean;
  total?: number;
  page?: number;
  totalPages?: number;
  results?: Listing[];
};

const FILTER_KEYS = ["city", "maxPrice", "beds", "baths", "sqft", "type", "pool", "hasView", "maxHOA"] as const;

const RESET = /\b(start over|new search|reset|restart|clear (?:my )?search)\b/i;
const MORE = /^\s*(?:more|next|next page|show more|see more|more please|show me more)\s*[.!]*\s*$/i;
const SKIP = /\b(any|anything|no preference|doesn'?t matter|don'?t care|no limit|no budget|not sure|whatever|either|open)\b/i;
const NOT_A_CITY = /^(hi|hey|hello|yo|thanks|thank you|ok|okay|yes|no|nope|sure|help|any|anything|more|next)$/i;
// Words that mean a short reply is a request, not a place name ("find homes", "show me condos").
const REQUEST_WORDS = new Set([
  "find", "show", "me", "looking", "look", "for", "want", "need", "buy", "search", "get", "i", "a", "the", "some",
  "home", "homes", "house", "houses", "property", "properties", "listing", "listings", "place", "places",
  "condo", "condos", "townhome", "townhomes", "townhouse", "townhouses", "land", "please",
]);
const REMOVE_BUDGET = /\b(?:any|no) (?:budget|price|price limit|max(?:imum)? price)\b|\bno limit\b/i;
const REMOVE_TYPE = /\bany (?:type|kind|property type|home type)\b/i;

const QUESTIONS = {
  city: "Which city are you looking in?",
  budget: "What's your budget? For example, \"under $1.2M\".",
  type: "Any preferences — condo, townhome, or single family? You can add bedrooms too, like \"single family with 3 beds\".",
};

// ---------- reading answers the parser can't ----------

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// A reply that's just a place name, like "Irvine" or "newport beach".
function bareCity(text: string): string | null {
  const t = text.trim().replace(/^(?:in|near|around)\s+/i, "").replace(/[.!?]+$/, "").trim();
  if (!/^[a-z][a-z .'-]{1,40}$/i.test(t)) return null;
  const words = t.toLowerCase().split(/\s+/);
  if (words.length > 4 || NOT_A_CITY.test(t) || words.some((w) => REQUEST_WORDS.has(w))) return null;
  return titleCase(t);
}

// "what about Tustin", "how about Costa Mesa?", "try Anaheim"
async function changedCity(text: string): Promise<string | null> {
  const m =
    text.match(/\b(?:what|how) about\s+(?:in\s+)?([a-z][a-z .'-]+?)\s*\??\s*$/i) ??
    text.match(/^\s*(?:try|switch to|change (?:the )?city to)\s+([a-z][a-z .'-]+?)\s*[.!?]*\s*$/i);
  if (!m) return null;
  const candidate = m[1].trim();
  // "what about condos" is a property type, not a city
  if ((await parsePropertyQuery(candidate)).type || NOT_A_CITY.test(candidate)) return null;
  return titleCase(candidate);
}

// A reply that's just an amount, like "1.2M", "$900k", or "800".
// Without k/M: under 20 means millions ("2" = $2M), under 10,000 means thousands ("900" = $900K).
export function bareBudget(text: string): number | null {
  const m = text.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|mil|million|thousand)?\b/i);
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ""));
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k" || suffix === "thousand") n *= 1_000;
  else if (suffix) n *= 1_000_000;
  else if (n < 20) n *= 1_000_000;
  else if (n < 10_000) n *= 1_000;
  return n >= 10_000 ? Math.round(n) : null;
}

// ---------- session <-> filters ----------

function filtersFromSession(s: UserSession): PropertyFilters {
  return sanitizeFilters(s);
}

function foundAny(f: Found): boolean {
  return FILTER_KEYS.some((k) => f[k] != null);
}

// ---------- replies ----------

function knownSoFar(f: PropertyFilters): string {
  const desc = describeFilters(f);
  return desc ? `Got it: ${desc}.` : "";
}

function cardWithPhotos(l: Listing, n: number): string {
  const photos = l.photoCount === null ? null : `📸 ${l.photoCount} photo${l.photoCount === 1 ? "" : "s"}`;
  return [listingCard(l, n), photos].filter(Boolean).join("\n");
}

function resultsReply(f: PropertyFilters, res: PagedResult<ListingRow>, listings: Listing[]): string {
  const desc = describeFilters(f);
  if (res.total === 0) {
    return [
      `🔎 No homes match ${desc || "that search"}.`,
      "Try a higher budget, fewer bedrooms, or say \"any type\". You can also say \"start over\".",
    ].join("\n");
  }
  if (listings.length === 0) {
    return `That's all ${res.total} homes for ${desc}. Refine the search, or say "start over".`;
  }
  const from = res.offset + 1;
  const to = res.offset + listings.length;
  const more = res.page < res.totalPages ? `Reply *more* for the next ${res.limit}. ` : "";
  return [
    `🔎 *${res.total.toLocaleString("en-US")} home${res.total === 1 ? "" : "s"}* · ${desc}`,
    `Showing ${from}–${to} (page ${res.page} of ${res.totalPages})`,
    ...listings.map((l, i) => cardWithPhotos(l, res.offset + i + 1)),
    `${more}You can also refine, like "under $900k", "with a pool", or "what about Tustin", or say "start over".`,
  ].join("\n\n");
}

const REFINE_HELP =
  'I can narrow these down. Try "under $900k", "at least 2 baths", "with a pool", "what about Tustin", "more", or "start over".';

// ---------- main entry ----------

export async function handleMessage(
  userId: string,
  message: string,
  search: SearchFn = searchActiveListings,
): Promise<TurnResult> {
  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  const before = getSession(userId);
  const isRepeat =
    before.lastMessage === normalized &&
    before.lastReply !== undefined &&
    Date.now() - (before.lastMessageAt ?? 0) < DUPLICATE_WINDOW_MS;
  if (isRepeat) {
    return { ...turn(before, before.lastReply!), duplicate: true };
  }

  const result = await processMessage(userId, message, search);
  updateSession(userId, { lastMessage: normalized, lastMessageAt: Date.now(), lastReply: result.reply });
  return result;
}

async function processMessage(userId: string, message: string, search: SearchFn): Promise<TurnResult> {
  let text = message.trim();

  // "start over" forgets everything. Anything after it is treated as a new request.
  if (RESET.test(text)) {
    clearSession(userId);
    text = text.replace(RESET, "").replace(/^[\s,.!-]+/, "").trim();
    if (!text) {
      const s = updateSession(userId, { conversationStep: STEP.ASK_CITY });
      return turn(s, `Starting a new search. ${QUESTIONS.city}`);
    }
  }

  let session = getSession(userId);

  // "more" shows the next page of the current results.
  if (MORE.test(text)) {
    if (session.conversationStep === STEP.RESULTS) {
      return runSearch(userId, session, (session.page ?? 1) + 1, search);
    }
    return turn(session, `There aren't any results yet. ${nextQuestion(filtersFromSession(session), session) ?? QUESTIONS.city}`);
  }

  // Read the message with the Week 2 parser, plus fallbacks for short answers.
  const parsed: Found = {};
  for (const [k, v] of Object.entries(await parsePropertyQuery(text))) {
    if (v !== null) (parsed as Record<string, unknown>)[k] = v;
  }
  const step = session.conversationStep;
  const skipped = new Set(session.skipped ?? []);

  if (!parsed.city && !foundAny(parsed)) {
    const moved = await changedCity(text);
    if (moved) parsed.city = moved;
    else if (!session.city && !foundAny(parsed) && (step === STEP.START || step === STEP.ASK_CITY)) {
      const city = bareCity(text);
      if (city) parsed.city = city;
    }
  }
  if (step === STEP.ASK_BUDGET && parsed.maxPrice == null) {
    // Only read a bare number as a budget if it isn't something else, like "3 beds".
    const looksLikeMoney = !foundAny(parsed) || /\$|\d\s*(?:k|m|mil|million|thousand)\b/i.test(text);
    const amount = looksLikeMoney ? bareBudget(text) : null;
    if (amount !== null) parsed.maxPrice = amount;
    else if (SKIP.test(text)) skipped.add("maxPrice");
  }

  // Filters in this message that differ from what's already saved (checked after the fallbacks above).
  const saved = session as unknown as Record<string, unknown>;
  const isNew = (Object.keys(parsed) as (keyof Found)[]).some((k) => parsed[k] !== saved[k]);

  // "any budget" / "any type" remove a filter set earlier.
  const removals: Partial<UserSession> = {};
  if (REMOVE_BUDGET.test(text) && parsed.maxPrice == null && session.maxPrice != null) {
    removals.maxPrice = undefined;
    skipped.add("maxPrice");
  }
  if (REMOVE_TYPE.test(text) && parsed.type == null && session.type != null) {
    removals.type = undefined;
    skipped.add("type");
  }
  if (step === STEP.ASK_TYPE && parsed.type == null && (SKIP.test(text) || isNew)) {
    // "any", or new information about something else (like "at least 3 beds"), means no type preference.
    // Repeating something already saved (like the same budget) doesn't count.
    skipped.add("type");
  }
  if (parsed.maxPrice != null) skipped.delete("maxPrice");
  if (parsed.type != null) skipped.delete("type");

  // While showing results, restating filters re-runs the search. Before that, only new information counts.
  const changed =
    (step === STEP.RESULTS ? foundAny(parsed) : isNew) ||
    Object.keys(removals).length > 0 ||
    skipped.size !== (session.skipped ?? []).length;

  // Nothing new while looking at results: explain how to refine.
  if (!changed && step === STEP.RESULTS) {
    return turn(session, REFINE_HELP);
  }

  session = updateSession(userId, { ...parsed, ...removals, skipped: [...skipped] });
  const filters = filtersFromSession(session);

  // Ask the next missing question, or search.
  const question = nextQuestion(filters, session);
  if (question) {
    const nextStep = !filters.city ? STEP.ASK_CITY : question === QUESTIONS.budget ? STEP.ASK_BUDGET : STEP.ASK_TYPE;
    session = updateSession(userId, { conversationStep: nextStep });
    const intro = changed ? knownSoFar(filters) : step === STEP.START ? "Hi! I can help you find a home." : "Sorry, I didn't catch that.";
    return turn(session, [intro, question].filter(Boolean).join(" "));
  }

  // All questions answered (or skipped): search from page 1.
  return runSearch(userId, session, 1, search);
}

function nextQuestion(f: PropertyFilters, s: UserSession): string | null {
  const skipped = new Set(s.skipped ?? []);
  if (!f.city) return QUESTIONS.city;
  if (f.maxPrice === null && !skipped.has("maxPrice")) return QUESTIONS.budget;
  if (f.type === null && !skipped.has("type")) return QUESTIONS.type;
  return null;
}

async function runSearch(userId: string, session: UserSession, page: number, search: SearchFn): Promise<TurnResult> {
  const filters = filtersFromSession(session);
  const res = await search(filters, page, RESULTS_PER_PAGE);
  const listings = res.rows.map(toListing);
  const saved = updateSession(userId, {
    conversationStep: STEP.RESULTS,
    page: res.page,
    lastResults: res.rows,
  });
  return {
    ...turn(saved, resultsReply(filters, res, listings)),
    searched: true,
    total: res.total,
    page: res.page,
    totalPages: res.totalPages,
    results: listings,
  };
}

function turn(session: UserSession, reply: string): TurnResult {
  return { reply, step: session.conversationStep, filters: filtersFromSession(session), searched: false };
}
