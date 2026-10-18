/** BM25 retrieval over recalls with synonym-normalised product types, a brand gate and model-number boosts. */
import type { ItemQuery, RecallRecord } from "./types.ts";
import { brandKey, normalizeModel, productTypes, tokenize } from "./text.ts";

const K1 = 1.4;
const B = 0.6;

interface Doc {
  rec: RecallRecord;
  tf: Map<string, number>;
  len: number;
  types: Set<string>;
  brandTokens: Set<string>;
  models: Set<string>;
}

export interface Hit {
  rec: RecallRecord;
  /** 0..1 */
  relevance: number;
  brandMatch: boolean | null;
  typeMatch: boolean | null;
}

function brandTokens(rec: RecallRecord): Set<string> {
  const text = `${rec.brand} ${rec.title} ${rec.description.slice(0, 600)}`;
  return new Set(tokenize(text, { keepStop: true }));
}

export class RecallIndex {
  private docs: Doc[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;

  constructor(recalls: RecallRecord[]) {
    for (const rec of recalls) this.docs.push(this.buildDoc(rec));
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.docs.reduce((a, d) => a + d.len, 0) / Math.max(1, this.docs.length);
  }

  get size() {
    return this.docs.length;
  }

  /** Brands seen in the data, longest first, for inferring a brand from free speech ("Peg Perego Tatamia high chair"). */
  private brandList: { key: string; display: string }[] | null = null;
  inferBrand(description: string): string | undefined {
    this.brandList ??= [...new Map(this.docs.map((d) => [brandKey(d.rec.brand), d.rec.brand])).entries()]
      .filter(([k]) => k.length >= 3)
      .map(([key, display]) => ({ key, display }))
      .sort((a, b) => b.key.length - a.key.length);
    const hay = ` ${description.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    for (const b of this.brandList) {
      const words = b.display.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (words.length >= 3 && hay.includes(` ${words} `)) return b.display;
    }
    return undefined;
  }

  private buildDoc(rec: RecallRecord): Doc {
    const tf = new Map<string, number>();
    const add = (tokens: string[], w: number) => {
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + w);
    };
    add(tokenize(rec.brand), 3);
    add(tokenize(rec.title), 2);
    add(tokenize(rec.productNames.join(" ")), 2);
    add(tokenize(rec.description.slice(0, 900)), 1);
    const models = new Set<string>();
    for (const m of [...rec.conditions.models, ...rec.conditions.modelNames]) {
      const n = normalizeModel(m);
      if (n.length >= 3) {
        models.add(n);
        tf.set(`m:${n}`, 4);
      }
    }
    let len = 0;
    for (const v of tf.values()) len += v;
    return {
      rec,
      tf,
      len,
      types: productTypes(`${rec.title} ${rec.productNames.join(" ")}`),
      brandTokens: brandTokens(rec),
      models,
    };
  }

  private idf(t: string): number {
    const n = this.df.get(t) ?? 0;
    return Math.log(1 + (this.docs.length - n + 0.5) / (n + 0.5));
  }

  search(q: ItemQuery, limit = 8): Hit[] {
    const textTokens = tokenize(`${q.description ?? ""} ${q.brand ?? ""} ${q.brand ?? ""}`);
    const qTypes = productTypes(`${q.description ?? ""}`);
    const qBrandToks = q.brand ? tokenize(q.brand, { keepStop: true }) : [];
    const qModel = q.model ? normalizeModel(q.model) : "";
    const qTokens = [...new Set(textTokens)];
    if (qModel.length >= 3) qTokens.push(`m:${qModel}`);
    if (!qTokens.length) return [];

    // Upper bound of a document's score for this query, used to normalise to 0..1.
    let maxScore = 0;
    for (const t of qTokens) maxScore += this.idf(t) * (K1 + 1) * (t.startsWith("m:") ? 1.4 : 1);

    const hits: Hit[] = [];
    for (const d of this.docs) {
      let score = 0;
      for (const t of qTokens) {
        const f = d.tf.get(t);
        if (!f) continue;
        const boost = t.startsWith("m:") ? 1.4 : 1;
        score += boost * this.idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / this.avgLen)));
      }
      if (score <= 0) continue;
      let relevance = Math.min(1, score / (maxScore * 0.75));

      // Product-type gate: a "stroller" query shouldn't surface a crib recall.
      let typeMatch: boolean | null = null;
      if (qTypes.size && d.types.size) {
        typeMatch = [...qTypes].some((t) => d.types.has(t));
        if (!typeMatch) relevance *= 0.35;
      } else if (qTypes.size && !d.types.size) {
        // The recall doesn't name a recognisable product type (e.g. a ride-on toy). Don't let a shared
        // brand alone make it look like a match for a high chair.
        relevance *= 0.55;
      }
      // Brand gate: when the user names a brand, the recall should mention it.
      let brandMatch: boolean | null = null;
      if (qBrandToks.length) {
        const bk = brandKey(q.brand!);
        const inRec = qBrandToks.every((t) => d.brandTokens.has(t)) || brandKey(`${d.rec.brand} ${d.rec.title}`).includes(bk);
        brandMatch = inRec;
        if (!inRec) relevance *= 0.3;
      }
      // An exact model-number hit is strong evidence regardless of wording.
      if (qModel.length >= 3 && d.models.has(qModel)) relevance = Math.max(relevance, 0.85);

      hits.push({ rec: d.rec, relevance, brandMatch, typeMatch });
    }
    return hits.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  }
}
