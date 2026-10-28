// Pure calculations for market stats: date windows, percent changes, trends,
// months of supply, and the buyer's/seller's market read. No database access,
// so everything here is easy to unit test.

// One row of aggregated sales, either for a month ("2026-09") or a period ("current"/"prior").
export type StatsRow = {
  bucket: string;
  sales: number;
  avg_price: number | null;
  median_price: number | null;
  avg_ppsf: number | null;
  median_ppsf: number | null;
  avg_dom: number | null;
  median_dom: number | null;
  list_to_close_pct: number | null;
};

export type Window = { from: string; to: string; label: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// --- Dates -----------------------------------------------------------------

// "YYYY-MM-01" for the first day of the month `monthsBack` months before `today`'s month.
export function monthStart(today: Date, monthsBack: number): string {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() - monthsBack, 1));
  return d.toISOString().slice(0, 10);
}

export function monthLabel(ym: string, short = false): string {
  const [y, m] = ym.split("-").map(Number);
  return short ? `${MONTHS[m - 1]} '${String(y).slice(2)}` : `${MONTHS[m - 1]} ${y}`;
}

// Stats use complete months only. The current month is still in progress, so
// including it would make the newest month look like sales collapsed.
// Returns the last `months` complete months and the same-length window before it.
export function windows(today: Date, months = 12): { current: Window; prior: Window } {
  const at = (back: number) => monthStart(today, back);
  // Label from the first month to the last complete month, e.g. "Oct 2025–Sep 2026".
  const label = (firstBack: number, lastBack: number) =>
    `${monthLabel(at(firstBack).slice(0, 7))}–${monthLabel(at(lastBack).slice(0, 7))}`;
  return {
    current: { from: at(months), to: at(0), label: label(months, 1) },
    prior: { from: at(months * 2), to: at(months), label: label(months * 2, months + 1) },
  };
}

// --- Data coverage -------------------------------------------------------------

// First and last CloseDate in california_sold. A data export starts and stops on
// some day, so its first and last months are usually partial.
export type DataRange = { first: string | null; last: string | null };

function ymd(d: string): [number, number, number] {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return [y, m, day];
}

// A date in the month after the last complete month of data, for windows().
// The last month counts as complete only if the data reaches its last 3 days.
// Never later than today.
export function dataAnchor(today: Date, range: DataRange): Date {
  if (!range.last) return today;
  const [y, m, d] = ymd(range.last);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const anchor = new Date(y, d >= daysInMonth - 2 ? m : m - 1, 15);
  return anchor < today ? anchor : today;
}

// "YYYY-MM-01" of the first complete month of data: the first month if the data
// starts in its first 3 days, otherwise the month after.
export function firstFullMonth(range: DataRange): string | null {
  if (!range.first) return null;
  const [y, m, d] = ymd(range.first);
  const start = new Date(Date.UTC(y, d <= 3 ? m - 1 : m, 1));
  return start.toISOString().slice(0, 10);
}

export type DataWindows = {
  current: Window; // the last 12 complete months, or fewer if the data starts later
  prior: Window; // the 12 months before, for year-over-year changes
  months: number; // complete months of data in `current`
  lastSale: string | null; // newest CloseDate in the data
};

// Like windows(), but based on the data instead of only today's date, so partial
// months at either end of the export are left out.
export function dataWindows(today: Date, range: DataRange, months = 12): DataWindows {
  const w = windows(dataAnchor(today, range), months);
  const start = firstFullMonth(range);
  let current = w.current;
  if (start && start > current.from) {
    const end = current.label.split("–")[1];
    current = { from: start, to: current.to, label: `${monthLabel(start.slice(0, 7))}–${end}` };
  }
  // Year-over-year needs a full year of complete months before `current`. Comparing
  // with a partial year would make changes like "+900% sales" that aren't real.
  const prior = start && start > w.prior.from ? { from: current.from, to: current.from, label: "" } : w.prior;
  return { current, prior, months: monthList(current.from, current.to).length, lastSale: range.last };
}

// Every "YYYY-MM" from `from` (inclusive) to `to` (exclusive).
export function monthList(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m < tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// --- Changes ---------------------------------------------------------------

// Percent change from `prev` to `cur`, rounded to 0.1. Null when either side is missing.
export function pctChange(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function diff(cur: number | null | undefined, prev: number | null | undefined, digits = 1): number | null {
  if (cur == null || prev == null) return null;
  const f = 10 ** digits;
  return Math.round((cur - prev) * f) / f;
}

export type Comparison = {
  medianPricePct: number | null;
  avgPricePct: number | null;
  ppsfPct: number | null;
  salesPct: number | null;
  domDays: number | null; // change in median days on market
  listToClosePts: number | null; // change in percentage points
};

export function compare(cur: StatsRow | null, prev: StatsRow | null): Comparison {
  return {
    medianPricePct: pctChange(cur?.median_price, prev?.median_price),
    avgPricePct: pctChange(cur?.avg_price, prev?.avg_price),
    ppsfPct: pctChange(cur?.median_ppsf, prev?.median_ppsf),
    salesPct: pctChange(cur?.sales, prev?.sales),
    domDays: diff(cur?.median_dom, prev?.median_dom, 0),
    listToClosePts: diff(cur?.list_to_close_pct, prev?.list_to_close_pct),
  };
}

// --- Monthly trend ---------------------------------------------------------

export type TrendPoint = StatsRow & {
  month: string;
  momPct: number | null; // median price vs the month before
  yoyPct: number | null; // median price vs the same month last year
};

// Turns monthly rows into a gap-free list (months with no sales get 0 and nulls),
// adds month-over-month and year-over-year changes, and keeps the last `keep` months.
// This is the handbook's df["avg_price"].pct_change(), using the median instead of
// the average because a few luxury sales can swing a monthly average a lot.
export function buildTrend(rows: StatsRow[], months: string[], keep = 12): TrendPoint[] {
  const byMonth = new Map(rows.map((r) => [r.bucket, r]));
  const filled = months.map((month): StatsRow & { month: string } => {
    const r = byMonth.get(month);
    return r
      ? { ...r, month }
      : {
          month, bucket: month, sales: 0, avg_price: null, median_price: null, avg_ppsf: null,
          median_ppsf: null, avg_dom: null, median_dom: null, list_to_close_pct: null,
        };
  });
  const withChanges = filled.map((p, i) => ({
    ...p,
    momPct: i > 0 ? pctChange(p.median_price, filled[i - 1].median_price) : null,
    yoyPct: i >= 12 ? pctChange(p.median_price, filled[i - 12].median_price) : null,
  }));
  return withChanges.slice(-keep);
}

// --- Inventory ---------------------------------------------------------------

// Months of supply: how long the active listings would last at the recent sales pace.
// Uses the average of the last 3 complete months so one slow month doesn't skew it.
export function monthsOfSupply(active: number | null, trend: TrendPoint[]): number | null {
  if (active == null) return null;
  const recent = trend.slice(-3);
  if (recent.length === 0) return null;
  const pace = recent.reduce((s, p) => s + p.sales, 0) / recent.length;
  if (pace === 0) return null;
  return Math.round((active / pace) * 10) / 10;
}

// --- Market read -------------------------------------------------------------

export type Lean = "buyers" | "sellers" | "balanced";
export type Signal = { favors: Lean; text: string };

// Combines common rules of thumb into a simple read. Each signal is shown to the
// user so they can see why, and the result is described as market conditions, not advice.
export function marketSignals(
  cur: StatsRow | null,
  change: Comparison,
  supply: number | null,
): { lean: Lean; signals: Signal[] } {
  const signals: Signal[] = [];
  const ltc = cur?.list_to_close_pct;
  if (ltc != null) {
    if (ltc < 98) signals.push({ favors: "buyers", text: `Homes sell for ${ltc}% of list price, so buyers are negotiating discounts` });
    else if (ltc > 100.5) signals.push({ favors: "sellers", text: `Homes sell for ${ltc}% of list price, so many sell over asking` });
    else signals.push({ favors: "balanced", text: `Homes sell close to list price (${ltc}%)` });
  }
  if (change.domDays != null && cur?.median_dom) {
    const prev = cur.median_dom - change.domDays;
    const rel = prev > 0 ? change.domDays / prev : 0;
    if (rel >= 0.1) signals.push({ favors: "buyers", text: `Homes take ${change.domDays} more days to sell than a year ago` });
    else if (rel <= -0.1) signals.push({ favors: "sellers", text: `Homes sell ${-change.domDays} days faster than a year ago` });
  }
  // How fast homes sell right now, which works even without a year of history.
  const dom = cur?.median_dom;
  if (dom != null && cur && cur.sales >= LOW_SAMPLE) {
    if (dom <= 21) signals.push({ favors: "sellers", text: `Homes sell fast, in a median of ${dom} days` });
    else if (dom >= 60) signals.push({ favors: "buyers", text: `Homes sit for a median of ${dom} days` });
  }
  if (change.medianPricePct != null) {
    if (change.medianPricePct <= -2) signals.push({ favors: "buyers", text: `The median price is down ${-change.medianPricePct}% from a year ago` });
    else if (change.medianPricePct >= 5) signals.push({ favors: "sellers", text: `The median price is up ${change.medianPricePct}% from a year ago` });
  }
  if (supply != null) {
    if (supply > 6) signals.push({ favors: "buyers", text: `${supply} months of inventory, which is more than the 6 that usually means a buyer's market` });
    else if (supply < 3) signals.push({ favors: "sellers", text: `Only ${supply} months of inventory, which is tight` });
    else signals.push({ favors: "balanced", text: `${supply} months of inventory, which is balanced` });
  }
  const score = signals.reduce((s, x) => s + (x.favors === "buyers" ? 1 : x.favors === "sellers" ? -1 : 0), 0);
  const lean: Lean = score >= 2 ? "buyers" : score <= -2 ? "sellers" : "balanced";
  return { lean, signals };
}

// Below this many sales, averages and medians are easily skewed by a few homes.
export const LOW_SAMPLE = 10;
