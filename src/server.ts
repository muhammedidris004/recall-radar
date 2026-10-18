/**
 * Recall Radar MCP server.
 *
 * Tools are designed for an agentic voice host (Alexa+ style): few, outcome-oriented, each answering a
 * whole user intent, with a speakable `headline` and a `nextQuestion` so the host can keep the
 * conversation moving. Visuals use the MCP Apps extension (`ui://` resource + `_meta.ui.resourceUri`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RadarEngine } from "./engine.ts";
import { FileCaseStore, CASE_STATUSES, newCase, type Case, type CaseStatus, type CaseStore } from "./cases.ts";
import { parseLabel, labelGaps } from "./label.ts";
import { present, toView, shortTitle, firstSentence, DISCLAIMER, type CheckView } from "./present.ts";
import type { ItemQuery } from "./types.ts";
import { brandKey, productTypes } from "./text.ts";

export const UI_URI = "ui://recall-radar/result";
export const UI_MIME = "text/html;profile=mcp-app";
const here = dirname(fileURLToPath(import.meta.url));
const uiHtml = () => readFileSync(join(here, "ui", "result.html"), "utf8");

const ui = { ui: { resourceUri: UI_URI, invoking: "Checking recalls…", invoked: "Recall check ready" } };

const itemShape = {
  description: z.string().optional().describe('What the product is, in the user\'s words, e.g. "used high chair" or "infant car seat".'),
  brand: z.string().optional().describe('Brand, e.g. "Graco".'),
  model: z.string().optional().describe("Model number or style number printed on the product's label."),
  date_code: z.string().optional().describe('Manufacture date / date code printed on the label, e.g. "03/2019" or "2019-03-14".'),
  batch: z.string().optional().describe("Batch, lot or production code from the label, if any."),
  serial: z.string().optional().describe("Serial number from the label, if any."),
  bought_where: z.string().optional().describe('Where it was bought, e.g. "Amazon", "Target", "yard sale".'),
  bought_when: z.string().optional().describe('When it was bought or received, e.g. "September 2025".'),
};
type ItemArgs = { [K in keyof typeof itemShape]?: string | undefined };

const toQuery = (a: ItemArgs): ItemQuery => {
  const q: ItemQuery = {};
  if (a.description) q.description = a.description;
  if (a.brand) q.brand = a.brand;
  if (a.model) q.model = a.model;
  if (a.date_code) q.dateCode = a.date_code;
  if (a.batch) q.batch = a.batch;
  if (a.serial) q.serial = a.serial;
  if (a.bought_where) q.boughtWhere = a.bought_where;
  if (a.bought_when) q.boughtWhen = a.bought_when;
  return q;
};

const NEXT_STEPS: Record<CaseStatus, string> = {
  checking: "Read the label details to finish the check.",
  recalled: "Stop using it unless the notice says otherwise, and follow the official remedy.",
  stopped_using: "Request the free remedy from the manufacturer using the link on the recall.",
  remedy_requested: "When the repair kit, refund or replacement arrives, tell me and I'll mark it done.",
  remedy_completed: "All done. I'll keep this on file.",
  cleared: "No recall matched when I checked. Ask me to re-check any time, since new recalls are published every week.",
  disposed: "Thanks for taking it out of use. I'll keep the record.",
};

export interface ServerDeps {
  engine: RadarEngine;
  cases: CaseStore;
}

const caseView = (c: Case) => ({
  id: c.id,
  nickname: c.nickname,
  status: c.status,
  item: c.item,
  recallId: c.recallId,
  recallTitle: c.recallTitle ? shortTitle(c.recallTitle) : undefined,
  remedyUrl: c.remedyUrl,
  lastCheck: c.lastCheck,
  notes: c.notes.slice(-5),
  nextStep: NEXT_STEPS[c.status],
});

const text = (t: string) => [{ type: "text" as const, text: t }];

export function createServer(deps: ServerDeps = { engine: new RadarEngine(), cases: new FileCaseStore() }): McpServer {
  const { engine, cases } = deps;
  const server = new McpServer({ name: "recall-radar", version: "0.1.0" }, {
    instructions:
      "Recall Radar checks baby gear (bought new, used, borrowed or handed down) against official U.S. CPSC and NHTSA recalls and guides the user through the fix. " +
      "Ask the user for the model number and date printed on the product's label — those two details decide most answers. " +
      "Never tell the user a product is 'safe'; say what was and wasn't found and when the data was last updated.",
  });

  // ---- UI resource (MCP Apps) ----
  server.registerResource("recall-radar-result", UI_URI, { title: "Recall Radar result", description: "Result card for a recall check", mimeType: UI_MIME }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: UI_MIME, text: uiHtml(), _meta: { ui: { prefersBorder: false } } }],
  }));

  const nameKey = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const brandOf = (x: ItemQuery) => x.brand ?? (x.description ? engine.index.inferBrand(x.description) : undefined);
  /** Could these two descriptions be the same physical item? A different brand or product type means no. */
  function sameItem(a: ItemQuery, b: ItemQuery): boolean {
    const ba = brandOf(a), bb = brandOf(b);
    if (ba && bb && brandKey(ba) !== brandKey(bb)) return false;
    const ta = productTypes(a.description ?? ""), tb = productTypes(b.description ?? "");
    if (ta.size && tb.size && ![...ta].some((t) => tb.has(t))) return false;
    return true;
  }

  /** Shared by check_item and check_label. */
  function runCheck(q: ItemQuery, nickname: string | undefined): CheckView {
    let c: Case | undefined;
    if (nickname) {
      const hit = cases.find(nickname);
      // Reuse a saved item only for the same name AND the same item. A fuzzy name match must never carry
      // another item's model number or date into this check (found when a real assistant asked about a
      // Bicystar chair and got a Peg Perego recall back).
      if (hit && nameKey(hit.nickname) === nameKey(nickname) && sameItem(hit.item, q)) {
        c = hit;
        q = { ...c.item, ...q }; // new details override, old ones carry over
      } else {
        // Two different items may not share a name; keep the second one's name distinct ("highchair (Bicystar)").
        const taken = new Set(cases.list().map((x) => nameKey(x.nickname)));
        const brand = brandOf(q);
        let name = nickname;
        for (let i = 2; taken.has(nameKey(name)); i++) name = brand && i === 2 ? `${nickname} (${brand})` : `${nickname} (${i})`;
        c = newCase(name, q);
      }
      c.item = q;
    }
    const res = engine.check(q);
    const view = present(res, { caseId: c?.id, nickname: c?.nickname });
    if (c) {
      const top = res.matches[0];
      c.lastCheck = { at: new Date().toISOString(), status: res.status, headline: view.headline, dataThrough: res.coverage.dataThrough };
      const progressed = ["stopped_using", "remedy_requested", "remedy_completed", "disposed"].includes(c.status);
      if (res.status === "CONFIRMED" && top) {
        c.recallId = top.recall.id;
        c.recallTitle = top.recall.title;
        c.remedyUrl = top.recall.url;
        if (!progressed) c.status = "recalled";
      } else if (!progressed) c.status = res.status === "NO_MATCH" ? "cleared" : "checking";
      cases.save(c);
    }
    return view;
  }

  const reply = (view: CheckView, extra: Record<string, unknown> = {}) => {
    const spoken = [view.headline, view.nextQuestion && !view.headline.includes(view.nextQuestion) ? view.nextQuestion : "", `Data through ${view.coverage.dataThrough}.`].filter(Boolean).join(" ");
    return { content: text(spoken), structuredContent: { kind: "check", ...view, ...extra } as Record<string, unknown>, _meta: ui };
  };

  server.registerTool(
    "check_item",
    {
      title: "Check a baby product for recalls",
      description:
        'Checks one baby product (high chair, crib, stroller, bassinet, playard, swing, car seat…) against official CPSC and NHTSA recalls. Use when someone says "I\'m buying this used high chair, is it recalled?", "check my stroller", or gives a brand, model number or date from a label. ' +
        "Works with partial info: it says CONFIRMED, NEEDS_INFO (with the exact missing detail), COMPARE_APPEARANCE or NO_MATCH. Pass `nickname` (e.g. \"highchair\") to remember the item so the user can resume later.",
      inputSchema: { ...itemShape, nickname: z.string().optional().describe('Short name to save this item under, e.g. "highchair". Re-using the same nickname adds new details to the same case.') },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    async (args) => reply(runCheck(toQuery(args), args.nickname)),
  );

  server.registerTool(
    "check_label",
    {
      title: "Read a product label and check it",
      description:
        "Reads text from a product label (typed, spoken, or OCR from a photo), extracts brand, model number, manufacture date and batch, then checks for recalls. Use when the user reads out or uploads what the label says, e.g. \"model 1969721, made March 2018\". Reports which fields it could and couldn't read.",
      inputSchema: {
        label_text: z.string().describe("Raw text from the label, e.g. 'GRACO Model No: 1969721 Date of Manufacture: 2018-03-14'."),
        description: z.string().optional().describe('What the product is, e.g. "high chair".'),
        brand: itemShape.brand,
        bought_where: itemShape.bought_where,
        bought_when: itemShape.bought_when,
        nickname: z.string().optional().describe("Name to save the item under."),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    async (args) => {
      const label = parseLabel(args.label_text);
      const q: ItemQuery = { ...toQuery({ description: args.description, brand: args.brand, bought_where: args.bought_where, bought_when: args.bought_when }) };
      if (label.brand && !q.brand) q.brand = label.brand;
      if (label.model) q.model = label.model;
      if (label.dateCode) q.dateCode = label.dateCode;
      if (label.batch) q.batch = label.batch;
      if (label.serial) q.serial = label.serial;
      const view = runCheck(q, args.nickname);
      return reply(view, { label: { ...label, gaps: labelGaps(label) } });
    },
  );

  server.registerTool(
    "get_recall",
    {
      title: "Recall details and fix",
      description: 'Full details of one recall: hazard, the official remedy steps, contact, and reference photos. Use after a check, e.g. "what do I do about it?" or "how do I get the repair kit?".',
      inputSchema: { recall_id: z.string().describe('Recall id from a check result, e.g. "cpsc:26290".') },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async ({ recall_id }) => {
      const r = engine.get(recall_id);
      if (!r) return { content: text(`I couldn't find recall ${recall_id}.`), isError: true };
      const v = toView({ kind: "CONFIRMED", recall: r, relevance: 1, evidence: [], criteria: [], missing: [] });
      const spoken = `${shortTitle(r.title)}. ${firstSentence(r.hazard)} What to do: ${firstSentence(r.remedy, 260)} The full steps and contact details are on screen.`;
      return { content: text(spoken), structuredContent: { kind: "recall", recall: { ...v, description: r.description }, disclaimer: DISCLAIMER }, _meta: ui };
    },
  );

  server.registerTool(
    "update_case",
    {
      title: "Track progress on a recalled item",
      description:
        'Records progress on an item the user is dealing with, e.g. "I requested the repair kit", "I stopped using it", "the kit arrived". Status is one of: ' + CASE_STATUSES.join(", ") + ". Can also add a free-text note.",
      inputSchema: {
        case: z.string().describe('The item, by nickname or id, e.g. "highchair".'),
        status: z.enum(CASE_STATUSES as [CaseStatus, ...CaseStatus[]]).optional().describe("New status."),
        note: z.string().optional().describe("Anything worth remembering, e.g. 'kit ordered, confirmation #123'."),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    async ({ case: ref, status, note }) => {
      const c = cases.find(ref);
      if (!c) return { content: text(`I don't have anything saved called "${ref}". Check the item first and give it a nickname.`), isError: true };
      if (status) c.status = status;
      if (note) c.notes.push({ at: new Date().toISOString(), text: note });
      cases.save(c);
      const v = caseView(c);
      return { content: text(`Updated "${c.nickname}": ${c.status.replace(/_/g, " ")}. ${v.nextStep}`), structuredContent: { kind: "case", case: v }, _meta: ui };
    },
  );

  server.registerTool(
    "get_case",
    {
      title: "Resume a saved item",
      description: 'Where things stand for a saved item, or all saved items when no name is given. Use for "where were we with the high chair?" or "what am I tracking?".',
      inputSchema: { case: z.string().optional().describe("Item nickname or id. Omit to list everything saved.") },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: ui,
    },
    async ({ case: ref }) => {
      if (!ref) {
        const all = cases.list().map(caseView);
        const spoken = all.length ? `You have ${all.length} saved: ${all.map((c) => `${c.nickname} (${c.status.replace(/_/g, " ")})`).join(", ")}.` : "You haven't saved anything yet.";
        return { content: text(spoken), structuredContent: { kind: "cases", cases: all }, _meta: ui };
      }
      const c = cases.find(ref);
      if (!c) return { content: text(`I don't have anything saved called "${ref}".`), isError: true };
      const v = caseView(c);
      const bits = [`${c.nickname}: ${c.status.replace(/_/g, " ")}.`];
      if (c.recallTitle) bits.push(`Recall: ${shortTitle(c.recallTitle)}.`);
      if (c.notes.length) bits.push(`Last note: ${c.notes.at(-1)!.text}.`);
      bits.push(v.nextStep);
      return { content: text(bits.join(" ")), structuredContent: { kind: "case", case: v }, _meta: ui };
    },
  );

  return server;
}
