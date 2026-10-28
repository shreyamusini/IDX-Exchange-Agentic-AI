// SQL for market stats over california_sold (sold homes) and rets_property (active listings).
// Every user value is a ? placeholder. Column names, grouping, and LIMIT come from code only.
// Uses the mls-integration database connection, so it shares that skill's .env.
import { query } from "../../mls-integration/scripts/db.ts";
import type { DataRange, StatsRow } from "./analyze.ts";

export type MarketFilters = {
  city: string | null;
  zip: string | null;
  type: string | null; // PropertySubType, e.g. "Condominium"
};

export const SUBTYPES = ["SingleFamilyResidence", "Condominium", "Townhouse"] as const;

type Built = { sql: string; params: (string | number)[] };

// Rows every stat is based on: residential sales with a real price and size, in [from, to).
// Matches the handbook's filters (Residential, LivingArea > 0) and also drops $0 sales.
export function soldWhere(f: MarketFilters, from: string, to: string): Built {
  const clauses = ["PropertyType = ?", "CloseDate >= ?", "CloseDate < ?", "ClosePrice > 0", "LivingArea > 0"];
  const params: (string | number)[] = ["Residential", from, to];
  if (f.city) { clauses.push("City = ?"); params.push(f.city); }
  if (f.zip) { clauses.push("PostalCode = ?"); params.push(f.zip); }
  if (f.type) { clauses.push("PropertySubType = ?"); params.push(f.type); }
  return { sql: clauses.join(" AND "), params };
}

// How sales are grouped: by calendar month, or into this year vs. the year before.
export type Grouping = { kind: "month" } | { kind: "period"; currentFrom: string };

// MySQL has no MEDIAN(), so medians use window functions (MySQL 8+ / MariaDB 10.2+):
// number the rows in each group from lowest to highest, then average the middle one
// (odd count) or two (even count). Days on market can be NULL, so it gets its own
// numbering with NULLs last and its own count.
export function buildStatsQuery(f: MarketFilters, from: string, to: string, group: Grouping): Built {
  const where = soldWhere(f, from, to);
  const bucket =
    group.kind === "month"
      ? "DATE_FORMAT(CloseDate, '%Y-%m')"
      : "CASE WHEN CloseDate >= ? THEN 'current' ELSE 'prior' END";
  const bucketParams = group.kind === "month" ? [] : [group.currentFrom];
  const mid = (rn: string, n: string) => `${rn} IN (FLOOR((${n} + 1) / 2), CEIL((${n} + 1) / 2))`;

  const sql = `
SELECT bucket,
  COUNT(*) AS sales,
  ROUND(AVG(price), 0) AS avg_price,
  ROUND(AVG(CASE WHEN ${mid("rn_price", "n")} THEN price END), 0) AS median_price,
  ROUND(AVG(ppsf), 0) AS avg_ppsf,
  ROUND(AVG(CASE WHEN ${mid("rn_ppsf", "n")} THEN ppsf END), 0) AS median_ppsf,
  ROUND(AVG(dom), 1) AS avg_dom,
  ROUND(AVG(CASE WHEN n_dom > 0 AND ${mid("rn_dom", "n_dom")} THEN dom END), 0) AS median_dom,
  ROUND(AVG(ratio) * 100, 1) AS list_to_close_pct
FROM (
  SELECT bucket, price, ppsf, dom, ratio,
    ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY price) AS rn_price,
    ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY ppsf) AS rn_ppsf,
    ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY dom IS NULL, dom) AS rn_dom,
    COUNT(*) OVER (PARTITION BY bucket) AS n,
    COUNT(dom) OVER (PARTITION BY bucket) AS n_dom
  FROM (
    SELECT ${bucket} AS bucket,
      ClosePrice AS price,
      ClosePrice / LivingArea AS ppsf,
      CASE WHEN DaysOnMarket >= 0 THEN DaysOnMarket END AS dom,
      CASE WHEN ListPrice > 0 AND ClosePrice / ListPrice BETWEEN 0.5 AND 1.5
           THEN ClosePrice / ListPrice END AS ratio
    FROM california_sold
    WHERE ${where.sql}
  ) s
) r
GROUP BY bucket
ORDER BY bucket`;
  return { sql, params: [...bucketParams, ...where.params] };
}

export async function getStats(f: MarketFilters, from: string, to: string, group: Grouping): Promise<StatsRow[]> {
  const { sql, params } = buildStatsQuery(f, from, to, group);
  return query<StatsRow>(sql, params);
}

// Active listings in rets_property for the same area and type. `covered` is false when
// the listings table has no rows at all for the area, which usually means the data
// export doesn't include that region, not that nothing is for sale.
export function buildInventoryQuery(f: MarketFilters): Built {
  const clauses: string[] = [];
  const params: (string | number)[] = ["Active"];
  if (f.city) { clauses.push("L_City = ?"); params.push(f.city); }
  if (f.zip) { clauses.push("L_Zip = ?"); params.push(f.zip); }
  if (f.type) { clauses.push("L_Type_ = ?"); params.push(f.type); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return {
    sql: `SELECT COUNT(*) AS total, COALESCE(SUM(L_Status = ?), 0) AS active FROM rets_property ${where}`,
    params,
  };
}

export async function getInventory(f: MarketFilters): Promise<{ active: number; covered: boolean }> {
  const { sql, params } = buildInventoryQuery(f);
  const [row] = await query<{ total: number; active: number }>(sql, params);
  return { active: Number(row?.active ?? 0), covered: Number(row?.total ?? 0) > 0 };
}

// The handbook's "City Market Summary": busiest cities by number of sales.
export type CityRow = {
  City: string;
  sold_count: number;
  avg_close_price: number;
  avg_price_per_sqft: number;
  avg_dom: number | null;
  list_to_close_pct: number | null;
};

export function buildTopCitiesQuery(from: string, to: string, limit: number, type: string | null = null): Built {
  const n = Math.min(Math.max(Math.trunc(Number(limit)) || 10, 1), 25); // validated integer, never user text
  const where = soldWhere({ city: null, zip: null, type }, from, to);
  return {
    sql: `
SELECT City,
  COUNT(*) AS sold_count,
  ROUND(AVG(ClosePrice), 0) AS avg_close_price,
  ROUND(AVG(ClosePrice / NULLIF(LivingArea, 0)), 0) AS avg_price_per_sqft,
  ROUND(AVG(DaysOnMarket), 1) AS avg_dom,
  ROUND(AVG(ClosePrice / NULLIF(ListPrice, 0)) * 100, 1) AS list_to_close_pct
FROM california_sold
WHERE ${where.sql} AND City IS NOT NULL
GROUP BY City
ORDER BY sold_count DESC, City
LIMIT ${n}`,
    params: where.params,
  };
}

export async function getTopCities(from: string, to: string, limit: number, type: string | null = null): Promise<CityRow[]> {
  const { sql, params } = buildTopCitiesQuery(from, to, limit, type);
  return query<CityRow>(sql, params);
}

// The first and last sale date in the table, so stats can skip partial months.
export async function getDataRange(): Promise<DataRange> {
  const [row] = await query<{ first: string | null; last: string | null }>(
    "SELECT MIN(CloseDate) AS first, MAX(CloseDate) AS last FROM california_sold WHERE PropertyType = ? AND ClosePrice > 0",
    ["Residential"],
  );
  return { first: row?.first ?? null, last: row?.last ?? null };
}

// --- Finding the city in a question ---------------------------------------------

// The exact spelling stored in the table, or null when there are no sales for that name.
export async function canonicalCity(name: string): Promise<string | null> {
  const rows = await query<{ City: string }>(
    "SELECT City FROM california_sold WHERE City = ? AND PropertyType = ? LIMIT 1",
    [name, "Residential"],
  );
  return rows[0]?.City ?? null;
}

export async function knownCities(): Promise<string[]> {
  const rows = await query<{ City: string }>(
    "SELECT DISTINCT City FROM california_sold WHERE City IS NOT NULL AND PropertyType = ?",
    ["Residential"],
  );
  return rows.map((r) => r.City);
}
