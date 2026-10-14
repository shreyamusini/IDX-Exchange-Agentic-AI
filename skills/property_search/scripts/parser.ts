// Natural-language parser for real estate queries.
// Turns free text into a structured filter object for rets_property table

export type PropertyFilters = {
    city: string | null;
    maxPrice: number | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    type: string | null;
    pool: "True" | "False" | null;
    hasView: "True" | "False" | null;
    maxHOA: number | null;
};

export type DbFilter = {
    column: string;
    op: "=" | "<=" | ">=";
    value: string | number;
}

const COLUMN_MAP: Record<keyof PropertyFilters, { column: string; op: DbFilter["op"] }> = {
    city: {column: "L_City", op: "="},
    maxPrice: { column: "L_SystemPrice", op: "<="},
    beds: { column: "L_Keyword2", op: ">="},
    baths: { column: "LM_Dec_3", op: ">="},
    sqft: { column: "LM_Int2_3", op: ">="},
    type: {column: "L_Type_", op: "="},
    pool: {column: "PoolPrivateYN", op:"="},
    hasView: {column: "ViewYN", op: "="},
    maxHOA: {column: "AssociationFee", op: "<="},
};

const TYPE_MAP: [RegExp, string][] = [
    [/\btownho(?:me|use)s?\b/i, "Townhouse"],
  [/\bcondo(?:minium)?s?\b/i, "Condominium"],
  [/\bsingle[\s-]?family\b|\bsfr\b|\bhouses?\b/i, "SingleFamilyResidence"],
  [/\b(?:land|lots?|vacant lots?)\b/i, "UnimprovedLand"],
];

const NUMBER_WORDS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

const CITY_STOP =
  "under|below|less|max|maximum|up|no|with|without|w\\/|for|at|that|and|priced|over|around|near|having|has|which|where";

const NUM = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?)";
const MONEY_SUFFIX = "\\s*(k|m|mil|million|thousand)?\\b";

function toAmount(raw: string, suffix?: string): number {
    let n = Number(raw.replace(/,/g, ""))
    const s = suffix?.toLowerCase();
    if (s === "k" || s === "thousand") n *= 1_000;
    if (s === "m" || s === "mil" || s === "million") n *= 1_000_000;
    return Math.round(n);
}

function titleCase(s: string): string {
    return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function wordToNumber(w: string): number {
    return NUMBER_WORDS[w.toLowerCase()] ?? Number(w);
}

export async function parsePropertyQuery(query: string): Promise<PropertyFilters> {
    let text = ` ${query.replace(/\s+/g, " ").trim()} `;

    let maxHOA: number | null = null;
    const noHOA = /\bno hoa\b|\bwithout (?:an? )?hoa\b/i;
    const hoaMatch = text.match(
        new RegExp(
      `\\bhoa(?:\\s+fees?)?\\s*(?:under|below|less than|max(?:imum)?|up to|of at most|<=?|no more than)?\\s*\\$?${NUM}${MONEY_SUFFIX}(?:\\s*(?:\\/|a|per)\\s*(?:mo|month))?`,
      "i",
    ),
    );
    if (noHOA.test(text)) {
    maxHOA = 0;
    text = text.replace(noHOA, " ");
  } else if (hoaMatch) {
    maxHOA = toAmount(hoaMatch[1], hoaMatch[2]);
    text = text.replace(hoaMatch[0], " ");
  }
 
  // Square footage before price, so "2k sq ft" isn't read as a price.
  let sqft: number | null = null;
  const sqftMatch = text.match(
    new RegExp(`${NUM}\\s*(k)?\\+?\\s*(?:sq\\.?\\s*ft\\.?|sqft|square\\s*f(?:ee|oo)t)`, "i"),
  );
  if (sqftMatch) {
    sqft = toAmount(sqftMatch[1], sqftMatch[2]);
    text = text.replace(sqftMatch[0], " ");
  }
 
  // Max price: "under $1.5M", "below 900k", "less than $1,200,000", "max 2 million".
  let maxPrice: number | null = null;
  const priceMatch = text.match(
    new RegExp(
      `\\b(?:under|below|less than|max(?:imum)?|up to|no more than|at most|budget(?: of)?|<=?)\\s*\\$?${NUM}${MONEY_SUFFIX}`,
      "i",
    ),
  );
  if (priceMatch) maxPrice = toAmount(priceMatch[1], priceMatch[2]);
 
  // Bedrooms: "3-bedroom", "3 beds", "3br", "3+ bd", "three bedrooms".
  const bedsMatch = text.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight)\s*\+?\s*-?\s*(?:bed(?:room)?s?|br|bd)\b/i,
  );
  const beds = bedsMatch ? wordToNumber(bedsMatch[1]) : null;
 
  // Bathrooms: "2.5 baths", "2 bathrooms", "2ba".
  const bathsMatch = text.match(
    /\b(\d+(?:\.5)?|one|two|three|four|five)\s*\+?\s*-?\s*(?:bath(?:room)?s?|ba)\b/i,
  );
  const baths = bathsMatch ? wordToNumber(bathsMatch[1]) : null;
 
  // Property type.
  const typeHit = TYPE_MAP.find(([re]) => re.test(text));
  const type = typeHit ? typeHit[1] : null;
 
  // Pool and view, including negations like "no pool".
  let pool: PropertyFilters["pool"] = null;
  if (/\b(?:no|without(?: a)?)\s+pool\b/i.test(text)) pool = "False";
  else if (/\bpools?\b/i.test(text)) pool = "True";
 
  let hasView: PropertyFilters["hasView"] = null;
  if (/\b(?:no|without(?: a)?)\s+views?\b/i.test(text)) hasView = "False";
  else if (/\bviews?\b/i.test(text)) hasView = "True";
 
  // City: text after "in"/"near"/"around", up to a stop word or punctuation.
  let city: string | null = null;
  const cityMatch = text.match(
    new RegExp(
      `\\b(?:in|near|around)\\s+(?!(?:a|an|the|my|your)\\b)([a-z][a-z .'-]*?)(?=\\s+(?:${CITY_STOP})\\b|\\s*[,.?!$\\d]|\\s*$)`,
      "i",
    ),
  );
  if (cityMatch) {
    const candidate = cityMatch[1].trim();
    const isTypeWord = TYPE_MAP.some(([re]) => re.test(candidate));
    if (candidate && !isTypeWord) city = titleCase(candidate);
  }
 
  return { city, maxPrice, beds, baths, sqft, type, pool, hasView, maxHOA };
}
 
export function toDbFilters(filters: PropertyFilters): DbFilter[] {
  return (Object.keys(COLUMN_MAP) as (keyof PropertyFilters)[])
    .filter((key) => filters[key] !== null)
    .map((key) => ({
      column: COLUMN_MAP[key].column,
      op: COLUMN_MAP[key].op,
      value: filters[key] as string | number,
    }));
}
