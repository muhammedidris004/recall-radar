/** Conditions that must hold for a unit to be covered by a recall. */
export interface Conditions {
  /** Model / style / item numbers named by the recall (normalised later for comparison). */
  models: string[];
  /** Marketing names ("Table2Table", "New Moon") — weaker evidence than model numbers. */
  modelNames: string[];
  /** Raw date-code strings found in the notice ("07/2025", "2023-12 to 2024-05"). */
  dateCodes: string[];
  /** Manufacture window, ISO `yyyy-mm-dd` (month-precision values are expanded). Open ends are undefined. */
  mfgFrom?: string;
  mfgTo?: string;
  /** Production batch / lot codes. */
  batches: string[];
  /** Sold-at window, ISO. */
  soldFrom?: string;
  soldTo?: string;
  /** Where it was sold (Amazon.com, Target, Walmart…). */
  channels: string[];
  /**
   * True when the listed models are the *only* affected ones, so a different model can be
   * called "excluded". True for NHTSA (structured), false for prose-derived CPSC data.
   */
  exhaustive: boolean;
  /** True when the source's manufacture window is internally inconsistent (e.g. begin after end). */
  windowSuspect?: boolean;
  /** Explicit date-code strings the notice lists ("0415", "T0486", "FAC-010635-16194"). */
  dateCodeList?: string[];
  /** Serial-number ranges (digits/letters only, separators removed). */
  serialRanges?: { from: string; to: string }[];
  /**
   * The notice points elsewhere for the full list ("visit the firm's website", a flattened table…), so a
   * model or code that is not listed must NOT be treated as cleared.
   */
  listsIncomplete?: boolean;
}

export interface RecallImage {
  url: string;
  caption: string;
}

export interface RecallRecord {
  /** Stable id, e.g. `cpsc:26290` or `nhtsa:26C003000`. */
  id: string;
  source: "CPSC" | "NHTSA";
  number: string;
  /** ISO date the recall was announced. */
  date: string;
  title: string;
  brand: string;
  productNames: string[];
  description: string;
  hazard: string;
  remedy: string;
  remedyOptions: string[];
  contact: string;
  url: string;
  units?: string;
  injuries?: string;
  /** "Amazon.com from March 2023 to July 2026 for $27-$57" style strings. */
  soldAt: string[];
  images: RecallImage[];
  conditions: Conditions;
}

/** What the user knows about the item in front of them. All fields optional. */
export interface ItemQuery {
  /** Free description: "graco high chair", "used baby stroller". */
  description?: string;
  brand?: string;
  model?: string;
  /** Date code / manufacture date as printed on the label ("2019-03", "03/2019", "March 5 2019"). */
  dateCode?: string;
  batch?: string;
  /** Serial number from the label. */
  serial?: string;
  /** Where it was bought, e.g. "Amazon". */
  boughtWhere?: string;
  /** When it was bought, e.g. "September 2025". */
  boughtWhen?: string;
}

export type VerdictKind =
  /** An identifier in the recall matches the item (and no stated condition rules it out). */
  | "CONFIRMED"
  /** Same brand/product, but the label details rule this unit out of the recall. */
  | "EXCLUDED"
  /** Same brand/product; a label detail is needed to decide. */
  | "NEEDS_INFO"
  /** Looks like the same product, but the notice names no identifier — compare by appearance. */
  | "COMPARE_APPEARANCE";

export interface Evidence {
  /** short machine-readable tag, e.g. "model-match", "date-in-range" */
  code: string;
  /** human-readable sentence suitable for speaking */
  text: string;
  /** +1 supports a match, -1 argues against, 0 neutral */
  polarity: 1 | -1 | 0;
}

/** One row of the "what the recall requires vs. what you told me" comparison shown on screen. */
export interface Criterion {
  key: "product" | "model" | "name" | "made" | "code" | "batch" | "serial";
  label: string;
  /** What the recall specifies (short, display-ready). */
  recall: string;
  /** What the user told us, if anything. */
  yours?: string;
  state: "match" | "mismatch" | "close" | "unknown";
}

export interface Verdict {
  kind: VerdictKind;
  recall: RecallRecord;
  /** 0..1 retrieval relevance (brand + product similarity). */
  relevance: number;
  evidence: Evidence[];
  /** Requirement-by-requirement comparison, in the order a person would check a label. */
  criteria: Criterion[];
  /** What the user should look for next (only for NEEDS_INFO / COMPARE_APPEARANCE). */
  missing: string[];
}
