/** Shapes engine results for voice (headline / next question) and screen (structuredContent for the MCP App). */
import type { CheckResult } from "./engine.ts";
import type { Verdict } from "./types.ts";
import { labelHints } from "./verdict.ts";
import { firstSentence, shortTitle, trimSentence } from "./text.ts";

export { firstSentence, shortTitle };

export interface MatchView {
  recallId: string;
  source: "CPSC" | "NHTSA";
  number: string;
  kind: Verdict["kind"];
  title: string;
  /** Speakable short name, e.g. "Peg Perego Tatamia 3-in-1 Recliners, Swings and High Chairs". */
  name: string;
  date: string;
  relevance: number;
  hazard: string;
  remedy: string;
  remedyOptions: string[];
  contact: string;
  url: string;
  units?: string;
  injuries?: string;
  evidence: { code: string; text: string; polarity: number }[];
  criteria: { key: string; label: string; recall: string; yours?: string; state: "match" | "mismatch" | "close" | "unknown" }[];
  missing: string[];
  /** Reference photos showing where the label is / what the recalled product looks like. */
  labelPhotos: { url: string; caption: string }[];
  photos: { url: string; caption: string }[];
}

export interface CheckView {
  status: CheckResult["status"];
  /** One or two sentences Alexa can say as-is. */
  headline: string;
  /** The single most useful question to ask next (when more info would change the answer). */
  nextQuestion?: string;
  matches: MatchView[];
  excluded: MatchView[];
  coverage: CheckResult["coverage"];
  caseId?: string;
  caseNickname?: string;
  disclaimer: string;
}

export const DISCLAIMER =
  "Based on public U.S. CPSC and NHTSA recall data. A missing match doesn't prove a product is safe, so check cpsc.gov or nhtsa.gov, and follow the manufacturer's instructions.";

export function toView(v: Verdict): MatchView {
  const r = v.recall;
  return {
    recallId: r.id,
    source: r.source,
    number: r.number,
    kind: v.kind,
    title: r.title,
    name: shortTitle(r.title),
    date: r.date,
    relevance: Number(v.relevance.toFixed(2)),
    hazard: r.hazard,
    remedy: r.remedy,
    remedyOptions: r.remedyOptions,
    contact: r.contact,
    url: r.url,
    units: r.units,
    injuries: r.injuries,
    evidence: v.evidence,
    criteria: v.criteria,
    missing: v.missing,
    labelPhotos: labelHints(r),
    photos: r.images.slice(0, 4),
  };
}

const remedySpeech = (v: Verdict) => {
  const opts = v.recall.remedyOptions.map((o) => o.toLowerCase());
  return opts.length ? `The official remedy is a ${opts.join(" or ")}.` : "";
};

export function present(res: CheckResult, ctx: { caseId?: string; nickname?: string } = {}): CheckView {
  const top = res.matches[0];
  let headline: string;
  let nextQuestion: string | undefined;

  switch (res.status) {
    case "CONFIRMED": {
      const r = top!.recall;
      headline = `Yes. This is covered by a recall: ${shortTitle(r.title)}. ${firstSentence(r.hazard)} ${remedySpeech(top!)}`.replace(/\s+/g, " ").trim();
      break;
    }
    case "NEEDS_INFO": {
      const r = top!.recall;
      nextQuestion = top!.missing[0];
      headline = `It might be affected by this recall: ${shortTitle(r.title)}. I can't be sure yet. ${nextQuestion ?? ""}`.trim();
      break;
    }
    case "COMPARE_APPEARANCE": {
      const r = top!.recall;
      nextQuestion = "Does yours look like the product in the photos?";
      headline = `There's a recall for a similar product, ${shortTitle(r.title)}, but the notice names no model number or date, so it has to be matched by appearance.`;
      break;
    }
    default: {
      const ex = res.excluded[0];
      if (ex) {
        const why = ex.evidence.find((e) => e.polarity < 0)?.text ?? "the label details you gave rule it out";
        headline = `Your item looks like a recalled product line, but it isn't covered by the recall for ${shortTitle(ex.recall.title)}. ${why}`;
        nextQuestion = "If the label reads differently, tell me and I'll check again.";
      } else {
        headline = `I didn't find a recall matching that among ${res.coverage.recallsChecked.toLocaleString("en-US")} U.S. baby-product recalls from ${res.coverage.fromYear} to ${res.coverage.dataThrough}.`;
        nextQuestion = "Read me the model number and date from the label and I'll check again.";
      }
    }
  }

  return {
    status: res.status,
    headline,
    nextQuestion,
    matches: res.matches.map(toView),
    excluded: res.excluded.map(toView),
    coverage: res.coverage,
    caseId: ctx.caseId,
    caseNickname: ctx.nickname,
    disclaimer: DISCLAIMER,
  };
}
