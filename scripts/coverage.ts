/** Reports how much structure the extractor recovers from the real data. */
import { loadDataset } from "../src/ingest.ts";
const ds = loadDataset();
const cpsc = ds.recalls.filter((r) => r.source === "CPSC");
const pct = (n: number, d = cpsc.length) => `${n} (${((100 * n) / d).toFixed(0)}%)`;
const hard = (r: (typeof cpsc)[number]) =>
  r.conditions.models.length > 0 || r.conditions.modelNames.length > 0 || Boolean(r.conditions.mfgFrom || r.conditions.mfgTo) ||
  r.conditions.batches.length > 0 || (r.conditions.dateCodeList?.length ?? 0) > 0 || (r.conditions.serialRanges?.length ?? 0) > 0;
const has = {
  models: cpsc.filter((r) => r.conditions.models.length).length,
  window: cpsc.filter((r) => r.conditions.mfgFrom || r.conditions.mfgTo).length,
  batches: cpsc.filter((r) => r.conditions.batches.length).length,
  sold: cpsc.filter((r) => r.conditions.soldFrom).length,
  none: cpsc.filter((r) => !hard(r)).length,
  anyId: cpsc.filter(hard).length,
  codes: cpsc.filter((r) => (r.conditions.dateCodeList?.length ?? 0) > 0).length,
  serials: cpsc.filter((r) => (r.conditions.serialRanges?.length ?? 0) > 0).length,
  names: cpsc.filter((r) => r.conditions.modelNames.length > 0).length,
  incomplete: cpsc.filter((r) => r.conditions.listsIncomplete).length,
  images: cpsc.filter((r) => r.images.length).length,
};
console.log(`CPSC baby/children's recalls: ${cpsc.length}`);
console.log(`  model numbers extracted:        ${pct(has.models)}`);
console.log(`  manufacture window extracted:   ${pct(has.window)}`);
console.log(`  batch/lot codes extracted:      ${pct(has.batches)}`);
console.log(`  date-code lists extracted:      ${pct(has.codes)}`);
console.log(`  serial ranges extracted:        ${pct(has.serials)}`);
console.log(`  model names extracted:          ${pct(has.names)}`);
console.log(`  flagged 'list may be incomplete':${pct(has.incomplete)}`);
console.log(`  at least one hard identifier:   ${pct(has.anyId)}`);
console.log(`  NO identifier (appearance only):${pct(has.none)}`);
console.log(`  sold-at window extracted:       ${pct(has.sold)}`);
console.log(`  has reference photos:           ${pct(has.images)}`);
const nh = ds.recalls.filter((r) => r.source === "NHTSA");
console.log(`NHTSA child-seat records: ${nh.length}, with structured manufacture window: ${nh.filter((r) => r.conditions.mfgFrom).length}`);
console.log(`data through ${ds.dataThrough}`);
if (process.argv.includes("--sample")) {
  const none = cpsc.filter((r) => !hard(r));
  for (const r of none.slice(0, 12)) console.log("\n-", r.title.slice(0, 90), "\n ", r.description.slice(0, 300));
}
