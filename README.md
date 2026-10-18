# Recall Radar

**Check the baby gear you buy, borrow or inherit — and get walked through the official fix.**

Recall Radar is an [MCP](https://modelcontextprotocol.io) server (Streamable HTTP, spec 2025-11-25) built for an Alexa+-style voice and screen assistant. A parent says *"I'm buying a used Peg Perego high chair, can you check it for recalls?"*. Recall Radar works out what it needs to know (usually the model number and date on the label), reads the label from a typed line, a spoken line or a **photo**, decides whether a recall applies, shows *how it decided*, and then tracks the remedy until it's done.

> Built for the [Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/), **Alexa+ track**.
> Alexa+ add-on tooling is partner-only, so the demo runs through a **simulated Alexa+ host** included in this repo (a real MCP client and MCP Apps host). Nothing in this repo is Amazon software. See [Simulation](#simulation).

## Why it's built the way it is (the research)

Most "recall checker" demos look up a product name and show a list. That fails in practice, so before writing the matcher I measured the real data (`scripts/coverage.ts`, `docs/results.txt`):

| Finding | Evidence | Design consequence |
|---|---|---|
| CPSC's structured `Model` field is **always empty** | 0% of 2,045 recalls since 2021 | Model numbers, date codes and batches are extracted from the notice **prose** (`src/extract.ts`), tested on real wording |
| Only **49%** of baby-product notices contain any hard identifier; **51%** describe the product only by appearance and where it was sold | `npm run coverage` | The answer is **tiered and honest**: `CONFIRMED`, `NEEDS_INFO`, `COMPARE_APPEARANCE`, `EXCLUDED`, or no match. It never claims certainty it doesn't have. |
| Car seats are the biggest baby-gear category, but CPSC doesn't cover them. **NHTSA does**, with **structured** make, model and manufacture begin/end dates | NHTSA flat file `FLAT_RCL_POST_2010` | A second source, matched **exactly** (date-in-window is checked in code) |
| 100% of notices include reference photos; 53% of captions describe the label | CPSC `Images` | When a detail is missing, the app shows *the recalled product's own label photo* so you know where to look |
| Notices are written for humans: model lists behind phrases like "included in this recall are…", date codes printed as codes (`0415`), model *names* ("Aspen, Breeze…"), serial ranges, and flattened tables | audit of notices where identifiers were visibly present but not extracted | The extractor handles each of those classes (`src/extract.ts`), and a notice that points elsewhere for its full list is **flagged**, so a missing model is never read as an all-clear |
| Recalls are often sold only in a window ("Amazon, Mar 2023 to Jul 2026") | `Retailers` | Used as soft evidence only: secondhand units can be older than the sales window |
| NHTSA publishes some **inverted dates** (begin after end, e.g. campaign `26C006000`) | found while testing | Such windows are flagged and never trusted; the user is told to confirm with the source |
| The recall web pages block scripted access (HTTP 403) | tried it | We rely on the API text and link out to the official page for the remedy |

### What makes the matching trustworthy

- **Language models may help *read*; code decides.** The verdict compares explicit values: normalised model strings, parsed date spans, batch codes. Every verdict carries an **evidence list** (`✓ Model matches`, `✕ Made Nov 2021, outside the window on or after June 23, 2022`).
- **Near misses are caught.** A one-character slip in a model number is reported as "very close to X, re-read the label", never silently accepted.
- **Different-but-similar products are *ruled out with a reason*.** "SnugRide" ≠ "SnugRide Turn & Slide"; one chair colour/model number ≠ another.
- **A list that points elsewhere never clears a product.** 59 baby-product notices say things like "visit the firm's website for the complete list". For those, an unlisted model becomes *"check the full list"*, not *"not recalled"*. This guard is measured (benchmark case J): **with it disabled, 29 of 36 such recalls were wrongly ruled out; with it, 0.**
- **No "safe" claims.** No match is reported as no match, with coverage (how many recalls, which years, data-through date) and a pointer to cpsc.gov / nhtsa.gov.

## Results (self-generating benchmark)

`npm run bench` builds test cases from the real recalls (no hand-labelled set), then probes the engine, including deliberately wrong inputs:

```
A  full label -> CONFIRMED                            409/409   100.0%
B  model withheld -> never CONFIRMED                  409/409   100.0%
C  model typo -> not CONFIRMED                        409/409   100.0%
D  decoy model -> not CONFIRMED                       409/409   100.0%
E  date outside window -> not CONFIRMED                56/56    100.0%
F  brand+product only -> found in top 8               407/409    99.5%
G  car seat, date in window -> CONFIRMED               58/58    100.0%
H  car seat, date outside window -> not CONFIRMED      58/58    100.0%
I  no-identifier recall -> never CONFIRMED            538/538   100.0%
J  incomplete list + unlisted model -> never EXCLUDED  36/36    100.0%
K  date code not in list -> not CONFIRMED               9/9     100.0%
False-confirm rate across guard cases: 0/1924
```

**Read these numbers honestly.** The benchmark is generated from the same extractor it tests, so it proves the *decision logic* is consistent and guarded. It does **not** prove extraction recall on notices we haven't seen. So we also audit by hand, and every finding became a test:

- 30 random extractions checked by eye: about 26 fully correct; the 3 false positives (unit sizes like "10mL" read as models) were fixed.
- A second audit of notices that *visibly* name identifiers the extractor missed found 5 classes (connective words, date codes, model names, serial ranges, tables), now handled; one bug there was a regex that left a stray "s" after "numbers".
- Hand-testing real stories found three bugs the benchmark could not: an unrelated toy recall outranking a high chair, an old car-seat recall over-confirmed by a name that was merely a prefix, and the label parser reading "SnugRide" as serial "ugRide".

`test/scenarios.test.ts` pins those stories on the real data. Extraction coverage is in `docs/results.txt`: hard identifiers for 49% of notices (models 40%, manufacture windows 10%, batch codes 6%, date-code lists 4%, serial ranges 1%). For the other 51% the best the app can do is `COMPARE_APPEARANCE`.

Latency: a full check takes **3–15 ms** locally (Alexa+ add-ons have a 500 ms round-trip budget).

## Quick start

Requires Node 22+ (developed on 24). Optional: `tesseract` for label-photo OCR (`brew install tesseract`).

```bash
npm install
npm start            # MCP server + simulator on http://127.0.0.1:3333
npm test             # 54 tests, incl. real end-to-end scenarios
npm run bench        # generated benchmark
npm run sync         # refresh the CPSC + NHTSA snapshots (data/*.json)
```

Open <http://127.0.0.1:3333/> and use the suggested prompts, or type.

The repo ships with a snapshot of the data (1,028 baby/children's CPSC recalls and 177 NHTSA child-seat records, 2012 to Oct 2026, both U.S. public-domain government data), so it runs offline. `npm run sync` rebuilds it from the live sources.

### Use it from any MCP client

```bash
claude mcp add --transport http recall-radar http://127.0.0.1:3333/mcp
```

(Or any client that speaks Streamable HTTP. The server is stateless and answers with JSON.)

## Tools

Few, outcome-oriented tools, each answering a whole intent, with a speakable `headline` and a `nextQuestion` so an agentic host can keep the conversation moving.

| Tool | Use | Notes |
|---|---|---|
| `check_item` | "Is this used high chair recalled?" | Works with partial info; optional `nickname` saves a **case** |
| `check_label` | "Model No 1969721, made March 2018" / OCR text from a photo | Extracts brand, model, date, batch; reports what it couldn't read |
| `get_recall` | "What do I do about it?" | Hazard, official remedy, contact, photos |
| `update_case` | "I requested the repair kit" | Tracks recalled, stopped using, fix requested, fix done |
| `get_case` | "Where were we with the high chair?" | Resume across sessions (JSON file store in `data/cases.json`) |

Results include `structuredContent` plus an **MCP App** (`ui://recall-radar/result`, `_meta.ui.resourceUri`) designed for an Echo Show read at arm's length, in one 1280×800 screen with no scrolling for the key facts:

- a large **status hero** (recalled / one more detail / compare by eye / no match / not covered). Colours never use "green = safe": a ruled-out item is neutral, because other recalls may still exist;
- a **comparison table**, the centrepiece: for each requirement (model, date made, date code, batch, serial) what the recall says vs. what you told me, with ✓ / ✕ / ≈ / ? states, so the reason for a verdict is visible at a glance;
- the recalled product's own **label photo** ("where to look"), the **official fix** and contact, and a **progress timeline** for tracking the remedy;
- dark/light themes, 52px touch targets, focus rings, reduced-motion support, and a loading skeleton via `ui/notifications/tool-input`.

## Simulation

The hackathon FAQ states that the Alexa+ MCP toolkit, CLI and web simulator are available to select partners only, and that a web page acting as a real MCP client is the accepted path. `simulator/` is exactly that:

- a **real MCP client**: `initialize` (declaring protocol `2025-03-26`, as Alexa+'s client does), `tools/list`, `resources/read`, `tools/call` over Streamable HTTP;
- an **MCP Apps host**: renders the `ui://` resource in a sandboxed iframe (`allow-scripts` only) and bridges JSON-RPC over `postMessage`, including the app calling tools back (`update_case`);
- a thin **rule-based "Alexa"** that routes utterances to tools. It is deliberately small; all recall logic lives in the server, so a real LLM host would replace only this router;
- voice in/out via the browser's Web Speech API, label-photo upload via local Tesseract OCR, and a live protocol drawer ("Under the hood") with the 500 ms latency budget;
- **▶ Play demo** types and runs the whole story hands-free (for recording), and **Reset** clears the conversation and saved items.

### The reusable part: `mcp-apps-sim`
The simulator's generic half (an MCP client, an MCP Apps host, pre-flight checks and tool forms) is published as its own open-source project, usable with **any** MCP server: **https://github.com/muhammedidris004/mcp-apps-sim**. For example, to run its pre-flight checks and app renderer against this server:

```bash
npm start                                          # Recall Radar on :3333
npx github:muhammedidris004/mcp-apps-sim http://127.0.0.1:3333/mcp
```

## Architecture

```
simulator/ (MCP client + MCP Apps host)         any MCP client (Alexa+, Claude, …)
        │  Streamable HTTP  POST /mcp                    │
        ▼                                                ▼
src/http.ts ──► src/server.ts (5 tools + ui:// resource)
                  ├─ src/label.ts     label text → brand/model/date/batch   (+ Tesseract OCR route)
                  ├─ src/engine.ts    search → assess → rank → coverage
                  │    ├─ src/search.ts   BM25 + synonyms + brand/type gates + model-number boost
                  │    └─ src/verdict.ts  evidence-based decision (model, date window, batch, retail context)
                  ├─ src/cases.ts     case memory (resume / track the remedy)
                  └─ src/ingest.ts ► src/extract.ts   prose → structured conditions (CPSC), structured (NHTSA)
data/cpsc.json, data/nhtsa.json  (from scripts/sync-data.ts)
```

## Limits (what this does not do)

- **Pull, not push.** It answers when asked. As far as the Alexa+ docs we could access say, an add-on can't make Alexa speak up unprompted, so "your toaster was just recalled" isn't possible.
- **U.S. data only** (CPSC, NHTSA). Not Health Canada, EU Safety Gate, or FDA food/drug.
- **Not exhaustive.** Recalls without model numbers can only be matched by appearance. Some notices list models on the manufacturer's site; we can't see those. "No match" is never "safe".
- **Rule-based extraction.** An LLM could cover the long tail of phrasing; `ConditionExtractor` in `src/extract.ts` is the seam for that. Not implemented, because it would add cost and make results less auditable.
- **OCR quality** depends on the photo. It's local Tesseract; for hard labels the user can read the details aloud.
- Alexa+ certification rules (privacy policy, no children's data, etc.) were reviewed but not exercised, since the add-on can't be submitted from outside the partner program.

## Layout

```
src/        server, engine, extraction, label parser, case store, MCP App (src/ui/result.html)
simulator/  MCP client + MCP Apps host (open source mini-challenge deliverable: reusable test harness)
test/       unit + end-to-end scenario tests
bench/      generated benchmark
scripts/    sync-data.ts, coverage.ts
docs/       results.txt, DEMO_SCRIPT.md, FRICTION_LOG.md
```

## License

MIT. Recall data is from U.S. government sources (CPSC, NHTSA) and is public domain; always confirm with the official notices.
