/**
 * Builds the offline data snapshots from the official public sources.
 *
 *   data/cpsc.json   — CPSC recalls (baby / children's products), trimmed to the fields we use
 *   data/nhtsa.json  — NHTSA child-restraint recalls (structured make / model / manufacture window)
 *
 * Usage: npm run sync [-- --since=2015]
 * Needs `curl` and `unzip` on PATH (NHTSA ships a 15 MB zip of a 300 MB flat file; we stream it).
 */
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isBabyGear } from "../src/scope.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const since = Number(process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? 2012);
mkdirSync(join(root, "data"), { recursive: true });
mkdirSync(join(root, ".cache"), { recursive: true });

async function syncCpsc() {
  const kept: unknown[] = [];
  let total = 0;
  const thisYear = new Date().getFullYear();
  for (let y = since; y <= thisYear; y++) {
    const url = `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${y}-01-01&RecallDateEnd=${y}-12-31`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`CPSC ${y}: HTTP ${res.status}`);
    const rows = (await res.json()) as any[];
    total += rows.length;
    for (const r of rows) {
      const names = (r.Products ?? []).map((p: any) => p.Name).join(" ");
      if (!isBabyGear(`${r.Title} ${names}`)) continue;
      kept.push({
        RecallNumber: r.RecallNumber,
        RecallDate: String(r.RecallDate).slice(0, 10),
        Title: r.Title,
        Description: r.Description,
        URL: r.URL,
        ConsumerContact: r.ConsumerContact,
        Products: (r.Products ?? []).map((p: any) => ({
          Name: p.Name,
          Description: p.Description,
          Model: p.Model,
          Type: p.Type,
          NumberOfUnits: p.NumberOfUnits,
        })),
        Hazards: (r.Hazards ?? []).map((h: any) => ({ Name: h.Name })),
        Remedies: (r.Remedies ?? []).map((m: any) => ({ Name: m.Name })),
        RemedyOptions: (r.RemedyOptions ?? []).map((o: any) => ({ Option: o.Option })),
        Retailers: (r.Retailers ?? []).map((x: any) => ({ Name: x.Name })),
        Manufacturers: (r.Manufacturers ?? []).map((x: any) => ({ Name: x.Name })),
        Importers: (r.Importers ?? []).map((x: any) => ({ Name: x.Name })),
        Distributors: (r.Distributors ?? []).map((x: any) => ({ Name: x.Name })),
        Injuries: (r.Injuries ?? []).map((x: any) => ({ Name: x.Name })),
        Images: (r.Images ?? []).map((i: any) => ({ URL: i.URL, Caption: i.Caption })),
      });
    }
    console.log(`CPSC ${y}: ${rows.length} recalls`);
  }
  writeFileSync(join(root, "data", "cpsc.json"), JSON.stringify(kept));
  console.log(`CPSC: kept ${kept.length} of ${total} baby/children's recalls since ${since}`);
}

async function syncNhtsa() {
  const zip = join(root, ".cache", "nhtsa.zip");
  if (!existsSync(zip)) {
    console.log("NHTSA: downloading flat file…");
    execFileSync("curl", ["-sSf", "-m", "300", "-o", zip, "https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip"]);
  }
  const unzip = spawn("unzip", ["-p", zip], { stdio: ["ignore", "pipe", "inherit"] });
  const rl = createInterface({ input: unzip.stdout.setEncoding("latin1") });
  const out: unknown[] = [];
  const minDate = `${since}0101`;
  for await (const line of rl) {
    const f = line.split("\t");
    if (f.length < 22) continue;
    const type = f[10];
    const comp = (f[6] ?? "").toUpperCase();
    const isSeat = type === "C" || (type === "E" && /CHILD (SEAT|RESTRAINT)/.test(comp));
    if (!isSeat || (f[15] ?? "") < minDate) continue;
    out.push({
      campaign: f[1],
      make: f[2],
      model: f[3],
      year: f[4],
      component: f[6],
      manufacturer: f[7],
      mfgBegin: f[8],
      mfgEnd: f[9],
      units: f[11],
      received: f[15],
      defect: f[19],
      consequence: f[20],
      remedy: f[21],
      notes: f[22],
    });
  }
  writeFileSync(join(root, "data", "nhtsa.json"), JSON.stringify(out));
  console.log(`NHTSA: kept ${out.length} child-restraint model rows since ${since}`);
}

await syncCpsc();
await syncNhtsa();
