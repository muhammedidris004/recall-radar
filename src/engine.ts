import type { ItemQuery, Verdict } from "./types.ts";
import { loadDataset, type Dataset } from "./ingest.ts";
import { RecallIndex } from "./search.ts";
import { assess, rank } from "./verdict.ts";

export type Status = "CONFIRMED" | "NEEDS_INFO" | "COMPARE_APPEARANCE" | "NO_MATCH";

export interface Coverage {
  recallsChecked: number;
  sources: string[];
  fromYear: string;
  dataThrough: string;
  syncedOn: string;
}

export interface CheckResult {
  status: Status;
  /** Recalls that might apply, best first (CONFIRMED, NEEDS_INFO, COMPARE_APPEARANCE). */
  matches: Verdict[];
  /** Same brand/product but ruled out by the label details. */
  excluded: Verdict[];
  coverage: Coverage;
}

export interface CheckOptions {
  limit?: number;
  minRelevance?: number;
}

export class RadarEngine {
  readonly index: RecallIndex;
  constructor(readonly dataset: Dataset = loadDataset()) {
    this.index = new RecallIndex(dataset.recalls);
  }

  get coverage(): Coverage {
    const d = this.dataset;
    const earliest = d.recalls.reduce((a, r) => (r.date && (!a || r.date < a) ? r.date : a), "");
    return {
      recallsChecked: d.recalls.length,
      sources: ["U.S. CPSC (consumer products)", "U.S. NHTSA (child car seats)"],
      fromYear: earliest.slice(0, 4),
      dataThrough: d.dataThrough,
      syncedOn: d.syncedOn,
    };
  }

  check(q: ItemQuery, opts: CheckOptions = {}): CheckResult {
    const { limit = 5, minRelevance = 0.4 } = opts;
    if (!q.brand && q.description) {
      const brand = this.index.inferBrand(q.description);
      if (brand) q = { ...q, brand };
    }
    const hits = this.index.search(q, 25).filter((h) => h.relevance >= minRelevance);
    const verdicts = rank(hits.map((h) => assess(q, h)));
    const matches = verdicts.filter((v) => v.kind !== "EXCLUDED").slice(0, limit);
    const excluded = verdicts.filter((v) => v.kind === "EXCLUDED" && v.relevance >= 0.5).slice(0, 3);
    const top = matches[0]?.kind;
    const status: Status = top === "CONFIRMED" ? "CONFIRMED" : top === "NEEDS_INFO" ? "NEEDS_INFO" : top === "COMPARE_APPEARANCE" ? "COMPARE_APPEARANCE" : "NO_MATCH";
    return { status, matches, excluded, coverage: this.coverage };
  }

  get(id: string) {
    return this.dataset.recalls.find((r) => r.id === id);
  }
}
