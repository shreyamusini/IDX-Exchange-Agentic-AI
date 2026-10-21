import type { PropertyFilters } from "../../property_search/scripts/parser.ts";
import { query } from "./db.ts";

export type {PropertyFilters};
export type Param = string | number;

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;
export const DEFAULT_MONTHS = 12;
export const MAX_MONTHS = 60;

const VALID_TYPES = new Set(["Condominium", "Townhouse", "SingleFamilyResidence", "UnimprovedLand"]);
const YES = 1;
const NO = 0;

export type ListingRow = {
    L_ListingID: string;
    L_DisplayId: string | null;
    L_Address: string | null;
    L_City: string | null;
    L_Zip: string | null;
    price: number | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    type: string | null;
    status: string | null;
    lat: number | null;
    lng: number | null;
    YearBuilt: number | null;
    AssociationFee: number | null;
    DaysOnMarket: number | null;
    PoolPrivateYN: string | number | null;
    ViewYN: string | number | null;
    FireplaceYN: string | number | null;
    PhotoCount: number | null;
    LA1_UserFirstName: string | null;
    LA1_UserLastName: string | null;
    LO1_OrganizationName: string | null;
}

export type SoldRow = {
    ListingKey: string;
    UnparsedAddress: string | null;
    City: string | null;
    CloseDate: string | null;
    ClosePrice: number | null;
    OriginalListPrice: number | null;
    ListPrice: number | null;
    DaysOnMarket: number | null;
    BedroomsTotal: number | null;
    BathroomsTotalInteger: number | null;
    LivingArea: number | null;
    PropertyType: string | null;
    PropertySubType: string | null;
    YearBuilt: number | null;
    ListAgentFullName: string | null;
    ListOfficeName: string | null;
    BuyerOfficeName: string | null;
}

export type Paging = { page: number; limit: number; offset: number};

export type BuiltQuery = {
    sql: string;
    params: Param[];
    countSql: string;
    countParams: Param[];
    paging: Paging;
};

export type PagedResult<T> = Paging & { rows: T[]; total: number; totalPages: number};

function positiveNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}
 
function yesNo(v: unknown): "True" | "False" | null {
  return v === "True" || v === "False" ? v : null;
}
 
export function sanitizeFilters(input: unknown): PropertyFilters {
  const f = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const city = typeof f.city === "string" ? f.city.trim().slice(0, 60) : "";
  const type = typeof f.type === "string" && VALID_TYPES.has(f.type) ? f.type : null;
  return {
    city: city || null,
    maxPrice: positiveNumber(f.maxPrice),
    beds: positiveNumber(f.beds),
    baths: positiveNumber(f.baths),
    sqft: positiveNumber(f.sqft),
    type,
    pool: yesNo(f.pool),
    hasView: yesNo(f.hasView),
    maxHOA: positiveNumber(f.maxHOA),
  };
}
 
export function normalizePaging(page: unknown = 1, limit: unknown = DEFAULT_LIMIT): Paging {
  const p = Math.floor(Number(page));
  const l = Math.floor(Number(limit));
  const safePage = Number.isFinite(p) && p >= 1 ? p : 1;
  const safeLimit = Number.isFinite(l) && l >= 1 ? Math.min(l, MAX_LIMIT) : DEFAULT_LIMIT;
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}
 
export function normalizeMonths(months: unknown = DEFAULT_MONTHS): number {
  const m = Math.floor(Number(months));
  return Number.isFinite(m) && m >= 1 ? Math.min(m, MAX_MONTHS) : DEFAULT_MONTHS;
}
 
 
const ACTIVE_COLUMNS = `
  L_ListingID, L_DisplayId, L_Address, L_City, L_Zip,
  L_SystemPrice AS price, L_Keyword2 AS beds, LM_Dec_3 AS baths,
  LM_Int2_3 AS sqft, L_Type_ AS type, L_Status AS status,
  LMD_MP_Latitude AS lat, LMD_MP_Longitude AS lng,
  YearBuilt, AssociationFee, DaysOnMarket,
  PoolPrivateYN, ViewYN, FireplaceYN, PhotoCount,
  LA1_UserFirstName, LA1_UserLastName, LO1_OrganizationName`;

function yesNoClause(clauses: string[], params: Param[], column: string, value: "True" | "False") {
  if (value === "True") {
    clauses.push(`${column} = ?`);
    params.push(YES);
  } else {
    clauses.push(`(${column} IS NULL OR ${column} = ?)`);
    params.push(NO);
  }
}

function activeWhere(f: PropertyFilters): { where: string; params: Param[] } {
  const clauses = ["L_Status = ?"];
  const params: Param[] = ["Active"];
 
  if (f.city != null) { clauses.push("L_City = ?"); params.push(f.city); }
  if (f.maxPrice != null) { clauses.push("L_SystemPrice <= ?"); params.push(f.maxPrice); }
  if (f.beds != null) { clauses.push("L_Keyword2 >= ?"); params.push(f.beds); }
  if (f.baths != null) { clauses.push("LM_Dec_3 >= ?"); params.push(f.baths); }
  if (f.sqft != null) { clauses.push("LM_Int2_3 >= ?"); params.push(f.sqft); }
  if (f.type != null) { clauses.push("L_Type_ = ?"); params.push(f.type); }
  if (f.pool != null) yesNoClause(clauses, params, "PoolPrivateYN", f.pool);
  if (f.hasView != null) yesNoClause(clauses, params, "ViewYN", f.hasView);
  if (f.maxHOA != null) {
    clauses.push("(AssociationFee IS NULL OR AssociationFee <= ?)");
    params.push(f.maxHOA);
  }
 
  return { where: clauses.join(" AND "), params };
}
 
export function buildActiveSearch(filters: PropertyFilters, page?: unknown, limit?: unknown): BuiltQuery {
  const paging = normalizePaging(page, limit);
  const { where, params } = activeWhere(filters);
  return {
   
    sql:
      `SELECT ${ACTIVE_COLUMNS}\nFROM rets_property\nWHERE ${where}\n` +
      `ORDER BY L_SystemPrice ASC, L_ListingID ASC\nLIMIT ${paging.limit} OFFSET ${paging.offset}`,
    params,
    countSql: `SELECT COUNT(*) AS total FROM rets_property WHERE ${where}`,
    countParams: [...params],
    paging,
  };
}
 

 
export type SoldOptions = { months?: unknown; page?: unknown; limit?: unknown };
 
const SOLD_COLUMNS = `
  ListingKey, UnparsedAddress, City, CloseDate, ClosePrice,
  OriginalListPrice, ListPrice, DaysOnMarket,
  BedroomsTotal, BathroomsTotalInteger, LivingArea,
  PropertyType, PropertySubType, YearBuilt,
  ListAgentFullName, ListOfficeName, BuyerOfficeName`;
 

export function unsupportedSoldFilters(f: PropertyFilters): string[] {
  const ignored: string[] = [];
  if (f.pool != null) ignored.push("pool");
  if (f.hasView != null) ignored.push("view");
  if (f.maxHOA != null) ignored.push("HOA");
  return ignored;
}
 
export function buildSoldComps(filters: PropertyFilters, options: SoldOptions = {}): BuiltQuery & { months: number } {
  if (!filters.city) throw new Error("Sold comps need a city.");
 
  const months = normalizeMonths(options.months);
  const paging = normalizePaging(options.page, options.limit);
  const clauses = [
    "City = ?",
    "CloseDate >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)",
    "PropertyType = ?",
  ];
  const params: Param[] = [filters.city, months, "Residential"];
 
  if (filters.maxPrice != null) { clauses.push("ClosePrice <= ?"); params.push(filters.maxPrice); }
  if (filters.beds != null) { clauses.push("BedroomsTotal >= ?"); params.push(filters.beds); }
  
  if (filters.baths != null) { clauses.push("BathroomsTotalInteger >= ?"); params.push(Math.floor(filters.baths)); }
  if (filters.sqft != null) { clauses.push("LivingArea >= ?"); params.push(filters.sqft); }
  if (filters.type != null) { clauses.push("PropertySubType = ?"); params.push(filters.type); }
 
  const where = clauses.join(" AND ");
  return {
    sql:
      `SELECT ${SOLD_COLUMNS}\nFROM california_sold\nWHERE ${where}\n` +
      `ORDER BY CloseDate DESC, ListingKey ASC\nLIMIT ${paging.limit} OFFSET ${paging.offset}`,
    params,
    countSql: `SELECT COUNT(*) AS total FROM california_sold WHERE ${where}`,
    countParams: [...params],
    paging,
    months,
  };
}
 
 
async function runPaged<T>(built: BuiltQuery): Promise<PagedResult<T>> {
  const [rows, countRows] = await Promise.all([
    query<T>(built.sql, built.params),
    query<{ total: number }>(built.countSql, built.countParams),
  ]);
  const total = Number(countRows[0]?.total ?? 0);
  return {
    ...built.paging,
    rows,
    total,
    totalPages: Math.max(1, Math.ceil(total / built.paging.limit)),
  };
}
 
export async function searchActiveListings(
  filters: PropertyFilters,
  page = 1,
  limit = DEFAULT_LIMIT,
): Promise<PagedResult<ListingRow>> {
  return runPaged<ListingRow>(buildActiveSearch(filters, page, limit));
}
 
export async function getSoldComps(
  filters: PropertyFilters,
  options: SoldOptions = {},
): Promise<PagedResult<SoldRow> & { months: number }> {
  const built = buildSoldComps(filters, options);
  return { ...(await runPaged<SoldRow>(built)), months: built.months };
}
 