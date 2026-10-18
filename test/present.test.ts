import { test } from "node:test";
import assert from "node:assert/strict";
import { firstSentence, shortTitle } from "../src/present.ts";

test("shortTitle makes real CPSC titles speakable", () => {
  assert.equal(shortTitle("Bicystar High Chairs Recalled Due to Risk of Serious Injury or Death from Fall and Entrapment Hazards; Violates Mandatory Standard for High Chairs"), "Bicystar High Chairs");
  assert.equal(shortTitle("Graco Recalls Table2Table High Chairs Due to Fall Hazard"), "Graco Table2Table High Chairs");
  assert.equal(shortTitle("Guava Family Recalls Roam Strollers Due to Fall and Injury Hazards"), "Guava Family Roam Strollers");
});

test("firstSentence keeps whole thoughts", () => {
  assert.equal(firstSentence("The high chairs violate the standard. In addition, a head can become trapped."), "The high chairs violate the standard.");
});

import { brandFromTitle } from "../src/ingest.ts";
test("brandFromTitle handles both title shapes", () => {
  assert.equal(brandFromTitle("Graco Recalls Table2Table High Chairs Due to Fall Hazard"), "Graco");
  assert.equal(brandFromTitle("Bicystar High Chairs Recalled Due to Risk of Serious Injury"), "Bicystar");
  assert.equal(brandFromTitle("Summer Infant Recalls Baby Bathers Due to Drowning Hazard"), "Summer Infant");
  assert.equal(brandFromTitle("Peg Perego Recalls Tatamia 3-in-1 Recliners"), "Peg Perego");
  assert.equal(brandFromTitle("ONTHEWEI Recalls Baby Bath Seats Due to Risk"), "ONTHEWEI");
});
