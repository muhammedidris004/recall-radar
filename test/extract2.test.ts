import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDateCodeList, extractModelNames, extractModels, extractSerialRanges, listsIncomplete, serialInRanges } from "../src/extract.ts";

// Verbatim wording from real CPSC notices that the first extractor missed (found by auditing).

test("models: connective words before the first value", () => {
  const got = extractModels("The model numbers included in this recall are WL3520, WL4320 and WL3401. The model numbers are printed on the back panel of the monitor.");
  assert.deepEqual(got.sort(), ["WL3401", "WL3520", "WL4320"]);
});

test("models: product words between the label and the values", () => {
  const got = extractModels("with the following style numbers affected: Watch the Wear Bodysuit N8963LB N8963LG N8963LN N8964B1 N8964B2");
  for (const m of ["N8963LB", "N8963LG", "N8964B1"]) assert.ok(got.includes(m), `missing ${m}`);
});

test("models: a location sentence is not a list", () => {
  assert.deepEqual(extractModels("The model number is located on the lower right hand corner of the original package and the manufacturing date is on a sticker 2 inches wide"), []);
});

test("model names (words, not numbers)", () => {
  const a = extractModelNames("Graco and Century-branded strollers with model names Aspen, Breeze, Capri, Cirrus, Glider, Kite, LiteRider, Sierra, Solara, Sterling and TravelMate. All models are a single-occupant stroller");
  assert.deepEqual(a, ["Aspen", "Breeze", "Capri", "Cirrus", "Glider", "Kite", "LiteRider", "Sierra", "Solara", "Sterling", "TravelMate"]);
  const b = extractModelNames("crib mattresses with the following model names: SULTAN BLUNDA, SULTAN DRÖMMA and VYSSA VACKERT. The recalled mattresses");
  assert.deepEqual(b, ["SULTAN BLUNDA", "SULTAN DRÖMMA", "VYSSA VACKERT"]);
  assert.deepEqual(extractModelNames('sold under the Kenta and Kenta Plus model name. "VAUDE" is printed on the back'), []);
});

test("date code lists", () => {
  assert.deepEqual(extractDateCodeList("Manufacture date codes 0415 or 0515 are also printed on the tracking label.").codes, ["0415", "0515"]);
  assert.deepEqual(extractDateCodeList("Only rattles with date codes T0486, T1456, T2316, T2856 and T3065 located on a small triangle on the inner surface are included.").codes, ["T0486", "T1456", "T2316", "T2856", "T3065"]);
  assert.deepEqual(extractDateCodeList("The date code FAC-010635-16194 or FAC-010635-16015 is printed on a label sewn into the left side seam.").codes, ["FAC-010635-16194", "FAC-010635-16015"]);
  const f = extractDateCodeList("The manufacture date code represents the month and year in MMYY format and recalled units have the code: 0714, 0814, 0914, 1014, 1114 or 1214. The seats are about 13 inches wide");
  assert.deepEqual(f.codes, ["0714", "0814", "0914", "1014", "1114", "1214"]);
  assert.deepEqual(f.formats, ["MMYY"]);
});

test("date codes: ordinary dates are windows, not code lists", () => {
  assert.deepEqual(extractDateCodeList("with date codes 07/2025 or 08/2025 sold from September 2025 to October 2025.").codes, []);
});

test("serial ranges", () => {
  const r = extractSerialRanges("Strollers included in the recall have serial numbers from 19010 11153 00001 to 19010 51248 00215. Serial numbers are printed on a horizontal bar");
  assert.deepEqual(r, [{ from: "190101115300001", to: "190105124800215" }]);
  assert.equal(serialInRanges("19010 11153 00500", r), true);
  assert.equal(serialInRanges("19011 00000 00001", r), false);
  assert.equal(serialInRanges("ABC", r), null);
});

test("incomplete-list cues", () => {
  assert.equal(listsIncomplete("To see a complete list of item numbers included in this recall, visit the firm's website."), true);
  assert.equal(listsIncomplete("The following lamp styles are included"), true);
  assert.equal(listsIncomplete("The model numbers included in this recall are WL3520, WL4320 and WL3401."), false);
});
