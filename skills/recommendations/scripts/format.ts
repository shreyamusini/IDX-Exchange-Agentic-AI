import { listingCard, money, type Listing } from "../../mls-integration/scripts/format.ts"
import type { PriceAssessment } from "./assess.ts";

export type Recommendation = {
    listing: Listing;
    score: number;
    assessment: PriceAssessment;
};

function place(l: Listing): string {
    return [l.address, l.city].filter(Boolean).join(", ") || `MLS# ${l.mlsNumber ?? l.id}`;
}

export function assessmentLine(a: PriceAssessment): string {
    if (a.status === "no-data") return `💲 Price check: not enough data (${a.reason})`;

    const pct = `${a.deltaPct > 0 ? "+" : ""}${a.deltaPct}%`;
    const headline = 
        a.verdict === "in line"
        ? `In line with comps (${pct})`
        : `Priced ${Math.abs(a.deltaPct)}% ${a.verdict} comps`;
    const sales = a.lowConfidence ? `only ${a.compCount} sale${a.compCount === 1 ? "" : "s"}` : `${a.compCount} sales`;
    return `💲 ${headline} · comps suggest ${money(a.compPrice)} at ${money(a.avgPpsf)}/sqft · ${sales}`;
}

export function recommedationsMessage(
    target: Listing,
    recs: Recommendation[],
    compWindow: string,
    usedEmbeddings: boolean,
): string {
    if (recs.length === 0) {
        return `I couldn't find active listings similar to ${place(target)}.`
    }
    const cards = recs.map((r, i) => 
    [listingCard(r.listing, i + 1), `🎯 Similarity ${Math.round(r.score)}/100`, assessmentLine(r.assessment)].join("\n"),
  );

  const lines = [
    `🏡 *Homes like ${place(target)}*`,
    `Price checks use sales from ${compWindow}`,
    "",
    cards.join("\n\n"),
    "",
  ];
  if (!usedEmbeddings) {
    lines.push("_Matched on price, beds, city, and size only; this listing's description wasn't available._");
  }
  lines.push("_Price checks compare with the average $/sqft of similar recent sales. They're an estimate, not an appraisal._");
  return lines.join("\n");
}

export function whichOneMessage(matches: Listing[]): string {
    const options = matches.map(
        (l, i) => `${i + 1}. ${place(l)} · ${money(l.price) ?? "price n/a"} · ${l.status ?? ""} · MLS# ${l.mlsNumber ?? l.id}`,
    );
    return ["I found a few listings that match. Which one did you mean? Reply with its MLS number.", "", ...options].join("\n");
}

export function notFoundMessage(text: string): string {
    return `I couldn't find a listing matching "${text}". Try the MLS number, or the street address like "350 S Fairway Dr".`;
}