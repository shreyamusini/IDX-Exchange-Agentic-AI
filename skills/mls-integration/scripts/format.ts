import { PropertyFilters, type ListingRow, type SoldRow } from "./queries.ts";

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
}

const TYPE_LABELS: Record<string, string> = {
    Condominium: "Condo",
    Townhouse: "Townhouse",
    SingleFamilyResidence: "Single Family",
    UnimprovedLand: "Land",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function num(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s ? s: null;
}

export function yesNo(v:unknown): boolean | null {
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
    return t ? (TYPE_LABELS[t] ?? t): null;
}

function joinParts(parts: (string | null | false | undefined)[], sep = " . "): string {
    return parts.filter(Boolean).join(sep);
}

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
    saleToListPct: closePrice !== null && listPrice ? Math.round((closePrice / listPrice) * 1000) / 10 : null,
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

export function listingCard(l: Listing, n: number): string {
    const place = joinParts([l.address, joinParts([l.city, l.zip], " ")], ", ");
    const features = [
        l.pool && "Pool",
        l.view && "View",
        l.fireplace && "Fireplace",
        l.hoaFee === null ? null: l.hoaFee === 0? "No HOA" : `HOA ${money(l.hoaFee)}/mo`,
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

