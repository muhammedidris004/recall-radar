import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLabel } from "../src/label.ts";
import { MemoryCaseStore, newCase } from "../src/cases.ts";

test("label: typical high chair sticker", () => {
  const f = parseLabel("GRACO\nModel No: 1969721\nDate of Manufacture: 2018-03-14\nMade in China");
  assert.equal(f.brand, "Graco");
  assert.equal(f.model, "1969721");
  assert.equal(f.dateCode, "2018-03-14");
});

test("label: DOM with two-digit year, single line", () => {
  const f = parseLabel("Evenflo MODEL: 34911423 DOM 03/19 LOT# AB12345");
  assert.equal(f.model, "34911423");
  assert.equal(f.dateCode, "03/2019");
  assert.equal(f.batch, "AB12345");
});

test("label: OCR confuses O and 0 inside numeric model", () => {
  const f = parseLabel("Model No: 1O69721");
  assert.equal(f.model, "1069721");
});

test("label: reports what it could not read", () => {
  const f = parseLabel("Keep away from fire\nModel: TB-HC6900");
  assert.equal(f.model, "TB-HC6900");
  assert.ok(f.unread.includes("Keep away from fire"));
});

test("cases: find by casual name", () => {
  const s = new MemoryCaseStore();
  s.save(newCase("used highchair", { brand: "Graco", description: "high chair" }));
  s.save(newCase("grandma's crib", { description: "crib" }));
  assert.equal(s.find("the highchair")?.nickname, "used highchair");
  assert.equal(s.find("crib")?.nickname, "grandma's crib");
  assert.equal(s.find("toaster"), undefined);
});

test("label: 'made in <Month Year>' phrasing", () => {
  assert.equal(parseLabel("Model No: IMTATANA01BL73, made in February 2023").dateCode, "February 2023");
  assert.equal(parseLabel("it was made in November 2021").dateCode, "November 2021");
});

test("label: keywords only count as whole words (found when 'SnugRide' parsed as serial 'ugRide')", () => {
  const f = parseLabel("Graco SnugRide Turn & Slide car seat made January 2026");
  assert.equal(f.serial, undefined);
  assert.equal(f.brand, "Graco");
  assert.equal(f.dateCode, "January 2026");
  assert.equal(parseLabel("a modern wooden chair").model, undefined);
  assert.equal(parseLabel("baby lotion warmer").batch, undefined);
  assert.equal(parseLabel("catalog of domestic items").model, undefined);
  assert.equal(parseLabel("Serial No: 19010 11153 00500").serial, "19010 11153 00500");
});

test("label: brands match on word boundaries", () => {
  assert.equal(parseLabel("Nunavut stroller").brand, undefined);
  assert.equal(parseLabel("Peg Perego Tatamia").brand, "Peg Perego");
  assert.equal(parseLabel("SAFETY 1ST Model: 22145").brand, "Safety 1st");
});
