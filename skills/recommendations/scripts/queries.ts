import { query } from "../../mls-integration/scripts/db.ts";
import { ACTIVE_COLUMNS, type ListingRow } from "../../mls-integration/scripts/queries.ts";
import { dataWindows } from "../../market-analytics/scripts/analyze.ts";
import { getDataRange } from "../../market-analytics/scripts/market.ts"

const MAX_CANDIDATES = 200;

export async function findTarget(text: string): Promise<ListingRow[]> {
    const cleanedText = text.trim().split(/\s+/).join(" ");
    if (cleanedText === "") return [];
    
    if (/^\d+$/.test(cleanedText)) {
        return query<ListingRow>(
            `SELECT ${ACTIVE_COLUMNS} FROM rets_property
            WHERE L_ListingID = ? OR L_DisplayId = ?
            ORDER BY L_Status = 'Active' DESC
            LIMIT 5`,
            [cleanedText, cleanedText], 
        );
    }

    const address = cleanedText.replaceAll(".", "");
    return query<ListingRow>(
        `SELECT ${ACTIVE_COLUMNS} FROM rets_property
        WHERE REPLACE(L_Address, '.', '') LIKE ?
        ORDER BY L_Status = 'Active' DESC
        LIMIT 5`,
        [`%${address}%`],
    );

}

export async function getCandidates(target: ListingRow): Promise<ListingRow[]> {
    const clauses: string[] = ['L_Status = ?', 'L_ListingID <> ?'];
    const params: (string | number)[] = ["Active", String(target.L_ListingID)];

    if (target.type != null) {
        clauses.push("L_Type_ = ?");
        params.push(target.type);
    }

    if (target.price != null) {
        clauses.push("L_SystemPrice BETWEEN ? AND ?");
        params.push(Math.round(target.price * 0.5), Math.round(target.price * 1.5));
    }

    const sql = `SELECT ${ACTIVE_COLUMNS} FROM rets_property
        WHERE ${clauses.join(" AND ")}
        ORDER BY L_City = ? DESC, ABS(L_SystemPrice - ?) ASC, L_ListingID
        LIMIT ${MAX_CANDIDATES}`;
    params.push(target.L_City ?? "", target.price ?? 0);

    return query<ListingRow>(sql, params)

}

export type Comps = {
    avgPpsf: number | null;
    compCount: number;
}

export async function getComps(listing: ListingRow, from: string, to: string): Promise<Comps | null> {
    if (!listing.L_City || listing.sqft == null || listing.sqft <= 0 ) return null;

    const clauses: string[] = [
        "City = ?",
        "PropertyType = ?",
        "LivingArea BETWEEN ? AND ?",
        "ClosePrice > 0",
        "CloseDate >= ?",
        "CloseDate < ?",
    ];

    const params: (string | number )[] = [
        listing.L_City,
        "Residential",
        Math.round(listing.sqft * 0.8),
        Math.round(listing.sqft * 1.2),
        from, 
        to,
    ];

    if (listing.type != null) {
        clauses.push("PropertySubType = ?");
        params.push(listing.type);
    }

    const [row] = await query<{ avg_ppsf: number | null; comp_count: number}>(
        `SELECT AVG(ClosePrice / NULLIF(LivingArea, 0)) AS avg_ppsf, COUNT(*) AS comp_count
        FROM california_sold
        WHERE ${clauses.join(" AND ")}`,
        params,
    );
    return {avgPpsf: row?.avg_ppsf ?? null, compCount: Number(row?.comp_count ?? 0)};
}