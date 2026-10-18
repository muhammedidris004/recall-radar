/**
 * Turns recall prose into structured conditions.
 *
 * CPSC's `Products[].Model` field is empty in practice, so model numbers, date codes and batch codes
 * live in the free-text description. This module extracts them with deterministic patterns built from
 * how real notices are worded (see test/extract.test.ts for the fixtures).
 *
 * An LLM can be plugged in behind `ConditionExtractor` to cover the long tail, but the matching decision
 * is always made by code comparing explicit values, so results stay auditable.
 */
import type { Conditions } from "./types.ts";
import { joinSpans, parseLooseDate, type DateSpan } from "./text.ts";

export interface ConditionExtractor {
  extract(text: string, context: { title: string; sold: string[] }): Conditions;
}

const MONTH_RE = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
/** One date-ish token, longest alternatives first. */
const DATE_RE = [
  `${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`,
  `${MONTH_RE}\\.?,?\\s+\\d{4}`,
  `${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?!\\d)`,
  `\\d{4}[-/. ]\\d{1,2}[-/. ]\\d{1,2}`,
  `\\d{1,2}[-/]\\d{1,2}[-/]\\d{4}`,
  `\\d{4}[-/. ]\\d{1,2}(?![\\d/])`,
  `\\d{1,2}[-/ ]\\d{4}`,
  `\\d{4}`,
].join("|");
const SEP = "(?:\\s*(?:-|–|—|to|through|thru|until|and)\\s*)";
const RANGE = new RegExp(`(${DATE_RE})${SEP}(${DATE_RE})`, "i");

const yearOf = (s: string): number | undefined => {
  const m = s.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : undefined;
};

function spanFromRange(a: string, b: string): { from: string; to: string } | null {
  const yb = yearOf(b);
  const sb = parseLooseDate(b);
  const sa = parseLooseDate(a, yb);
  if (!sa || !sb) return null;
  // "between May 15 and August 20, 2012": both ends inherit the closing year.
  const joined = joinSpans(sa, sb);
  return joined.from <= joined.to ? joined : null;
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9\-/.]*$/;
const hasDigit = (s: string) => /\d/.test(s);
const isYearish = (s: string) => /^(19|20)\d{2}$/.test(s);
/** "04/2013", "2024-01", "2026/1/10": dates, not model numbers. */
/** "10mL", "1.5-ton", "3-pack": quantities and sizes, not model numbers. */
const isQuantityShaped = (s: string) => /^\d+(\.\d+)?[- ]?(ton|tons|pack|pk|inch|in|oz|ml|l|mm|cm|lb|lbs|pc|pcs|count|ct|piece|pieces|volt|v|mah|gb|month|months|year|years|mil)$/i.test(s);
const isDateShaped = (s: string) => /^\d{1,4}[-/.]\d{1,4}([-/.]\d{1,4})?$/.test(s) && parseLooseDate(s.replace(/\./g, "-")) !== null;
/** Words that commonly follow "model number" but aren't model numbers. */
const FILLER = new Set(["included", "include", "includes", "including", "in", "this", "the", "recall", "recalled", "are", "is", "affected", "following", "listed", "below", "covered", "by", "of", "these", "those", "as", "each", "for", "all", "only", "number", "numbers", "no", "name", "names", "model", "models", "style", "styles", "item", "items", "sku", "skus", "that", "with", "range", "five", "six", "four", "three", "two"]);
const NOT_MODEL = new Set(["AND", "OR", "THE", "ARE", "WAS", "IS", "NO", "NUMBER", "NUMBERS", "PRINTED", "LOCATED", "INCLUDED"]);

/**
 * Pulls model/style/item/SKU identifiers out of prose. Handles lists
 * ("model numbers 10632, 10639 and BT021"), quotes ("model/style number "255""), and
 * suffix variants ("3C00BPN, 3C00BPN TC").
 */
export function extractModels(text: string): string[] {
  const found = new Set<string>();
  const trigger = /\b(?:model|style|item|sku|part|catalog|product)(?:\s*\/\s*(?:style|model|item))?\s*(?:names|name|nos\.?|no\.?|numbers|number|#|codes|code)?\s*(?:\(s\))?\s*[:#]?\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = trigger.exec(text))) {
    // bare "part" / "product" / "catalog" is prose ("part of a 3-pack"), only "part number" etc. count
    if (/^(?:part|product|catalog)\s*[:#]?\s*$/i.test(m[0])) continue;
    // Walk tokens after the trigger.
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const pieces = rest.split(/(\s+|,|;|\band\b|\bor\b)/i).filter((p) => p !== undefined && p !== "");
    let taken = 0;
    let miss = 0;
    let filler = 0;
    for (const p of pieces) {
      if (/^\s+$/.test(p) || /^(,|;|and|or)$/i.test(p)) continue;
      const tok = p.replace(/^["“'(]+|["”').:]+$/g, "");
      if (!tok) continue;
      // "The model numbers included in this recall are WL3520 …": skip connective words before the first value.
      if (taken === 0 && FILLER.has(tok.toLowerCase())) { if (++filler > 14) break; continue; }
      if (TOKEN.test(tok) && hasDigit(tok) && !isYearish(tok) && !isDateShaped(tok) && !isQuantityShaped(tok) && !NOT_MODEL.has(tok.toUpperCase()) && tok.length >= 2) {
        // plain small numbers like "2" or "10" are rarely model numbers unless quoted
        const quoted = /["“]/.test(p) || /["“]/.test(rest.slice(0, 3));
        if (/^\d{1,2}$/.test(tok) && !quoted) { miss++; if (miss > 1) break; continue; }
        found.add(tok.replace(/\.$/, ""));
        taken++;
        miss = 0;
      } else {
        // allow a short non-model word (e.g. "TC" suffix handled below, "No."), stop after 2 misses
        if (/^[A-Z]{1,3}$/.test(tok) && taken > 0) {
          const last = [...found].at(-1)!;
          found.add(`${last} ${tok}`); // "3C00BPN TC"
          miss = 0;
          continue;
        }
        miss++;
        if (miss > (taken > 0 ? 1 : 3)) break;
        if (taken > 0 && /^[a-z]/.test(tok) && tok.length > 3) break;
      }
      if (taken >= 40) break;
    }
  }
  // "The model/style number included in the recall is "432"": filler words before a quoted value.
  const quoted = /\b(?:model|style|item|sku)(?:\s*\/\s*(?:style|model|item))?\s*(?:no\.?|numbers?|#)[^."“]{3,50}?["“]([A-Za-z0-9][A-Za-z0-9\-/]{1,})["”]/gi;
  for (const q of text.matchAll(quoted)) if (hasDigit(q[1]!)) found.add(q[1]!);
  // Remove obvious non-identifiers
  return [...found].filter((x) => !/^\d{1,2}$/.test(x));
}

/** Models printed in image captions ("... model TB-HC6900"). */
export function modelsFromCaptions(captions: string[]): string[] {
  return captions.flatMap((c) => extractModels(c));
}

export function extractBatches(text: string): string[] {
  const out = new Set<string>();
  const re = /\b(?:batch|lot|production batch)(?:\s*(?:no\.?|numbers?|#|codes?))?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/]{2,}(?:\s*(?:,|and|or)\s*[A-Za-z0-9][A-Za-z0-9\-/]{2,})*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const t of m[1]!.split(/\s*(?:,|and|or)\s*/i)) {
      const tok = t.trim();
      if (hasDigit(tok) && !isYearish(tok)) out.add(tok);
    }
  }
  return [...out];
}

export interface MfgWindow {
  from?: string;
  to?: string;
  dateCodes: string[];
}

/** Finds the manufacture-date window and date-code strings in prose. */
export function extractMfgWindow(text: string): MfgWindow {
  const dateCodes: string[] = [];
  let from: string | undefined;
  let to: string | undefined;
  const widen = (w: { from?: string; to?: string }) => {
    if (w.from && (!from || w.from < from)) from = w.from;
    if (w.to && (!to || w.to > to)) to = w.to;
  };

  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“])/);
  for (const s of sentences) {
    if (!/(manufactur|date code|date of manufacture|production|made|produced|dated|batch|lot)/i.test(s)) continue;
    if (/made (in|of|from|with)\b/i.test(s) && !/manufactur|date code/i.test(s)) continue;

    // 1) explicit ranges
    const r = s.match(RANGE);
    if (r && /(manufactur|date code|production|made|produced|dated|between)/i.test(s)) {
      const w = spanFromRange(r[1]!, r[2]!);
      if (w) {
        // ignore "sold from X to Y" sentences — those are retail windows, not manufacture windows
        const ctx = s.slice(Math.max(0, (r.index ?? 0) - 25), r.index ?? 0);
        const isSold = /\b(sold|sales?|available)\b[^,;]*$/i.test(ctx);
        if (!isSold) {
          widen(w);
          dateCodes.push(r[0]);
          continue;
        }
      }
    }
    // 2) "on or after X" / "after X" / "since X" / "before X" / "prior to X"
    let m = s.match(new RegExp(`(?:manufactured|made|produced)?[^.]{0,40}?\\b(?:on or after|after|since)\\s+(${DATE_RE})`, "i"));
    if (m && /(manufactur|made|produced|date)/i.test(s)) {
      const sp = parseLooseDate(m[1]!);
      if (sp) { widen({ from: sp.from }); dateCodes.push(m[0].trim()); continue; }
    }
    m = s.match(new RegExp(`\\b(?:before|prior to|until)\\s+(${DATE_RE})`, "i"));
    if (m && /(manufactur|made|produced)/i.test(s)) {
      const sp = parseLooseDate(m[1]!);
      if (sp) { widen({ to: sp.from }); dateCodes.push(m[0].trim()); continue; }
    }
    // 3) "manufactured in July 2011" / "date codes 07/2025 or 08/2025"
    const singles = [...s.matchAll(new RegExp(`(?:manufactured|made|produced|date codes?|date of manufactur\\w*)[^.]{0,50}?(${DATE_RE})`, "gi"))];
    for (const sm of singles) {
      const sp = parseLooseDate(sm[1]!);
      if (sp) { widen(sp); dateCodes.push(sm[1]!); }
    }
    // "date codes 07/2025 or 08/2025": the lazy match above only caught the first; sweep the rest of the clause
    const dc = s.match(/date codes?\b([^.]*)/i);
    if (dc) {
      const clause = dc[1]!.split(/\b(?:sold|sales?|available)\b/i)[0]!;
      for (const dm of clause.matchAll(new RegExp(`(${DATE_RE})`, "gi"))) {
        const sp = parseLooseDate(dm[1]!);
        if (sp) { widen(sp); dateCodes.push(dm[1]!); }
      }
    }
  }
  return { from, to, dateCodes: [...new Set(dateCodes)] };
}

const CHANNELS: [RegExp, string][] = [
  [/amazon/i, "Amazon"], [/walmart/i, "Walmart"], [/target/i, "Target"], [/costco/i, "Costco"], [/temu/i, "Temu"],
  [/ebay/i, "eBay"], [/etsy/i, "Etsy"], [/buybuy ?baby/i, "buybuy BABY"], [/home depot/i, "Home Depot"],
  [/ikea/i, "IKEA"], [/kohl/i, "Kohl's"], [/best buy/i, "Best Buy"], [/aldi/i, "Aldi"], [/shein/i, "Shein"],
  [/tiktok/i, "TikTok Shop"], [/academy sports/i, "Academy Sports"], [/dollar/i, "Dollar store"], [/babies ?r ?us/i, "Babies R Us"],
];

/** Parses "Online at Amazon.com from March 2023 to July 2026 for $27-$57" style strings. */
export function extractSold(sold: string[]): { from?: string; to?: string; channels: string[] } {
  const channels = new Set<string>();
  let from: string | undefined;
  let to: string | undefined;
  for (const s of sold) {
    for (const [re, name] of CHANNELS) if (re.test(s)) channels.add(name);
    const body = s.replace(/\$[\d,.\s]+(?:and|to|-)?\s*\$?[\d,.]*/g, " ");
    const r = body.match(RANGE);
    if (r) {
      const w = spanFromRange(r[1]!, r[2]!);
      if (w) {
        if (!from || w.from < from) from = w.from;
        if (!to || w.to > to) to = w.to;
        continue;
      }
    }
    const single = body.match(new RegExp(`(?:in|during)\\s+(${DATE_RE})`, "i"));
    if (single) {
      const sp = parseLooseDate(single[1]!);
      if (sp) {
        if (!from || sp.from < from) from = sp.from;
        if (!to || sp.to > to) to = sp.to;
      }
    }
  }
  return { from, to, channels: [...channels] };
}


const SENT_END = /(?<=[A-Za-z0-9)"”])\.\s+(?=[A-Z"“])/;

/** "model names Aspen, Breeze and TravelMate." -> ["Aspen","Breeze","TravelMate"] (names, not numbers). */
export function extractModelNames(text: string): string[] {
  const out = new Set<string>();
  const re = /\bmodel names?\b\s*(?:(?:are|include|included|is|being recalled)\b\s*)?(?:in this recall\s*)?:?\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 400).split(SENT_END)[0]!;
    const items = rest.split(/\s*(?:,|;|\band\b|\bor\b)\s*/i);
    let n = 0;
    for (const it of items) {
      const t = it.replace(/^["“'(]+|["”')]+$/g, "").replace(/\.$/, "").trim();
      if (!t || !/^[A-ZÀ-Ý][\wÀ-ÿ'’&+\- ]{1,30}$/.test(t) || t.split(/\s+/).length > 4) break;
      if (/^(All|The|These|Those|This|Each|Only)\b/.test(t)) break;
      out.add(t);
      if (++n >= 25) break;
    }
  }
  return [...out];
}

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Explicit date-code strings: "date codes 0415 or 0515", "(14714 or 21815)", "T0486, T1456 and T2316". */
export function extractDateCodeList(text: string): { codes: string[]; formats: string[] } {
  const codes = new Set<string>();
  const formats = new Set<string>();
  for (const sent of text.split(SENT_END)) {
    if (!/date codes?|manufactur\w* codes?|production codes?|code stamp/i.test(sent)) continue;
    const fmt = sent.match(/\b(MMYY|YYMM|MMYYYY|YYYYMM|DDMMYY|YYMMDD)\b/i);
    if (fmt) formats.add(fmt[1]!.toUpperCase());
    if (/two-digit year followed by (?:the )?two-digit month/i.test(sent)) formats.add("YYMM");
    if (/two-digit month followed by (?:the )?two-digit year/i.test(sent)) formats.add("MMYY");
    const start = sent.search(/date codes?|manufactur\w* codes?|production codes?/i);
    const colon = sent.indexOf(":", start);
    // "…recalled units have the code: 0714, 0814 …": a colon within reach introduces the list
    const tail = colon >= 0 && colon - start < 160 ? sent.slice(colon + 1) : sent.slice(start).replace(/^[^:,(]*?(?:date codes?|manufactur\w* codes?|production codes?)\b/i, "");
    // cut at words that end the list
    const clause = tail.split(/\s+(?:are|is|can|were|was|will)\b|\b(?:are included|is included|are printed|is printed|printed|located|stamped|which stand|indicating|represents?|sold|are located|can be found|are found|is found)\b/i)[0]!;
    for (const raw of clause.split(/\s*(?:,|;|\bor\b|\band\b|\bthrough\b|\bthru\b)\s*/i)) {
      const t = raw.replace(/^(?:starting with|beginning with|begins? with|of|the|are|is|number|numbers?|code|codes?|:|\(|")\s*/gi, "").replace(/[)".]+$/g, "").trim();
      if (!t || t.length > 24 || /\s{2,}/.test(t)) continue;
      const a = alnum(t);
      if (a.length < 3 || !/\d/.test(a) || isYearish(a) || parseLooseDate(t) !== null) continue;
      if (/^[A-Za-z]{4,}$/.test(t)) continue;
      codes.add(t);
    }
  }
  return { codes: [...codes].slice(0, 60), formats: [...formats] };
}

/** "serial numbers from 19010 11153 00001 to 19010 51248 00215" and "00061617 to 00064364 and 00064767 to 00065762". */
export function extractSerialRanges(text: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const NUM = "[A-Z0-9]*\\d[A-Z0-9]*(?:[ -][A-Z0-9]*\\d[A-Z0-9]*){0,3}";
  const re = new RegExp(`serial numbers?\\b`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const clause = text.slice(m.index, m.index + 500).split(SENT_END)[0]!;
    for (const r of clause.matchAll(new RegExp(`(${NUM})\\s+(?:to|through|thru)\\s+(${NUM})`, "gi"))) {
      const from = alnum(r[1]!), to = alnum(r[2]!);
      if (from.length >= 4 && to.length >= 4 && from.length === to.length && !out.some((x) => x.from === from && x.to === to)) out.push({ from, to });
    }
  }
  return out;
}

/** Cues that the notice does not list everything it covers. */
export function listsIncomplete(text: string): boolean {
  return /(complete list|full list|list of (?:all )?(?:the )?(?:model|item|style|product|serial|lot)s?|(?:firm|company|manufacturer)['’]?s? website|visit (?:the )?(?:firm|company|manufacturer)|listed (?:below|on)|following (?:models|styles|items|products|lamp styles)|(?:Model|Item|Style) (?:Name|Number|#)\s+(?:Description|Color|Item|Style|Model|Date|UPC|Price|Serial|Number)|identified by (?:style|model|item) number|range listed below)/i.test(text);
}

/** Compares a user's serial against recalled ranges. Returns null when not comparable. */
export function serialInRanges(serial: string, ranges: { from: string; to: string }[]): boolean | null {
  const s = alnum(serial);
  let comparable = false;
  for (const r of ranges) {
    if (s.length !== r.from.length) continue;
    comparable = true;
    if (s >= r.from && s <= r.to) return true;
  }
  return comparable ? false : null;
}

export const regexExtractor: ConditionExtractor = {
  extract(text, ctx) {
    const mfg = extractMfgWindow(text);
    const sold = extractSold(ctx.sold);
    const dc = extractDateCodeList(text);
    return {
      models: [...new Set(extractModels(text))],
      modelNames: extractModelNames(text),
      dateCodes: mfg.dateCodes,
      dateCodeList: dc.codes,
      serialRanges: extractSerialRanges(text),
      listsIncomplete: listsIncomplete(text),
      mfgFrom: mfg.from,
      mfgTo: mfg.to,
      batches: extractBatches(text),
      soldFrom: sold.from,
      soldTo: sold.to,
      channels: sold.channels,
      exhaustive: false,
    };
  },
};

export type { DateSpan };
