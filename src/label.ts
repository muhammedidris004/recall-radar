/**
 * Reads the text printed on a product label (typed, spoken, or OCR'd from a photo) and pulls out the fields
 * recall matching needs: brand, model, manufacture date, batch/lot, serial.
 *
 * Labels are messy: OCR confuses O/0 and I/1, dates come as "DOM 03/19", "Mfg: 2019-03", "Made 5/2019".
 * The parser only returns what it can see, and reports what is still missing so the conversation can ask
 * for the next useful detail instead of guessing.
 */
import { parseLooseDate } from "./text.ts";

export interface LabelFields {
  brand?: string;
  model?: string;
  dateCode?: string;
  batch?: string;
  serial?: string;
  /** Raw lines we could not classify (useful for the user to double-check). */
  unread: string[];
}

const KNOWN_BRANDS = [
  "Graco", "Fisher-Price", "Fisher Price", "Evenflo", "Britax", "Chicco", "Safety 1st", "Summer Infant", "Baby Trend", "Cosco",
  "Dorel", "Maxi-Cosi", "Maxi Cosi", "Cybex", "Nuna", "UPPAbaby", "Bugaboo", "Peg Perego", "Joovy", "Delta Children", "Child Craft",
  "Kolcraft", "Munchkin", "Skip Hop", "Ikea", "Stokke", "Ergobaby", "Boppy", "Baby Jogger", "Thule", "Diono", "Clek", "Sassy",
  "Crown Crafts", "Lifetime Products", "Newell", "Bassettbaby", "Pottery Barn Kids", "Simmons", "Jeep", "Step2", "Radio Flyer",
];

const LABEL = String.raw`(?:model|mod|mdl|style|item|sku|part|cat(?:alog)?)\b(?:\s*(?:no|num|number|#)\b)?`;

function ocrFix(s: string): string {
  // In tokens that are mostly digits, letter O -> 0 and I/l -> 1 are the usual OCR slips.
  return s.replace(/[A-Za-z0-9\-]{4,}/g, (t) => {
    const digits = (t.match(/\d/g) ?? []).length;
    return digits / t.length > 0.6 ? t.replace(/[Oo]/g, "0").replace(/[Il]/g, "1") : t;
  });
}

/** Model tokens contain a digit or are an all-caps code; this rejects prose such as "catalog of …". */
const looksLikeModel = (t: string) => /\d/.test(t) || (t.length >= 3 && t === t.toUpperCase() && /[A-Z]/.test(t));

export function parseLabel(text: string): LabelFields {
  const out: LabelFields = { unread: [] };
  const lines = text
    .split(/\r?\n|;|\|/)
    .map((l) => l.trim())
    .filter(Boolean);
  const claimed = new Set<number>();

  const grab = (re: RegExp, idx: (m: RegExpMatchArray) => string | undefined, assign: (v: string) => void, lineIdx?: number) => {
    for (let i = 0; i < lines.length; i++) {
      if (lineIdx !== undefined && i !== lineIdx) continue;
      const m = lines[i]!.match(re);
      const v = m && idx(m);
      if (v) {
        assign(v.trim());
        claimed.add(i);
        return true;
      }
    }
    // Single-line labels ("Model: X Date: Y"): search the whole text
    const m = text.match(re);
    const v = m && idx(m);
    if (v) {
      assign(v.trim());
      return true;
    }
    return false;
  };

  // model
  grab(new RegExp(`\\b${LABEL}\\s*[:.#]?\\s*["“]?([A-Za-z0-9][A-Za-z0-9\\-/.]{1,24})`, "i"), (m) => (looksLikeModel(m[1]!) ? ocrFix(m[1]!) : undefined), (v) => (out.model = v));
  // batch / lot / serial
  grab(/\b(?:batch|lot)\b(?:\s*(?:no|num|number|#|code)\b)?\s*[:.#]?\s*["“]?([A-Za-z0-9][A-Za-z0-9\-/]{2,24})/i, (m) => ocrFix(m[1]!), (v) => (out.batch = v));
  grab(/\b(?:serial|s\/n|sn)\b(?:\s*(?:no|num|number|#)\b)?\s*[:.#]?\s*["“]?([A-Za-z0-9][A-Za-z0-9\-/]{3,30}(?:[ -]\d{2,}){0,3})/i, (m) => ocrFix(m[1]!), (v) => (out.serial = v));
  // manufacture date: "DOM", "Mfg date", "Date of manufacture", "Made", "Manufactured", "Date code"
  const dateRe = /\b(?:dom|d\.o\.m\.?|mfg\.?(?:\s*date)?|manufactur\w*(?:\s*date)?|date\s*of\s*manufactur\w*|date\s*code|made|prod(?:uction)?\.?\s*date)\s*(?:in|on)?\s*[:.]?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}[-/. ]\d{1,2}(?:[-/. ]\d{1,2})?|\d{1,2}[-/. ]\d{1,2}[-/. ]\d{2,4}|\d{1,2}[-/.]\d{4}|\d{1,2}[-/.]\d{2})\b/i;
  grab(dateRe, (m) => m[1], (v) => (out.dateCode = normaliseLabelDate(v)));

  // brand: first known brand mentioned
  for (const b of KNOWN_BRANDS) {
    if (new RegExp(`(?<![A-Za-z0-9])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i").test(text)) {
      out.brand = b;
      break;
    }
  }
  out.unread = lines.filter((_, i) => !claimed.has(i)).slice(0, 8);
  return out;
}

/** "03/19" is month/year on many labels; "2019-03" and "March 2019" pass through. */
export function normaliseLabelDate(v: string): string {
  const s = v.trim();
  const mmyy = s.match(/^(\d{1,2})[-/.](\d{2})$/);
  if (mmyy && Number(mmyy[1]) >= 1 && Number(mmyy[1]) <= 12) return `${mmyy[1]!.padStart(2, "0")}/20${mmyy[2]}`;
  const ddmmyy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (ddmmyy) return `${ddmmyy[1]}/${ddmmyy[2]}/20${ddmmyy[3]}`;
  return parseLooseDate(s) ? s : s;
}

/** What is still missing to run a precise check. */
export function labelGaps(f: LabelFields): string[] {
  const gaps: string[] = [];
  if (!f.model) gaps.push("model number");
  if (!f.dateCode) gaps.push("date of manufacture");
  return gaps;
}
