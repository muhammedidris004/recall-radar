/** End-to-end scenarios against the real data snapshot. These are the stories the demo tells. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { RadarEngine } from "../src/engine.ts";

const engine = new RadarEngine();
const ids = (r: ReturnType<RadarEngine["check"]>["matches"], kind?: string) => r.filter((m) => !kind || m.kind === kind).map((m) => m.recall.id);

test("Peg Perego Tatamia: label made after the cutoff is confirmed", () => {
  const r = engine.check({ description: "high chair", brand: "Peg Perego", model: "IMTATANA01BL73", dateCode: "2023-02" });
  assert.equal(r.status, "CONFIRMED");
  assert.ok(ids(r.matches, "CONFIRMED").includes("cpsc:25706"));
});

test("Peg Perego Tatamia: same model made before the cutoff is ruled out, and not replaced by an unrelated ride-on toy", () => {
  const r = engine.check({ description: "high chair", brand: "Peg Perego", model: "IMTATANA01BL73", dateCode: "2021-11" });
  assert.notEqual(r.status, "CONFIRMED");
  assert.ok(r.excluded.some((v) => v.recall.id === "cpsc:25706"), "should explain why the Tatamia recall does not apply");
  assert.ok(!r.matches.some((m) => /ride-on/i.test(m.recall.title)), "ride-on vehicle recall must not surface for a high chair");
});

test("Peg Perego Tatamia: a different colour/model number is not covered", () => {
  const r = engine.check({ description: "high chair", brand: "Peg Perego", model: "IMTATANA01BL99", dateCode: "2023-02" });
  assert.notEqual(r.status, "CONFIRMED");
});

test("Bicystar: asks for the model, then confirms with it", () => {
  const partial = engine.check({ description: "high chair", brand: "Bicystar" });
  assert.equal(partial.status, "NEEDS_INFO");
  assert.match(partial.matches[0]!.missing.join(" "), /Model number/);
  const full = engine.check({ description: "high chair", brand: "Bicystar", model: "TB-HC6900" });
  assert.equal(full.status, "CONFIRMED");
});

test("car seat: NHTSA manufacture window is checked exactly", () => {
  const inside = engine.check({ description: "car seat", brand: "Graco", model: "SnugRide Turn & Slide", dateCode: "2026-01-15" });
  assert.equal(inside.status, "CONFIRMED");
  const outside = engine.check({ description: "car seat", brand: "Graco", model: "SnugRide Turn & Slide", dateCode: "2022-05-01" });
  assert.notEqual(outside.status, "CONFIRMED");
});

test("car seat: a short recalled name does not match a longer, different model name", () => {
  // The 2014 "SNUGRIDE" recall is not the same product as "SnugRide Turn & Slide".
  const r = engine.check({ description: "car seat", brand: "Graco", model: "SnugRide Turn & Slide", dateCode: "2022-05-01" });
  assert.ok(!ids(r.matches, "CONFIRMED").some((id) => id.startsWith("nhtsa:14C004000")));
});

test("unknown product returns NO_MATCH with honest coverage, never 'safe'", () => {
  const r = engine.check({ description: "wooden rocking horse", brand: "Acme Heirloom" });
  assert.equal(r.status, "NO_MATCH");
  assert.ok(r.coverage.recallsChecked > 1000);
  assert.match(r.coverage.dataThrough, /^\d{4}-\d{2}-\d{2}$/);
});

test("fast enough for a voice host (well under the 500 ms budget)", () => {
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) engine.check({ description: "stroller", brand: "Graco", model: "X" + i });
  assert.ok((performance.now() - t0) / 20 < 50, "mean check latency should be < 50 ms");
});

test("car seat described in plain words: multi-word model name matches without a separate model field", () => {
  const r = engine.check({ description: "Graco SnugRide Turn & Slide car seat", brand: "Graco", dateCode: "2026-01-15" });
  assert.equal(r.status, "CONFIRMED");
});

test("car seat described only as 'Graco SnugRide': asks for more, does not confirm a dateless record", () => {
  const r = engine.check({ description: "Graco SnugRide car seat", brand: "Graco" });
  assert.notEqual(r.status, "CONFIRMED");
});

// ---- extraction-hardening scenarios (found by auditing real notices) ----

const kindOf = (r: ReturnType<RadarEngine["check"]>) => (r.matches[0] ?? r.excluded[0])?.kind;

test("model list behind connective words: Lorex monitor WL3520 confirmed, WL9999 ruled out with the listed models", () => {
  assert.equal(engine.check({ description: "Lorex baby monitor", model: "WL3520" }).status, "CONFIRMED");
  const r = engine.check({ description: "Lorex baby monitor", model: "WL9999" });
  assert.equal(r.status, "NO_MATCH");
  assert.equal(kindOf(r), "EXCLUDED");
});

test("model names: Graco Aspen stroller needs the date; an unlisted name is not confirmed", () => {
  const a = engine.check({ description: "Graco Aspen stroller" });
  assert.equal(a.status, "NEEDS_INFO");
  assert.match(a.matches[0]!.missing.join(" "), /Date of manufacture/);
  assert.notEqual(engine.check({ description: "Graco Nimbus stroller" }).status, "CONFIRMED");
});

test("date-code list: April 2015 matches code 0415; June 2016 does not", () => {
  const base = { description: "Golden Horse children denim pants", model: "4392185" };
  assert.equal(engine.check({ ...base, dateCode: "April 2015" }).status, "CONFIRMED");
  assert.notEqual(engine.check({ ...base, dateCode: "June 2016" }).status, "CONFIRMED");
});

test("serial range: Bugaboo Cameleon3 serial inside the range is confirmed, outside is not", () => {
  assert.equal(engine.check({ description: "Bugaboo Cameleon3 stroller", serial: "19010 11153 00500" }).status, "CONFIRMED");
  assert.notEqual(engine.check({ description: "Bugaboo Cameleon3 stroller", serial: "19011 00000 00001" }).status, "CONFIRMED");
});

test("SAFE-CLEAR GUARD: a notice that points to a fuller list never rules a model out", () => {
  const risky = engine.dataset.recalls.filter((r) => r.source === "CPSC" && r.conditions.listsIncomplete && r.conditions.models.length > 0);
  assert.ok(risky.length >= 10, "expected a meaningful number of incomplete-list recalls in the data");
  for (const r of risky.slice(0, 25)) {
    const res = engine.check({ description: r.productNames[0] || r.title, brand: r.brand, model: "NOPE-0000" });
    const wrongly = res.excluded.some((v) => v.recall.id === r.id);
    assert.equal(wrongly, false, `${r.id} (${r.brand}) was ruled out although its notice refers to a fuller list`);
  }
});

// ---- on-screen comparison table (criteria) ----

test("criteria: the ruled-out Peg Perego chair shows exactly which requirement failed", () => {
  const r = engine.check({ description: "Peg Perego Tatamia high chair", model: "IMTATANA01BL73", dateCode: "2021-11" });
  const v = r.excluded.find((x) => x.recall.id === "cpsc:25706")!;
  const by = Object.fromEntries(v.criteria.map((c) => [c.key, c.state]));
  assert.equal(by.product, "match");
  assert.equal(by.model, "match");
  assert.equal(by.made, "mismatch");
});

test("criteria: unknown requirements are shown as unknown, not as matches", () => {
  const v = engine.check({ description: "Peg Perego Tatamia high chair" }).matches[0]!;
  const by = Object.fromEntries(v.criteria.map((c) => [c.key, c.state]));
  assert.equal(by.model, "unknown");
  assert.equal(by.made, "unknown");
});
