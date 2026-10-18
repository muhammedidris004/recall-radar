/** Case memory: the thing that lets a parent come back and ask "where were we with the highchair?". */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { ItemQuery } from "./types.ts";
import { tokenize } from "./text.ts";

export type CaseStatus =
  | "checking" // we're still collecting label details
  | "recalled" // a recall applies; no action yet
  | "stopped_using"
  | "remedy_requested" // repair kit / refund / replacement asked for
  | "remedy_completed"
  | "cleared" // checked, no recall applies (as of the check date)
  | "disposed";

export const CASE_STATUSES: CaseStatus[] = ["checking", "recalled", "stopped_using", "remedy_requested", "remedy_completed", "cleared", "disposed"];

export interface CaseNote {
  at: string;
  text: string;
}

export interface Case {
  id: string;
  nickname: string;
  createdAt: string;
  updatedAt: string;
  item: ItemQuery;
  status: CaseStatus;
  /** Recall that applies (or is being tracked), if any. */
  recallId?: string;
  recallTitle?: string;
  remedyUrl?: string;
  /** What the last check concluded, so we can say it again without re-running. */
  lastCheck?: { at: string; status: string; headline: string; dataThrough: string };
  notes: CaseNote[];
}

export interface CaseStore {
  list(): Case[];
  get(id: string): Case | undefined;
  /** Finds a case by id or by a casual name ("the highchair"). */
  find(ref: string): Case | undefined;
  save(c: Case): Case;
  /** Removes everything (used by the demo reset). */
  clear(): void;
}

export function newCase(nickname: string, item: ItemQuery): Case {
  const now = new Date().toISOString();
  return { id: randomUUID().slice(0, 8), nickname, createdAt: now, updatedAt: now, item, status: "checking", notes: [] };
}

function findIn(cases: Case[], ref: string): Case | undefined {
  const exact = cases.find((c) => c.id === ref);
  if (exact) return exact;
  const q = new Set(tokenize(ref));
  if (!q.size) return undefined;
  let best: { c: Case; score: number } | undefined;
  for (const c of cases) {
    const t = new Set(tokenize(`${c.nickname} ${c.item.brand ?? ""} ${c.item.description ?? ""}`));
    let hit = 0;
    for (const x of q) if (t.has(x)) hit++;
    const score = hit / q.size;
    if (score > 0 && (!best || score > best.score || (score === best.score && c.updatedAt > best.c.updatedAt))) best = { c, score };
  }
  return best && best.score >= 0.5 ? best.c : undefined;
}

export class MemoryCaseStore implements CaseStore {
  protected cases: Case[] = [];
  list() { return [...this.cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string) { return this.cases.find((c) => c.id === id); }
  clear() { this.cases = []; }
  find(ref: string) { return findIn(this.list(), ref); }
  save(c: Case) {
    c.updatedAt = new Date().toISOString();
    const i = this.cases.findIndex((x) => x.id === c.id);
    if (i >= 0) this.cases[i] = c; else this.cases.push(c);
    return c;
  }
}

const defaultFile = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "cases.json");

/** JSON-file store: no database to install, survives restarts, easy for judges to inspect. */
export class FileCaseStore extends MemoryCaseStore {
  constructor(private file = defaultFile) {
    super();
    if (existsSync(file)) {
      try { this.cases = JSON.parse(readFileSync(file, "utf8")) as Case[]; } catch { this.cases = []; }
    }
  }
  override clear() {
    super.clear();
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, "[]");
  }
  override save(c: Case) {
    const out = super.save(c);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cases, null, 2));
    renameSync(tmp, this.file);
    return out;
  }
}
