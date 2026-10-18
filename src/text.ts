/** Text, model-number and date utilities shared by extraction, retrieval and verdicts. */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface DateSpan {
  from: string; // ISO yyyy-mm-dd, inclusive
  to: string; // ISO yyyy-mm-dd, inclusive
  /** True when the source carried no explicit year and we borrowed one. */
  inferredYear?: boolean;
}

const spanOfYear = (y: number): DateSpan => ({ from: `${y}-01-01`, to: `${y}-12-31` });
const spanOfMonth = (y: number, m: number): DateSpan => ({
  from: `${y}-${pad(m)}-01`,
  to: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`,
});
const spanOfDay = (y: number, m: number, d: number): DateSpan => ({
  from: `${y}-${pad(m)}-${pad(d)}`,
  to: `${y}-${pad(m)}-${pad(d)}`,
});

const validMonth = (m: number) => m >= 1 && m <= 12;
const validYear = (y: number) => y >= 1980 && y <= 2100;

/**
 * Parses the date shapes that appear in recall notices and on product labels:
 * "June 23, 2022", "July 2020", "2024-01", "07/2025", "2026/1/10", "2012.09.20", "2012".
 * Returns the inclusive span the text could mean (a month → the whole month).
 */
export function parseLooseDate(raw: string, fallbackYear?: number): DateSpan | null {
  const s = raw.trim().replace(/\s+/g, " ").replace(/[.,]$/, "");
  let m: RegExpMatchArray | null;

  // Month name forms
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/))) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const y = Number(m[3]);
    if (mo && validYear(y)) return spanOfDay(y, mo, Number(m[2]));
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    const y = Number(m[2]);
    if (mo && validYear(y)) return spanOfMonth(y, mo);
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/)) && fallbackYear) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (mo) return { ...spanOfDay(fallbackYear, mo, Number(m[2])), inferredYear: true };
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?$/)) && fallbackYear) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (mo) return { ...spanOfMonth(fallbackYear, mo), inferredYear: true };
  }
  // Numeric: yyyy-mm-dd, yyyy/m/d, yyyy.mm.dd, "yyyy m d"
  if ((m = s.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})$/))) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validYear(y) && validMonth(mo) && d >= 1 && d <= 31) return spanOfDay(y, mo, d);
  }
  // yyyy-mm
  if ((m = s.match(/^(\d{4})[-/. ](\d{1,2})$/))) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    if (validYear(y) && validMonth(mo)) return spanOfMonth(y, mo);
  }
  // mm/yyyy
  if ((m = s.match(/^(\d{1,2})[-/. ](\d{4})$/))) {
    const [mo, y] = [Number(m[1]), Number(m[2])];
    if (validYear(y) && validMonth(mo)) return spanOfMonth(y, mo);
  }
  // mm/dd/yyyy (US) — only when unambiguous
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (validYear(y)) {
      if (validMonth(a) && b > 12) return spanOfDay(y, a, b);
      if (validMonth(b) && a > 12) return spanOfDay(y, b, a);
      if (validMonth(a) && validMonth(b) && a === b) return spanOfDay(y, a, b);
      if (validMonth(a) && b <= 31) return spanOfDay(y, a, b); // US default
    }
  }
  // yyyy
  if ((m = s.match(/^(\d{4})$/))) {
    const y = Number(m[1]);
    if (validYear(y)) return spanOfYear(y);
  }
  return null;
}

/** Joins two spans into a window [first.from, last.to]. */
export function joinSpans(a: DateSpan, b: DateSpan): { from: string; to: string } {
  return { from: a.from <= b.from ? a.from : b.from, to: a.to >= b.to ? a.to : b.to };
}

/** True if the span lies fully inside the window; "overlap" when partly inside. */
export function spanVsWindow(
  span: { from: string; to: string },
  win: { from?: string; to?: string },
): "inside" | "overlap" | "outside" {
  const lo = win.from ?? "0000-00-00";
  const hi = win.to ?? "9999-99-99";
  if (span.to < lo || span.from > hi) return "outside";
  if (span.from >= lo && span.to <= hi) return "inside";
  return "overlap";
}

// ---------- models ----------

export function normalizeModel(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length]![b.length]!;
}

export type ModelMatch = { kind: "exact" | "near"; candidate: string } | null;

/** Compares a model the user read off a label with the models a recall names. */
export function matchModel(query: string, candidates: string[]): ModelMatch {
  const q = normalizeModel(query);
  if (q.length < 2) return null;
  let near: string | null = null;
  for (const c of candidates) {
    const n = normalizeModel(c);
    if (!n) continue;
    if (n === q) return { kind: "exact", candidate: c };
    // suffix variants ("3C00BPN" vs "3C00BPN TC"), or one character slip
    const prefixish = (n.startsWith(q) || q.startsWith(n)) && Math.abs(n.length - q.length) <= 3 && Math.min(n.length, q.length) >= 4;
    const slip = Math.min(n.length, q.length) >= 5 && editDistance(n, q) <= 1;
    if (prefixish || slip) near ??= c;
  }
  return near ? { kind: "near", candidate: near } : null;
}

// ---------- tokens ----------

const STOP = new Set([
  "a", "an", "the", "of", "for", "and", "or", "with", "my", "our", "this", "that", "is", "it", "i", "to", "in", "on",
  "have", "has", "just", "got", "bought", "buy", "buying", "used", "secondhand", "second", "hand", "new", "old",
  "recall", "recalled", "recalls", "check", "baby", "child", "children", "kids", "kid", "sold", "model", "number", "no",
  "item", "product", "products", "due", "risk", "hazard", "hazards", "serious", "injury", "death", "from", "by", "at",
]);

/** Product-type synonym groups; every member maps to the group's canonical token. */
const SYNONYMS: string[][] = [
  ["highchair", "high chair", "high chairs", "highchairs", "feeding chair", "booster chair"],
  ["stroller", "strollers", "pram", "prams", "pushchair", "buggy", "jogger", "jogging stroller"],
  ["crib", "cribs", "cot", "cots"],
  ["bassinet", "bassinets", "moses basket", "cradle", "co sleeper", "cosleeper", "bedside sleeper"],
  ["playard", "playards", "play yard", "play yards", "pack n play", "pack and play", "playpen", "play pen"],
  ["carseat", "car seat", "car seats", "carseats", "infant seat", "child seat", "child restraint", "booster seat"],
  ["swing", "swings", "baby swing", "infant swing"],
  ["bouncer", "bouncers", "bouncy seat", "rocker", "rockers", "baby rocker", "infant rocker"],
  ["walker", "walkers", "baby walker", "infant walker"],
  ["carrier", "carriers", "baby carrier", "sling", "wrap"],
  ["bather", "bath seat", "bath seats", "bath tub", "bathtub", "baby bather"],
  ["sleeper", "sleepers", "inclined sleeper", "infant sleeper"],
  ["gate", "gates", "baby gate", "safety gate"],
  ["monitor", "monitors", "baby monitor"],
];

const SYN_MAP = new Map<string, string>();
for (const group of SYNONYMS) {
  const canon = group[0]!.replace(/\s+/g, "");
  for (const g of group) SYN_MAP.set(g.replace(/\s+/g, " ").toLowerCase(), canon);
}

function applySynonyms(s: string): string {
  let out = ` ${s.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ")} `;
  const phrases = [...SYN_MAP.keys()].filter((k) => k.includes(" ")).sort((a, b) => b.length - a.length);
  for (const p of phrases) out = out.split(` ${p} `).join(` ${SYN_MAP.get(p)} `);
  return out.trim();
}

export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es") && /(ch|sh|x|s)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(s: string, opts: { keepStop?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const raw of applySynonyms(s).split(" ")) {
    if (!raw) continue;
    const w = raw.replace(/'s$/, "").replace(/'/g, "");
    if (!w) continue;
    const canon = SYN_MAP.get(w) ?? w;
    const t = stem(canon);
    if (!opts.keepStop && STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

export function brandKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CANON_STEMS = new Set([...SYN_MAP.values()].map(stem));

/** Product-type tokens present in text (canonical forms), for type gating. */
export function productTypes(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(text, { keepStop: true })) if (CANON_STEMS.has(t)) out.add(t);
  return out;
}

// ---------- date codes ----------

const alnumUp = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Does the user's date (a raw printed code, or a date we can parse) correspond to one of the recalled codes?
 * Recall notices print month/year codes in several layouts, so a date is expanded to MMYY, YYMM, MMYYYY and
 * YYYYMM before comparing. Returns null when there is nothing to compare.
 */
export function dateCodeMatches(raw: string | undefined, span: DateSpan | null, codes: string[]): boolean | null {
  const set = new Set(codes.map(alnumUp));
  if (!raw && !span) return null;
  if (raw && set.has(alnumUp(raw))) return true;
  if (span) {
    const [fy, fm] = span.from.split("-").map(Number) as [number, number];
    const [ty, tm] = span.to.split("-").map(Number) as [number, number];
    let y = fy, m = fm, n = 0;
    while ((y < ty || (y === ty && m <= tm)) && n++ < 36) {
      const mm = pad(m), yy = pad(y % 100), yyyy = String(y);
      if ([mm + yy, yy + mm, mm + yyyy, yyyy + mm].some((c) => set.has(c))) return true;
      if (++m > 12) { m = 1; y++; }
    }
  }
  return false;
}

// ---------- speech helpers ----------

export const trimSentence = (s: string, n: number) => (s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n)) + "…");

/** "Graco Recalls Table2Table High Chairs Due to Fall Hazard" -> "Graco Table2Table High Chairs" (speakable). */
export function shortTitle(title: string): string {
  const t = title.replace(/\s+(?:Recalls?|Recalled|Recalling)\s+/i, " ").split(/\s+(?:Due to|Because|Over|After|Following|Risk of|Violates?|Violation)\b|[;:]/i)[0]!.trim();
  return t.replace(/\s+(?:Recalled|Recall)$/i, "") || title;
}

/** First full sentence, capped; never cuts mid-thought with a dangling ellipsis. */
export function firstSentence(s: string, max = 220): string {
  const m = s.match(/^.+?[.!?](?=\s|$)/);
  const one = (m ? m[0] : s).trim();
  return one.length <= max ? one : trimSentence(one, max).replace(/…$/, ".");
}

