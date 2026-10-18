/**
 * The decision step. A language model may help *read* a label or a notice, but this module decides
 * whether an item is covered by comparing explicit values, and records the evidence for every call.
 */
import type { Criterion, Evidence, ItemQuery, RecallImage, RecallRecord, Verdict, VerdictKind } from "./types.ts";
import { dateCodeMatches, matchModel, parseLooseDate, productTypes, shortTitle, spanVsWindow, tokenize, normalizeModel } from "./text.ts";
import { serialInRanges } from "./extract.ts";
import type { Hit } from "./search.ts";

const fmt = (iso?: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const names = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return d && d !== "01" ? `${names[Number(m)]} ${Number(d)}, ${y}` : `${names[Number(m)]} ${y}`;
};
const fmtEnd = (iso?: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const names = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return Number(d) === last ? `${names[Number(m)]} ${y}` : `${names[Number(m)]} ${Number(d)}, ${y}`;
};

function windowText(from?: string, to?: string): string {
  if (from && to) return `${fmt(from)} to ${fmtEnd(to)}`;
  if (from) return `on or after ${fmt(from)}`;
  if (to) return `before ${fmtEnd(to)}`;
  return "";
}

/** Reference photos whose captions describe where the model / date label is. */
export function labelHints(rec: RecallRecord): RecallImage[] {
  return rec.images.filter((i) => /(model|label|date|tag|sticker|serial|lot|batch)/i.test(i.caption)).slice(0, 3);
}

/** Tokens of the user's model *name*: the model plus the description, minus brand and product-type words. */
function userNameTokens(q: ItemQuery): Set<string> {
  const text = `${q.model ?? ""} ${q.description ?? ""}`;
  const drop = new Set([...tokenize(q.brand ?? "", { keepStop: true }), ...productTypes(text), "seat", "car"]);
  return new Set(tokenize(text, { keepStop: true }).filter((t) => !drop.has(t)));
}

/** Jaccard similarity between the user's model name and the recalled model names (best of). */
function nameSimilarity(u: Set<string>, names: string[], brand: string): number {
  const dropBrand = new Set(tokenize(brand, { keepStop: true }));
  let best = 0;
  for (const n of names) {
    const t = new Set(tokenize(n, { keepStop: true }).filter((x) => !dropBrand.has(x) && x !== "seat" && x !== "car" && x !== "carseat"));
    if (!t.size || !u.size) continue;
    let inter = 0;
    for (const x of t) if (u.has(x)) inter++;
    best = Math.max(best, inter / (t.size + u.size - inter));
  }
  return best;
}


const list = (xs: string[], n = 3) => xs.slice(0, n).join(", ") + (xs.length > n ? `, +${xs.length - n} more` : "");

/** Builds the requirement-by-requirement table from the evidence already gathered. */
function buildCriteria(q: ItemQuery, rec: RecallRecord, hit: Hit, ev: Evidence[]): Criterion[] {
  const c = rec.conditions;
  const has = (...codes: string[]) => ev.some((e) => codes.includes(e.code));
  const stateOf = (match: string[], bad: string[], close: string[], yours: unknown): Criterion["state"] =>
    has(...match) ? "match" : has(...bad) ? "mismatch" : has(...close) ? "close" : yours ? "unknown" : "unknown";
  const out: Criterion[] = [];

  out.push({
    key: "product",
    label: "Product",
    recall: rec.productNames[0] && rec.productNames[0].length < 70 ? rec.productNames[0] : shortTitle(rec.title),
    yours: (q.brand && q.description && !q.description.toLowerCase().includes(q.brand.toLowerCase()) ? `${q.brand} ${q.description}` : q.description ?? q.brand) || undefined,
    state: hit.brandMatch === false ? "mismatch" : "match",
  });
  if (c.models.length) out.push({ key: "model", label: "Model number", recall: list(c.models), yours: q.model, state: stateOf(["model-match"], ["model-mismatch"], ["model-near"], q.model) });
  if (c.modelNames.length) out.push({ key: "name", label: "Model name", recall: list(c.modelNames), yours: q.model ?? undefined, state: stateOf(["model-name-match"], ["model-name-mismatch"], ["model-name-near"], q.model) });
  if (c.mfgFrom || c.mfgTo) out.push({ key: "made", label: "Made", recall: windowText(c.mfgFrom, c.mfgTo), yours: q.dateCode, state: stateOf(["date-in-range"], ["date-out-of-range"], ["date-edge"], q.dateCode) });
  else if ((c.dateCodeList ?? []).length) out.push({ key: "code", label: "Date code", recall: list(c.dateCodeList!), yours: q.dateCode, state: stateOf(["date-code-match"], ["date-code-mismatch"], [], q.dateCode) });
  if (c.batches.length) out.push({ key: "batch", label: "Batch / lot", recall: list(c.batches), yours: q.batch, state: stateOf(["batch-match"], ["batch-mismatch"], [], q.batch) });
  if ((c.serialRanges ?? []).length) out.push({ key: "serial", label: "Serial number", recall: "in a recalled serial range", yours: q.serial, state: stateOf(["serial-in-range"], ["serial-out-of-range"], [], q.serial) });
  return out;
}

export function assess(q: ItemQuery, hit: Hit): Verdict {
  const rec = hit.rec;
  const c = rec.conditions;
  const ev: Evidence[] = [];
  const missing: string[] = [];
  let kind: VerdictKind;

  const modelConstraint = c.models.length > 0;
  const nameConstraint = c.modelNames.length > 0 && c.exhaustive;
  const windowConstraint = Boolean(c.mfgFrom || c.mfgTo);
  const batchConstraint = c.batches.length > 0;
  const dcl = c.dateCodeList ?? [];
  const dateCodeOnly = !windowConstraint && dcl.length === 0 && c.dateCodes.length > 0;

  let hardNeg = false;
  let positives = 0;
  let unmet = 0;
  let nearModel: string | null = null;

  if (hit.brandMatch) ev.push({ code: "brand-match", polarity: 1, text: `The brand and product match this recall: ${rec.title}.` });

  // --- model number ---
  const userModelText = [q.model, q.description].filter(Boolean).join(" ");
  if (modelConstraint) {
    if (q.model) {
      const mm = matchModel(q.model, c.models);
      if (mm?.kind === "exact") {
        ev.push({ code: "model-match", polarity: 1, text: `Model ${q.model} is named in the recall.` });
        positives++;
      } else if (mm?.kind === "near") {
        nearModel = mm.candidate;
        ev.push({ code: "model-near", polarity: 0, text: `Your model ${q.model} is very close to ${mm.candidate}, which is in the recall. Re-read the label carefully.` });
        unmet++;
        missing.push(`Re-check the model number on the label. It reads close to "${mm.candidate}".`);
      } else {
        const shown = c.models.slice(0, 6).join(", ") + (c.models.length > 6 ? ", …" : "");
        if (c.listsIncomplete) {
          // The notice points elsewhere for the full list: "not listed here" is NOT "not recalled".
          ev.push({ code: "model-not-in-excerpt", polarity: 0, text: `The notice text names ${shown}, but it also refers to a fuller list elsewhere, so ${q.model} can't be ruled out.` });
          unmet++;
          missing.push(`Check ${q.model} against the full list from the manufacturer${rec.contact ? " (" + rec.contact.slice(0, 120) + ")" : ""}.`);
        } else {
          ev.push({ code: "model-mismatch", polarity: -1, text: `The recall covers model ${shown}. Yours (${q.model}) is not listed.` });
          hardNeg = true;
        }
      }
    } else {
      unmet++;
      missing.push("Model number — printed on a label on the product.");
    }
  }
  const softNames = !modelConstraint && !nameConstraint && c.modelNames.length > 0;
  if (softNames) {
    const have = new Set(tokenize(`${q.model ?? ""} ${q.description ?? ""}`, { keepStop: true }));
    const hit2 = c.modelNames.find((n) => tokenize(n, { keepStop: true }).every((t) => have.has(t)));
    if (hit2) {
      ev.push({ code: "model-name-match", polarity: 1, text: `The model name "${hit2}" is named in the recall.` });
      positives++;
    } else {
      unmet++;
      missing.push(`Model name — the recall covers ${c.modelNames.slice(0, 6).join(", ")}${c.modelNames.length > 6 ? ", …" : ""}.`);
    }
  }
  if (nameConstraint) {
    // NHTSA lists model *names* ("SnugRide Turn & Slide"), not numbers, so compare names.
    const userTokens = userNameTokens(q);
    const sim = userTokens.size ? nameSimilarity(userTokens, c.modelNames, rec.brand) : -1;
    if (sim >= 0.75) {
      ev.push({ code: "model-name-match", polarity: 1, text: `The model name matches (${c.modelNames[0]}).` });
      positives++;
    } else if (sim === 0) {
      ev.push({ code: "model-name-mismatch", polarity: -1, text: `This recall covers ${c.modelNames.join(", ")}. Yours (${q.model ?? q.description}) is a different model.` });
      hardNeg = true;
    } else if (sim > 0) {
      ev.push({ code: "model-name-near", polarity: 0, text: `Your model name is similar to ${c.modelNames[0]}, which is recalled, but not identical.` });
      unmet++;
      missing.push(`The exact model name on the label — this recall covers "${c.modelNames[0]}".`);
    } else {
      unmet++;
      missing.push(`Model name — this recall covers "${c.modelNames[0]}".`);
    }
    if (!windowConstraint && !c.windowSuspect) {
      unmet++;
      missing.push("This government record lists no manufacture dates for the model, so check the date range in the NHTSA notice (1-888-327-4236).");
      ev.push({ code: "source-has-no-dates", polarity: 0, text: "The government record for this model gives no manufacture date range, so I can't narrow it down further." });
    }
  }

  if (c.windowSuspect) {
    unmet++;
    missing.push("The official record's manufacture dates for this model are inconsistent. Confirm with the manufacturer or NHTSA (1-888-327-4236).");
    ev.push({ code: "source-dates-inconsistent", polarity: 0, text: "The government record lists manufacture dates that don't add up, so the date can't be checked automatically." });
  }

  // --- manufacture date ---
  const userSpan = q.dateCode ? parseLooseDate(q.dateCode) : null;
  if (windowConstraint) {
    const win = windowText(c.mfgFrom, c.mfgTo);
    if (userSpan) {
      const rel = spanVsWindow(userSpan, { from: c.mfgFrom, to: c.mfgTo });
      if (rel === "inside") {
        ev.push({ code: "date-in-range", polarity: 1, text: `Made ${q.dateCode}, which is inside the recalled manufacture window (${win}).` });
        positives++;
      } else if (rel === "outside") {
        ev.push({ code: "date-out-of-range", polarity: -1, text: `Made ${q.dateCode}, which is outside the recalled manufacture window (${win}).` });
        hardNeg = true;
      } else {
        ev.push({ code: "date-edge", polarity: 0, text: `Made ${q.dateCode}, which only partly overlaps the recalled window (${win}).` });
        unmet++;
        missing.push("The exact day of manufacture — your date is right at the edge of the recalled window.");
      }
    } else {
      unmet++;
      missing.push(`Date of manufacture — recalled units were made ${win}. It's on the same label.`);
    }
  } else if (dcl.length) {
    const m = dateCodeMatches(q.dateCode, userSpan, dcl);
    if (m === true) {
      ev.push({ code: "date-code-match", polarity: 1, text: `Date code ${q.dateCode} is one of the recalled codes.` });
      positives++;
    } else if (m === false && !c.listsIncomplete) {
      ev.push({ code: "date-code-mismatch", polarity: -1, text: `The recall covers date codes ${dcl.slice(0, 6).join(", ")}${dcl.length > 6 ? ", …" : ""}. Yours (${q.dateCode}) is not among them.` });
      hardNeg = true;
    } else if (m === false) {
      ev.push({ code: "date-code-not-in-excerpt", polarity: 0, text: "The notice lists date codes but points to a fuller list elsewhere, so this code can't be ruled out." });
      unmet++;
      missing.push("Check the date code against the full list from the manufacturer.");
    } else {
      unmet++;
      missing.push(`Date code — the notice lists ${dcl.slice(0, 4).join(", ")}${dcl.length > 4 ? ", …" : ""}. It's printed on the product.`);
    }
  } else if (dateCodeOnly) {
    unmet++;
    missing.push(`Date code — the notice lists specific date codes (${c.dateCodes.slice(0, 3).join("; ")}).`);
  }

  // --- serial number ranges ---
  const sr = c.serialRanges ?? [];
  if (sr.length) {
    if (q.serial) {
      const inR = serialInRanges(q.serial, sr);
      if (inR === true) { ev.push({ code: "serial-in-range", polarity: 1, text: `Serial ${q.serial} is inside a recalled serial range.` }); positives++; }
      else if (inR === false && !c.listsIncomplete) { ev.push({ code: "serial-out-of-range", polarity: -1, text: `Serial ${q.serial} is outside the recalled serial range${sr.length > 1 ? "s" : ""}.` }); hardNeg = true; }
      else { unmet++; missing.push("Re-read the full serial number; it didn't match the recalled format."); }
    } else {
      unmet++;
      missing.push("Serial number — the recall covers specific serial ranges. It's printed on the product.");
    }
  }

  // --- batch / lot ---
  if (batchConstraint) {
    if (q.batch) {
      const hit2 = c.batches.some((b) => normalizeModel(b) === normalizeModel(q.batch!));
      if (hit2) {
        ev.push({ code: "batch-match", polarity: 1, text: `Batch ${q.batch} is named in the recall.` });
        positives++;
      } else {
        ev.push({ code: "batch-mismatch", polarity: -1, text: `The recall covers batch ${c.batches.slice(0, 5).join(", ")}. Yours (${q.batch}) is not listed.` });
        hardNeg = true;
      }
    } else {
      unmet++;
      missing.push(`Batch or lot number — the notice lists ${c.batches.slice(0, 4).join(", ")}.`);
    }
  }

  const hasAnyConstraint = modelConstraint || nameConstraint || softNames || windowConstraint || batchConstraint || dateCodeOnly || dcl.length > 0 || sr.length > 0;

  // --- retail context (soft evidence only: secondhand units can be older than the sales window) ---
  if (c.soldFrom || c.soldTo || c.channels.length) {
    const bought = q.boughtWhen ? parseLooseDate(q.boughtWhen) : null;
    if (bought && (c.soldFrom || c.soldTo)) {
      const rel = spanVsWindow(bought, { from: c.soldFrom, to: c.soldTo });
      ev.push(
        rel === "outside"
          ? { code: "bought-outside-sales-window", polarity: 0, text: `This was sold ${windowText(c.soldFrom, c.soldTo)}. If you bought it new at another time, check the label; if it's secondhand it may still be one of them.` }
          : { code: "bought-in-sales-window", polarity: 1, text: `Your purchase time fits the retail sales window (${windowText(c.soldFrom, c.soldTo)}).` },
      );
    }
    if (q.boughtWhere && c.channels.some((ch) => q.boughtWhere!.toLowerCase().includes(ch.toLowerCase().split(" ")[0]!))) {
      ev.push({ code: "channel-match", polarity: 1, text: `It was sold where you bought yours (${q.boughtWhere}).` });
    }
  }

  // --- decide ---
  if (hardNeg) kind = "EXCLUDED";
  else if (!hasAnyConstraint) {
    kind = "COMPARE_APPEARANCE";
    missing.push("The notice names no model number or date. Compare your product with the photos and description.");
  } else if (unmet === 0 && positives > 0 && (positives > 1 || modelConstraint || nameConstraint || batchConstraint || dcl.length > 0 || sr.length > 0 || hit.relevance >= 0.5)) kind = "CONFIRMED";
  else kind = "NEEDS_INFO";

  return { kind, recall: rec, relevance: hit.relevance, evidence: ev, criteria: buildCriteria(q, rec, hit, ev), missing: [...new Set(missing)] };
}

const ORDER: Record<VerdictKind, number> = { CONFIRMED: 0, NEEDS_INFO: 1, COMPARE_APPEARANCE: 2, EXCLUDED: 3 };

export function rank(vs: Verdict[]): Verdict[] {
  return [...vs].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.relevance - a.relevance);
}
