import type { Comps } from "./queries.ts"

export const IN_LINE_PCT = 5;
export const MIN_CONFIDENT_COMPS = 3;

export type PriceAssessment = 
| {
    status: "assessed";
    listPrice: number;
    compPrice: number;
    avgPpsf: number;
    compCount: number;
    deltaPct: number;
    verdict: "below" | "in line" | "above";
    lowConfidence: boolean;
}
| {
    status: "no-data",
    reason: string;
}

export function assessPrice(price: number | null, sqft: number | null, comps: Comps | null): PriceAssessment {
    if (price == null || price <= 0) return {status: "no-data", reason: "no list price"};
    if (sqft == null || sqft <= 0 || comps == null) return { status: "no-data", reason: "no city or square footage to compare"};
    if (comps.compCount === 0 || comps.avgPpsf == null) return {status: "no-data", reason: "no similar recent sales"};

    const compPrice = Math.round(comps.avgPpsf * sqft);
    const deltaPct = Math.round(((price - compPrice) / compPrice) * 1000) / 10;

    let verdict: "below" | "in line" | "above" = "in line";
    if (deltaPct > IN_LINE_PCT) verdict = 'above';
    else if (deltaPct < -IN_LINE_PCT) verdict = 'below';

    return {
        status: 'assessed',
        listPrice: price,
        compPrice,
        avgPpsf: Math.round(comps.avgPpsf),
        compCount: comps.compCount,
        deltaPct,
        verdict, 
        lowConfidence: comps.compCount < MIN_CONFIDENT_COMPS,
    };
}



