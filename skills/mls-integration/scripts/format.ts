// Turns raw database rows into clean objects for other agents, and into
// WhatsApp-ready property cards for people.
import type { ListingRow, PropertyFilters, SoldRow } from "./queries.ts";

export type Listing = {
  id: string;
  mlsNumber: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  type: string | null;
  status: string | null;
  yearBuilt: number | null;
  hoaFee: number | null;
  daysOnMarket: number | null;
  pool: boolean | null;
  view: boolean | null;
  fireplace: boolean | null;
  photoCount: number | null;
  agent: string | null;
  office: string | null;
  lat: number | null;
  lng: number | null;
};

export type SoldComp = {
  id: string;
  address: string | null;
  city: string | null;
  closeDate: string | null;
  closePrice: number | null;
  listPrice: number | null;
  originalListPrice: number | null;
  saleToListPct: number | null;
  daysOnMarket: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  propertyType: string | null;
  propertySubType: string | null;
  yearBuilt: number | null;
  listAgent: string | null;
  listOffice: string | null;
  buyerOffice: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  Condominium: "Condo",
  Townhouse: "Townhouse",
  SingleFamilyResidence: "Single Family",
  UnimprovedLand: "Land",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- value helpers ----------

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// MLS data stores yes/no in several ways: "True", "Y", "Yes", 1, and so on.
export function yesNo(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (["true", "y", "yes", "1"].includes(s)) return true;
  if (["false", "n", "no", "0"].includes(s)) return false;
  return null;
}

export function money(n: number | null): string | null {
  if (n === null) return null;
  return "$" + Math.round(n).toLocaleString("en-US");
}

function shortMoney(n: number): string {
  if (n >= 1_000_000) return `$${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function count(n: number | null): string | null {
  return n === null ? null : Math.round(n).toLocaleString("en-US");
}

export function formatDate(d: string | null): string | null {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function typeLabel(t: string | null): string | null {
  return t ? (TYPE_LABELS[t] ?? t) : null;
}

function joinParts(parts: (string | null | false | undefined)[], sep = " · "): string {
  return parts.filter(Boolean).join(sep);
}

// ---------- clean objects ----------

export function toListing(r: ListingRow): Listing {
  const agent = joinParts([text(r.LA1_UserFirstName), text(r.LA1_UserLastName)], " ");
  return {
    id: String(r.L_ListingID),
    mlsNumber: text(r.L_DisplayId),
    address: text(r.L_Address),
    city: text(r.L_City),
    zip: text(r.L_Zip),
    price: num(r.price),
    beds: num(r.beds),
    baths: num(r.baths),
    sqft: num(r.sqft),
    type: text(r.type),
    status: text(r.status),
    yearBuilt: num(r.YearBuilt),
    hoaFee: num(r.AssociationFee),
    daysOnMarket: num(r.DaysOnMarket),
    pool: yesNo(r.PoolPrivateYN),
    view: yesNo(r.ViewYN),
    fireplace: yesNo(r.FireplaceYN),
    photoCount: num(r.PhotoCount),
    agent: agent || null,
    office: text(r.LO1_OrganizationName),
    lat: num(r.lat),
    lng: num(r.lng),
  };
}

export function toSoldComp(r: SoldRow): SoldComp {
  const closePrice = num(r.ClosePrice);
  const listPrice = num(r.ListPrice);
  return {
    id: String(r.ListingKey),
    address: text(r.UnparsedAddress),
    city: text(r.City),
    closeDate: text(r.CloseDate),
    closePrice,
    listPrice,
    originalListPrice: num(r.OriginalListPrice),
    saleToListPct:
      closePrice !== null && listPrice ? Math.round((closePrice / listPrice) * 1000) / 10 : null,
    daysOnMarket: num(r.DaysOnMarket),
    beds: num(r.BedroomsTotal),
    baths: num(r.BathroomsTotalInteger),
    sqft: num(r.LivingArea),
    propertyType: text(r.PropertyType),
    propertySubType: text(r.PropertySubType),
    yearBuilt: num(r.YearBuilt),
    listAgent: text(r.ListAgentFullName),
    listOffice: text(r.ListOfficeName),
    buyerOffice: text(r.BuyerOfficeName),
  };
}

// ---------- WhatsApp cards ----------
// WhatsApp formatting: *bold*. Missing fields are left out instead of showing "null".

export function listingCard(l: Listing, n: number): string {
  const place = joinParts([l.address, joinParts([l.city, l.zip], " ")], ", ");
  const features = [
    l.pool && "Pool",
    l.view && "View",
    l.fireplace && "Fireplace",
    l.hoaFee === null ? null : l.hoaFee === 0 ? "No HOA" : `HOA ${money(l.hoaFee)}/mo`,
  ];
  const listedBy = joinParts([l.agent, l.office], ", ");

  const lines = [
    `*${n}. ${place || "Address not listed"}*`,
    joinParts([
      money(l.price) && `💰 ${money(l.price)}`,
      l.beds !== null && `${count(l.beds)} bd`,
      l.baths !== null && `${l.baths} ba`,
      l.sqft !== null && `${count(l.sqft)} sqft`,
    ]),
    joinParts([
      typeLabel(l.type) && `🏠 ${typeLabel(l.type)}`,
      l.yearBuilt !== null && `Built ${l.yearBuilt}`,
      l.daysOnMarket !== null && `${count(l.daysOnMarket)} days on market`,
    ]),
    features.some(Boolean) ? `✨ ${joinParts(features)}` : null,
    joinParts([l.mlsNumber && `🔖 MLS# ${l.mlsNumber}`, listedBy]),
  ];
  return lines.filter(Boolean).join("\n");
}

export function soldCard(s: SoldComp, n: number): string {
  const sold = joinParts(
    [
      money(s.closePrice) && `✅ Sold ${money(s.closePrice)}`,
      formatDate(s.closeDate) && `on ${formatDate(s.closeDate)}`,
      s.saleToListPct !== null && `(${s.saleToListPct}% of list)`,
    ],
    " ",
  );
  const lines = [
    `*${n}. ${s.address || "Address not listed"}*`,
    sold,
    joinParts([
      typeLabel(s.propertySubType) && `🏠 ${typeLabel(s.propertySubType)}`,
      s.beds !== null && `${count(s.beds)} bd`,
      s.baths !== null && `${s.baths} ba`,
      s.sqft !== null && `${count(s.sqft)} sqft`,
      s.yearBuilt !== null && `Built ${s.yearBuilt}`,
    ]),
    joinParts([
      s.daysOnMarket !== null && `⏱️ ${count(s.daysOnMarket)} days on market`,
      s.listAgent && `Listed by ${joinParts([s.listAgent, s.listOffice], ", ")}`,
    ]),
  ];
  return lines.filter(Boolean).join("\n");
}

// ---------- result messages ----------

// Short readable summary of the filters, e.g. "Irvine · Condo · 3+ bd · under $1.5M · pool".
export function describeFilters(f: PropertyFilters): string {
  return joinParts([
    f.city,
    typeLabel(f.type),
    f.beds !== null && `${f.beds}+ bd`,
    f.baths !== null && `${f.baths}+ ba`,
    f.sqft !== null && `${count(f.sqft)}+ sqft`,
    f.maxPrice !== null && `under ${shortMoney(f.maxPrice)}`,
    f.pool === "True" && "pool",
    f.pool === "False" && "no pool",
    f.hasView === "True" && "view",
    f.hasView === "False" && "no view",
    f.maxHOA !== null && (f.maxHOA === 0 ? "no HOA" : `HOA under ${shortMoney(f.maxHOA)}`),
  ]);
}

type PageInfo = { page: number; limit: number; offset: number; total: number; totalPages: number };

function rangeLine(p: PageInfo, shown: number): string {
  const from = p.offset + 1;
  const to = p.offset + shown;
  return `Showing ${from}–${to} of ${p.total.toLocaleString("en-US")} (page ${p.page} of ${p.totalPages})`;
}

function moreLine(p: PageInfo): string | null {
  return p.page < p.totalPages ? `Reply *more* to see the next ${p.limit}.` : null;
}

export function activeMessage(filters: PropertyFilters, p: PageInfo, listings: Listing[]): string {
  const desc = describeFilters(filters);
  if (p.total === 0) {
    return `🔎 No active listings found${desc ? ` for ${desc}` : ""}.\nTry a higher price or fewer filters.`;
  }
  if (listings.length === 0) {
    return `🔎 That's the end of the results. There were ${p.total} active listings${desc ? ` for ${desc}` : ""}.`;
  }
  const header = `🔎 *${p.total.toLocaleString("en-US")} active listing${p.total === 1 ? "" : "s"}*${desc ? ` · ${desc}` : ""}`;
  return [
    header,
    rangeLine(p, listings.length),
    ...listings.map((l, i) => listingCard(l, p.offset + i + 1)),
    moreLine(p),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function soldMessage(
  filters: PropertyFilters,
  p: PageInfo & { months: number },
  comps: SoldComp[],
  ignored: string[] = [],
): string {
  const desc = describeFilters({ ...filters, pool: null, hasView: null, maxHOA: null });
  const period = `last ${p.months} month${p.months === 1 ? "" : "s"}`;
  const note = ignored.length ? `(Sold records don't include ${ignored.join(", ")}, so ${ignored.length === 1 ? "that filter was" : "those filters were"} skipped.)` : null;

  if (p.total === 0) {
    return [`📉 No residential sales found${desc ? ` for ${desc}` : ""} in the ${period}.`, note]
      .filter(Boolean)
      .join("\n");
  }
  if (comps.length === 0) {
    return `📉 That's the end of the results. There were ${p.total} sales${desc ? ` for ${desc}` : ""} in the ${period}.`;
  }
  const header = `📉 *${p.total.toLocaleString("en-US")} sold comp${p.total === 1 ? "" : "s"}*${desc ? ` · ${desc}` : ""} · ${period}`;
  return [
    header,
    note,
    rangeLine(p, comps.length),
    ...comps.map((c, i) => soldCard(c, p.offset + i + 1)),
    moreLine(p),
  ]
    .filter(Boolean)
    .join("\n\n");
}