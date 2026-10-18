/**
 * Self-generating benchmark. Cases are derived from the real recall data, so no hand-labelled set is needed:
 *   A  full label info          -> the recall must be CONFIRMED
 *   B  model withheld           -> must ask for info, never CONFIRM
 *   C  one-character model typo -> must NOT confirm (and should say "close to")
 *   D  decoy: right brand, different model -> must NOT confirm
 *   E  date outside the window  -> must NOT confirm
 *   F  casual description only  -> recall found in the top 5
 * The number that matters is the false-confirm rate (C, D, E): wrongly telling a parent "this is recalled",
 * or worse, wrongly clearing a recalled product, are the two failure modes we measure.
 */
import { RadarEngine } from "../src/engine.ts";
import type { ItemQuery, RecallRecord } from "../src/types.ts";

const engine = new RadarEngine();
const all = engine.dataset.recalls;
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

const midpoint = (from?: string, to?: string) => {
  const f = from ?? to!, t = to ?? from!;
  const a = Date.parse(f), b = Date.parse(t);
  return new Date((a + b) / 2).toISOString().slice(0, 10);
};
const shiftYears = (iso: string, y: number) => `${Number(iso.slice(0, 4)) + y}${iso.slice(4)}`;
const typo = (m: string) => {
  const i = Math.floor(m.length / 2);
  const c = m[i]!;
  const rep = /\d/.test(c) ? String((Number(c) + 3) % 10) : c === "Z" ? "Q" : "Z";
  return m.slice(0, i) + rep + m.slice(i + 1);
};
const decoyModel = (m: string) => (m.length > 3 ? m.slice(0, -1) + (/\d$/.test(m) ? "X" : "7") + "9" : m + "99");

function desc(r: RecallRecord) {
  return r.productNames[0] || r.title;
}
const confirmedIds = (q: ItemQuery) => engine.check(q, { limit: 10 }).matches.filter((m) => m.kind === "CONFIRMED").map((m) => m.recall.id);
const bucket = (q: ItemQuery, id: string) => {
  const res = engine.check(q, { limit: 10 });
  // ruled-out recalls are reported separately, so look there too (otherwise "never EXCLUDED" guards pass vacuously)
  return res.matches.find((m) => m.recall.id === id)?.kind ?? res.excluded.find((m) => m.recall.id === id)?.kind ?? "absent";
};

const cpscModels = all.filter((r) => r.source === "CPSC" && r.conditions.models.length > 0 && r.brand);
const results: Record<string, { pass: number; total: number; fails: string[] }> = {};
const rec = (name: string, ok: boolean, label: string) => {
  const b = (results[name] ??= { pass: 0, total: 0, fails: [] });
  b.total++;
  if (ok) b.pass++;
  else if (b.fails.length < 5) b.fails.push(label);
};

for (const r of cpscModels) {
  const m = r.conditions.models[0]!;
  const win = r.conditions.mfgFrom || r.conditions.mfgTo ? midpoint(r.conditions.mfgFrom, r.conditions.mfgTo) : undefined;
  const base: ItemQuery = { description: desc(r), brand: r.brand };
  // A: everything the label shows
  const dcl = r.conditions.dateCodeList ?? [];
  const sr = r.conditions.serialRanges?.[0];
  const full: ItemQuery = { ...base, model: m, dateCode: win ?? dcl[0], batch: r.conditions.batches[0], serial: sr?.from };
  const a = bucket(full, r.id);
  rec("A  full label -> CONFIRMED", a === "CONFIRMED", `${r.id} ${r.brand} ${m} got ${a}`);
  // J: the safe-clear guard. If the notice points elsewhere for its full list, an unlisted model must never be ruled out.
  if (r.conditions.listsIncomplete) {
    const j = bucket({ ...full, model: decoyModel(m) }, r.id);
    rec("J  incomplete list + unlisted model -> never EXCLUDED", j !== "EXCLUDED", `${r.id} ${r.brand} ${decoyModel(m)} got ${j}`);
  }
  // K: a printed date code that is not among the recalled codes must not confirm
  if (dcl.length && !(r.conditions.mfgFrom || r.conditions.mfgTo) && !r.conditions.listsIncomplete) {
    const k = bucket({ ...full, dateCode: "ZZ9999" }, r.id);
    rec("K  date code not in list -> not CONFIRMED", k !== "CONFIRMED", `${r.id} ${r.brand} code ZZ9999 got ${k}`);
  }
  // B: model withheld
  const b = bucket(base, r.id);
  rec("B  model withheld -> never CONFIRMED", b !== "CONFIRMED", `${r.id} ${r.brand} got ${b}`);
  // C: typo in model
  const cc = bucket({ ...base, model: typo(m), dateCode: win }, r.id);
  rec("C  model typo -> not CONFIRMED", cc !== "CONFIRMED", `${r.id} ${m} as ${typo(m)} got ${cc}`);
  // D: different model, same brand/product
  const dd = bucket({ ...base, model: decoyModel(m), dateCode: win }, r.id);
  rec("D  decoy model -> not CONFIRMED", dd !== "CONFIRMED", `${r.id} ${m} as ${decoyModel(m)} got ${dd}`);
  // E: date outside window
  if (r.conditions.mfgFrom || r.conditions.mfgTo) {
    const out = r.conditions.mfgTo ? shiftYears(r.conditions.mfgTo, 3) : shiftYears(r.conditions.mfgFrom!, -3);
    const e = bucket({ ...base, model: m, dateCode: out }, r.id);
    rec("E  date outside window -> not CONFIRMED", e !== "CONFIRMED", `${r.id} ${m} @ ${out} got ${e}`);
  }
  // F: casual description only (brand + product), target should be reachable
  const f = engine.check({ description: `my ${r.brand} ${desc(r)}`, brand: r.brand }, { limit: 8 }).matches.some((x) => x.recall.id === r.id);
  rec("F  brand+product only -> found in top 8", f, `${r.id} ${r.brand} ${desc(r)}`);
}

// NHTSA car seats: structured, so date logic is exact
const seats = all.filter((r) => r.source === "NHTSA" && r.conditions.mfgFrom && r.conditions.mfgTo);
for (const r of seats) {
  const name = r.conditions.modelNames[0]!;
  const win = midpoint(r.conditions.mfgFrom, r.conditions.mfgTo);
  const q: ItemQuery = { description: `${r.brand} ${name} car seat`, brand: r.brand, model: name, dateCode: win };
  const a = engine.check(q, { limit: 10 }).matches.some((m) => m.kind === "CONFIRMED" && m.recall.number === r.number);
  rec("G  car seat, date in window -> CONFIRMED", a, `${r.number} ${r.brand} ${name} @ ${win}`);
  const out = shiftYears(r.conditions.mfgTo!, 4);
  const o = engine.check({ ...q, dateCode: out }, { limit: 10 }).matches.some((m) => m.kind === "CONFIRMED" && m.recall.id === r.id);
  rec("H  car seat, date outside window -> not CONFIRMED", !o, `${r.number} ${r.brand} ${name} @ ${out}`);
}

// Appearance-only recalls: with just brand+product we must never claim a confirmed match
const appearance = all.filter((r) => r.source === "CPSC" && !r.conditions.models.length && !r.conditions.mfgFrom && !r.conditions.batches.length && r.brand);
for (const r of appearance) {
  const status = bucket({ description: desc(r), brand: r.brand }, r.id);
  rec("I  no-identifier recall -> never CONFIRMED", status !== "CONFIRMED", `${r.id} ${r.brand} got ${status}`);
}

console.log(`Recall Radar benchmark — ${all.length} recalls (data through ${engine.dataset.dataThrough})\n`);
let falseConfirms = 0, falseConfirmTotal = 0;
for (const [name, v] of Object.entries(results)) {
  console.log(`${name.padEnd(52)} ${String(v.pass).padStart(4)}/${String(v.total).padEnd(4)} ${pct(v.pass, v.total).padStart(7)}`);
  if (/^[BCDEHIJK]/.test(name)) { falseConfirms += v.total - v.pass; falseConfirmTotal += v.total; }
}
console.log(`\nFalse-confirm rate across guard cases (B,C,D,E,H,I,J,K): ${falseConfirms}/${falseConfirmTotal} = ${pct(falseConfirms, falseConfirmTotal)}`);
for (const [name, v] of Object.entries(results)) if (v.fails.length) { console.log(`\n${name} — sample failures:`); v.fails.forEach((f) => console.log("  ", f)); }
