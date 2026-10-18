/** Loads the data snapshots and turns raw CPSC / NHTSA rows into `RecallRecord`s. */
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Conditions, RecallRecord } from "./types.ts";
import { modelsFromCaptions, regexExtractor, type ConditionExtractor } from "./extract.ts";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

/** Product nouns only: words like "Infant" or "Baby" appear inside brand names (Summer Infant, Baby Trend). */
const PRODUCT_NOUN = /\s(?:high ?chairs?|booster seats?|cribs?|bassinets?|strollers?|prams?|car ?seats?|playards?|play ?yards?|pack ?n ?plays?|bouncers?|swings?|walkers?|carriers?|bath ?seats?|bath ?tubs?|bathers?|rockers?|sleepers?|gates?|monitors?|pacifiers?|teethers?|changing tables?|nursing pillows?|play ?pens?|co-?sleepers?)\b/i;

/**
 * "Graco Recalls Table2Table High Chairs …" -> "Graco".
 * Titles that read "Bicystar High Chairs Recalled …" put the product before the verb, so cut the brand
 * at the first product word ("Bicystar").
 */
export function brandFromTitle(title: string): string {
  const m = title.match(/^(.*?)\s+(?:Recalls?|Recalled|Warns?|Announces?|Expands?|Issues?|Voluntarily|Urges?|Stops?|Pulls?|Joins?|Re-?announces?)\b/);
  let pre = clean(m ? m[1] : title.split(/\s+/).slice(0, 2).join(" "));
  const prod = pre.search(PRODUCT_NOUN);
  if (prod > 0) pre = pre.slice(0, prod).trim() || pre;
  return pre;
}

interface RawCpsc {
  RecallNumber: string;
  RecallDate: string;
  Title: string;
  Description: string;
  URL: string;
  ConsumerContact: string;
  Products: { Name: string; Description: string; Model: string; Type: string; NumberOfUnits: string }[];
  Hazards: { Name: string }[];
  Remedies: { Name: string }[];
  RemedyOptions: { Option: string }[];
  Retailers: { Name: string }[];
  Injuries: { Name: string }[];
  Images: { URL: string; Caption: string }[];
}

export function cpscToRecord(r: RawCpsc, extractor: ConditionExtractor = regexExtractor): RecallRecord {
  const soldAt = r.Retailers.map((x) => clean(x.Name)).filter(Boolean);
  const productText = r.Products.map((p) => `${p.Description} ${p.Model}`).join(" ");
  const text = clean(`${r.Description} ${productText}`);
  const cond = extractor.extract(text, { title: r.Title, sold: soldAt });
  // Structured Model field is empty in practice, but use it if a future feed populates it.
  for (const p of r.Products) if (clean(p.Model)) cond.models.push(clean(p.Model));
  // Image captions often name the model printed on the label.
  for (const m of modelsFromCaptions(r.Images.map((i) => i.Caption))) if (!cond.models.includes(m)) cond.models.push(m);
  return {
    id: `cpsc:${r.RecallNumber}`,
    source: "CPSC",
    number: r.RecallNumber,
    date: r.RecallDate.slice(0, 10),
    title: clean(r.Title),
    brand: brandFromTitle(r.Title),
    productNames: r.Products.map((p) => clean(p.Name)).filter(Boolean),
    description: text,
    hazard: clean(r.Hazards.map((h) => h.Name).join(" ")),
    remedy: clean(r.Remedies.map((m) => m.Name).join(" ")),
    remedyOptions: r.RemedyOptions.map((o) => clean(o.Option)).filter((o) => o.length < 30),
    contact: clean(r.ConsumerContact),
    url: r.URL,
    units: clean(r.Products[0]?.NumberOfUnits) || undefined,
    injuries: clean(r.Injuries.map((i) => i.Name).join("; ")) || undefined,
    soldAt,
    images: r.Images.map((i) => ({ url: i.URL, caption: clean(i.Caption) })),
    conditions: cond,
  };
}

interface RawNhtsa {
  campaign: string;
  make: string;
  model: string;
  year: string;
  component: string;
  manufacturer: string;
  mfgBegin: string;
  mfgEnd: string;
  units: string;
  received: string;
  defect: string;
  consequence: string;
  remedy: string;
  notes: string;
}

const isoFromYmd = (s: string): string | undefined => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : undefined);

/** One record per (campaign, make, model): NHTSA gives a structured manufacture window for each. */
export function nhtsaToRecords(rows: RawNhtsa[]): RecallRecord[] {
  const seen = new Set<string>();
  const out: RecallRecord[] = [];
  for (const r of rows) {
    const make = clean(r.make);
    const model = clean(r.model);
    const key = `${r.campaign}|${make}|${model}|${r.mfgBegin}|${r.mfgEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let mfgFrom = isoFromYmd(r.mfgBegin);
    let mfgTo = isoFromYmd(r.mfgEnd);
    // NHTSA occasionally publishes an inverted window (begin after end). Don't guess which end is wrong.
    const windowSuspect = Boolean(mfgFrom && mfgTo && mfgFrom > mfgTo);
    if (windowSuspect) { mfgFrom = undefined; mfgTo = undefined; }
    const cond: Conditions = {
      windowSuspect,
      models: [],
      modelNames: model ? [model] : [],
      dateCodes: [],
      mfgFrom,
      mfgTo,
      batches: [],
      channels: [],
      exhaustive: true,
    };
    out.push({
      id: `nhtsa:${r.campaign}:${out.length}`,
      source: "NHTSA",
      number: r.campaign,
      date: isoFromYmd(r.received) ?? "",
      title: `${titleCase(make)} ${titleCase(model)} child seat`,
      brand: titleCase(make),
      productNames: [`${titleCase(make)} ${titleCase(model)} car seat`],
      description: clean(r.defect),
      hazard: clean(r.consequence),
      remedy: clean(r.remedy),
      remedyOptions: [],
      contact: clean(r.notes) || "NHTSA Vehicle Safety Hotline 1-888-327-4236 (TTY 1-800-424-9153)",
      url: `https://www.nhtsa.gov/recalls?nhtsaId=${r.campaign}`,
      units: clean(r.units) || undefined,
      soldAt: [],
      images: [],
      conditions: cond,
    });
  }
  return out;
}

export interface Dataset {
  recalls: RecallRecord[];
  /** Newest recall date in the snapshot (ISO). */
  dataThrough: string;
  /** mtime of the snapshot files (ISO date), i.e. when `npm run sync` last ran. */
  syncedOn: string;
  counts: { cpsc: number; nhtsa: number };
}

export function loadDataset(dir = dataDir, extractor: ConditionExtractor = regexExtractor): Dataset {
  const read = <T>(f: string): T[] => (existsSync(join(dir, f)) ? (JSON.parse(readFileSync(join(dir, f), "utf8")) as T[]) : []);
  const cpsc = read<RawCpsc>("cpsc.json").map((r) => cpscToRecord(r, extractor));
  const nhtsa = nhtsaToRecords(read<RawNhtsa>("nhtsa.json"));
  const recalls = [...cpsc, ...nhtsa];
  const dataThrough = recalls.reduce((a, r) => (r.date > a ? r.date : a), "");
  const files = ["cpsc.json", "nhtsa.json"].filter((f) => existsSync(join(dir, f)));
  const syncedOn = files.length ? new Date(Math.min(...files.map((f) => statSync(join(dir, f)).mtimeMs))).toISOString().slice(0, 10) : "";
  return { recalls, dataThrough, syncedOn, counts: { cpsc: cpsc.length, nhtsa: nhtsa.length } };
}
