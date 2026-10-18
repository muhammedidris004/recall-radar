import { test } from "node:test";
import assert from "node:assert/strict";
import { extractBatches, extractMfgWindow, extractModels, extractSold } from "../src/extract.ts";

// Fixtures are verbatim excerpts from real CPSC notices (2012–2026).

test("model: labelled single value", () => {
  assert.deepEqual(extractModels('"BICYSTAR" is printed on the front of the tray and "Model No.: TB-HC6900" on a label stitched to the back'), ["TB-HC6900"]);
  assert.deepEqual(extractModels('"Model No: MY002" and "Date of manufacturer: 2026/1/10" are printed on a label'), ["MY002"]);
  assert.deepEqual(extractModels("sold in \"Ice\" (gray) color with model number IMTATANA01BL73. The top of the padded"), ["IMTATANA01BL73"]);
});

test("model: lists with commas / and", () => {
  const got = extractModels("The bassinets have the following model numbers: 10632, 10639, 10832, 10835, 10839 and BT021. The model number is located under the mattress");
  for (const m of ["10632", "10639", "10832", "10835", "10839", "BT021"]) assert.ok(got.includes(m), `missing ${m} in ${got}`);
});

test("model: suffix variants and 'or' lists", () => {
  const got = extractModels("Model number 3C00BPN, 3C00BPN TC, 3C00CHY, 3C00CHY TC, 3C00CPO or 3C00CPO TC is printed on a label");
  for (const m of ["3C00BPN", "3C00CHY", "3C00CPO"]) assert.ok(got.includes(m), `missing ${m} in ${got}`);
});

test("model: quoted model/style number", () => {
  assert.ok(extractModels('Bistro high chairs with model/style number "255" which is printed on a tag').includes("255"));
});

test("model: does not invent models from prose", () => {
  assert.deepEqual(extractModels("The model name and number are printed on the label. The recalled swings were sold in blue."), []);
  assert.deepEqual(extractModels("sold in 2024 and model year 2019 vehicles"), []);
});

test("mfg window: 'between X and Y' with inherited year", () => {
  const w = extractMfgWindow("City Versa strollers manufactured between May 15 and August 20, 2012. The date of manufacture is printed");
  assert.equal(w.from, "2012-05-15");
  assert.equal(w.to, "2012-08-20");
});

test("mfg window: month ranges", () => {
  const w = extractMfgWindow("Guava Roam strollers manufactured between July 2020 and December 2021. They are first generation");
  assert.equal(w.from, "2020-07-01");
  assert.equal(w.to, "2021-12-31");
});

test("mfg window: 'on or after'", () => {
  const w = extractMfgWindow("Only products manufactured on or after June 23, 2022, and/or purchased after that are included.");
  assert.equal(w.from, "2022-06-23");
  assert.equal(w.to, undefined);
});

test("mfg window: date codes, and a sold clause is not a manufacture window", () => {
  const w = extractMfgWindow("Magellan Odyssey Rocker Chairs with date codes 07/2025 or 08/2025 sold from September 2025 to October 2025. The recalled chairs were sold in charcoal");
  assert.equal(w.from, "2025-07-01");
  assert.equal(w.to, "2025-08-31");
});

test("mfg window: printed 'date of manufacturer'", () => {
  const w = extractMfgWindow('"Model No: MY002" and "Date of manufacturer: 2026/1/10" are printed on a label on the back');
  assert.equal(w.from, "2026-01-10");
});

test("mfg window: dashed date codes", () => {
  const w = extractMfgWindow("The affected spoons have the following date codes: the three-pack 2024-01 and the four-pack have 2023-12 to 2024-05 printed on the back");
  assert.equal(w.from, "2023-12-01");
  assert.equal(w.to, "2024-05-31");
});

test("batches", () => {
  assert.deepEqual(extractBatches('"Production Batch: 202509" is printed on a tracking label'), ["202509"]);
  assert.ok(extractBatches("Only booster seats with batch numbers 3111, 7819, 7822 and 7831 and model number TOD1058").includes("7819"));
});

test("sold window and channel", () => {
  const s = extractSold(["Sold Online At:\nAmazon.com from March 2023 to July 2026 for between $18 and $30."]);
  assert.equal(s.from, "2023-03-01");
  assert.equal(s.to, "2026-07-31");
  assert.deepEqual(s.channels, ["Amazon"]);
  const t = extractSold(["Online at Amazon.com from September 1, 2025 through September 30, 2025 for about $76."]);
  assert.equal(t.from, "2025-09-01");
  assert.equal(t.to, "2025-09-30");
  const u = extractSold(["Sold Online At: Amazon.com in April 2026 for between $40 and $50."]);
  assert.equal(u.from, "2026-04-01");
  assert.equal(u.to, "2026-04-30");
});

test("model: filler words before a quoted value", () => {
  assert.ok(extractModels('The model/style number included in the recall is "432" which is printed on a label on the frame of the swing.').includes("432"));
});

test("model: a date is not a model number", () => {
  assert.deepEqual(extractModels("Model number 04/2013 is printed on the rattle"), []);
});

test("model: sizes and pack counts are not models", () => {
  assert.deepEqual(extractModels("The product is packaged in 10mL, 30mL, and 50mL sizes. Part of a 3-pack gift set."), []);
  assert.deepEqual(extractModels("Carrier-branded 1.5-ton multi-zone units"), []);
  assert.ok(extractModels("part number 87150 is printed on the box").includes("87150"));
});
