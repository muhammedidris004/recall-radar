/** Drives the real MCP server through an in-memory MCP client: the way an AI assistant uses it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";
import { RadarEngine } from "../src/engine.ts";
import { MemoryCaseStore } from "../src/cases.ts";

const engine = new RadarEngine();

async function session() {
  const cases = new MemoryCaseStore();
  const server = createServer({ engine, cases });
  const client = new Client({ name: "test-assistant", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })).structuredContent as any;
  return { call, cases, close: () => client.close() };
}

test("REGRESSION (found by a real AI assistant): a different item never inherits another item's model number", async () => {
  const s = await session();
  try {
    const first = await s.call("check_item", { description: "Peg Perego Tatamia high chair", model: "IMTATANA01BL73", date_code: "2023-02", nickname: "neighbour high chair" });
    assert.equal(first.status, "CONFIRMED");
    // fuzzy-similar nickname, different brand: must be a NEW case and must not see the Peg Perego model
    const second = await s.call("check_item", { brand: "Bicystar", description: "high chair", nickname: "highchair" });
    assert.notEqual(second.status, "CONFIRMED", "stale model number leaked into an unrelated check");
    assert.ok(!second.matches.some((m: any) => /Peg Perego/i.test(m.title)), "unrelated recall surfaced");
    assert.equal(second.matches[0]?.recallId, "cpsc:26290"); // the Bicystar recall
    assert.equal(s.cases.list().length, 2);
  } finally { await s.close(); }
});

test("the same item under the same name still accumulates details across calls (the demo flow)", async () => {
  const s = await session();
  try {
    const a = await s.call("check_item", { description: "Peg Perego Tatamia high chair", nickname: "high chair" });
    assert.equal(a.status, "NEEDS_INFO");
    const b = await s.call("check_label", { label_text: "Model No: IMTATANA01BL73, made in February 2023", description: "Peg Perego Tatamia high chair", nickname: "high chair" });
    assert.equal(b.status, "CONFIRMED");
    assert.equal(s.cases.list().length, 1);
    // later correction on the same item keeps the model and re-judges the date
    const c = await s.call("check_label", { label_text: "made in November 2021", description: "Peg Perego Tatamia high chair", nickname: "high chair" });
    assert.notEqual(c.status, "CONFIRMED");
    assert.equal(s.cases.list().length, 1);
  } finally { await s.close(); }
});

test("two different items with the same nickname become two cases with distinct names", async () => {
  const s = await session();
  try {
    await s.call("check_item", { description: "Graco stroller", nickname: "baby gear" });
    await s.call("check_item", { description: "Britax car seat", nickname: "baby gear" });
    const names = s.cases.list().map((c) => c.nickname);
    assert.equal(names.length, 2);
    assert.notEqual(names[0], names[1]);
  } finally { await s.close(); }
});

test("resume still works by a casual name", async () => {
  const s = await session();
  try {
    await s.call("check_item", { description: "Peg Perego Tatamia high chair", model: "IMTATANA01BL73", date_code: "2023-02", nickname: "neighbour high chair" });
    const got = await s.call("get_case", { case: "the high chair" });
    assert.equal(got.case.nickname, "neighbour high chair");
    const upd = await s.call("update_case", { case: "high chair", status: "remedy_requested", note: "kit ordered" });
    assert.equal(upd.case.status, "remedy_requested");
  } finally { await s.close(); }
});
