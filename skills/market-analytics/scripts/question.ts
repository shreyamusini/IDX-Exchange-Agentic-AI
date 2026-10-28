// Reads a market question: which cities or ZIP, which property type, and whether
// it asks for a ranking of cities. Reuses the Week 2 parser for city and type.
import { parsePropertyQuery } from "../../property_search/scripts/parser.ts";
import { SUBTYPES } from "./market.ts";

export type MarketQuestion = {
  cityGuess: string | null; // what the parser read after "in"/"near", not checked yet
  zip: string | null;
  type: string | null;
  wantsTop: boolean;
  typeError: string | null;
};

// California ZIP codes run from 90001 to 96162.
const ZIP = /\b(9[0-6]\d{3})\b/;
const TOP = /\b(top|hottest|busiest|most active|which cities|what cities|best cities|rank(?:ing|ed)?|compare all)\b/i;

export async function readQuestion(text: string): Promise<MarketQuestion> {
  const parsed = await parsePropertyQuery(text);
  const zip = text.match(ZIP)?.[1] ?? null;
  let type = parsed.type;
  let typeError: string | null = null;
  if (type && !(SUBTYPES as readonly string[]).includes(type)) {
    typeError = "Market stats cover homes (single family, condos, and townhomes), not land.";
    type = null;
  }
  // The parser reads "in 92618" as nothing, and a ZIP isn't a city.
  const cityGuess = parsed.city && !ZIP.test(parsed.city) ? parsed.city : null;
  return { cityGuess, zip, type, wantsTop: TOP.test(text), typeError };
}

// Finds known city names anywhere in the text, so "Irvine vs Tustin" and
// "how's the San Diego market right now" both work without "in".
// Longer names win, so "San Diego" isn't also counted as "Diego", and results
// keep the order they appear in the question.
export function findCities(text: string, cities: string[]): string[] {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9' -]/g, " ")} `;
  const taken: [number, number][] = [];
  const hits: { city: string; at: number }[] = [];
  for (const city of [...cities].sort((a, b) => b.length - a.length)) {
    const name = city.toLowerCase().trim();
    if (name.length < 3) continue;
    const re = new RegExp(`(?<=[\\s-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s'-])`, "g");
    for (const m of lower.matchAll(re)) {
      const start = m.index!;
      const end = start + name.length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      hits.push({ city, at: start });
    }
  }
  const seen = new Set<string>();
  return hits
    .sort((a, b) => a.at - b.at)
    .map((h) => h.city)
    .filter((c) => !seen.has(c) && seen.add(c));
}
