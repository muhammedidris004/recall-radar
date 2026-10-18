# Tested with a real AI assistant

The hackathon FAQ calls "showing an existing AI assistant app calling the same server" a nice bonus. So, besides our own simulator, we connected **Claude Code** (a real AI assistant that speaks MCP) to Recall Radar and gave it plain-English requests, with **no hint about which tool to use**.

## How to reproduce

```bash
npm start                                   # Recall Radar on http://127.0.0.1:3333/mcp
echo '{ "mcpServers": { "recall-radar": { "type": "http", "url": "http://127.0.0.1:3333/mcp" } } }' > mcp.json
claude -p "I'm looking at a used Bicystar high chair at a garage sale. Is it recalled?" \
  --mcp-config mcp.json --strict-mcp-config --tools "" --allowedTools "mcp__recall-radar__*"
```

(Or add it permanently: `claude mcp add --transport http recall-radar http://127.0.0.1:3333/mcp`.) Built-in tools were disabled, so the assistant can only use Recall Radar.

## What it showed

- The assistant **discovered and chose the right tool on its own**, and filled the arguments from natural language: brand, model, manufacture date as `2021-11`, where the item came from, and a nickname for the saved case.
- Its answers were **faithful to the server**: it kept the caveat that "not covered by this recall" is not a safety guarantee, and it told the parent exactly what to do for the confirmed recall, then saved the case with `update_case`.
- When information was missing, it **asked for the exact detail** the server named (the model number on the label).
- **It found a real bug** (below).

## The bug the assistant found

In the first batch of runs, scenario 3 ran after scenarios 1 and 2 had saved cases called "neighbour high chair" and "highchair". The assistant asked about a *Bicystar* chair under the nickname "highchair". The server matched that nickname *fuzzily* to the earlier case and merged the earlier item's model number into the new check, so it returned **CONFIRMED for a Peg Perego recall the user never asked about**. The assistant noticed the mismatch and told the user not to trust it, but the server should never have produced it.

**Before the fix** (the assistant's own words, verbatim):

> I need to flag something odd here before giving you an answer: the tool's "CONFIRMED" result matched this to a **Peg Perego Tatamia** recall, using a model number (`IMTATANA01BL73`) I never gave it — that's a different brand/product than what you described, and it also returned under an existing case nickname ("neighbour high chair") instead of the new one I created. That looks like it pulled in stale/unrelated data rather than info from your actual item, so I wouldn't trust that match.

**The fix:** a saved item is reused only for an *exact* nickname match **and** when the new check could be the same item (same brand and product type). A different item never inherits another item's details; if two different items share a name, the second gets a distinct name ("highchair (Bicystar)"). Pinned by 4 new tests that drive the server through an in-memory MCP client (`test/server.test.ts`), one of which is this exact scenario.

**After the fix** (same three prompts, same order, below): scenario 3 returns `NEEDS_INFO` for the Bicystar recall under its own case, and asks for the label's model number.

## The runs after the fix

### Scenario 1: a unit made before the recall window

**Prompt (as a parent would say it):**
> I'm about to buy a used Peg Perego Tatamia high chair for my baby from a neighbour. The label on the back says Model No: IMTATANA01BL73, made in November 2021. Is it recalled? Please remember it as 'neighbour high chair'.

**Assistant says:**
> I'll check this high chair against the recall database.

**Assistant calls** `check_item` **with**
```json
{
  "brand": "Peg Perego",
  "model": "IMTATANA01BL73",
  "description": "Tatamia high chair",
  "date_code": "2021-11",
  "bought_where": "neighbour (used)",
  "nickname": "neighbour high chair"
}
```
**Server returns:** status `NO_MATCH` · top recall: Peg Perego Recalls Tatamia 3-in-1 Recliners, Swings and High Chairs Due to Risk  · case: "neighbour high chair"

**Assistant says:**
> Good news: **no match** for your specific unit. I've saved it as "neighbour high chair."
> 
> Here's what I found: the exact same model number (IMTATANA01BL73) **is** named in a June 2025 CPSC recall of the Peg Perego Tatamia 3-in-1 (suffocation risk — it was marketed for infant sleep with too steep an incline, and failed high-chair warning-label requirements). However, that recall only covers units **made on or after June 23, 2022**. Your neighbour's chair was made in **November 2021**, so it falls outside the recalled window and isn't covered.
> 
> A few things worth doing anyway:
> - Double-check the date code on the label yourself — recalls like this hinge entirely on manufacture date, so make sure you're not misreading "2021" for "2022" or similar.
> - This recall data is current as of 2026-10-15, per CPSC/NHTSA public records — not a guarantee the product is otherwise safe, just that it's not part of this specific recall.
> - Only use it as a high chair (not as a recliner/sleeper), since that's the mode this recall was actually about regardless of date.
> 
> Want me to pull the full recall details (remedy/contact info) in case you want to compare your neighbour's label photo against CPSC's reference image?

<sub>2 turns, 11.5 s, $0.024 · model reported by the CLI: `claude-sonnet-5`</sub>

### Scenario 2: a confirmed recall, and what to do about it

**Prompt (as a parent would say it):**
> My sister gave me her Peg Perego Tatamia high chair. The label says Model No: IMTATANA01BL73, made in February 2023. Is it recalled, and if so what exactly should I do about it?

**Assistant says:**
> Checking that model and date against recall data now.

**Assistant calls** `check_item` **with**
```json
{
  "brand": "Peg Perego",
  "model": "IMTATANA01BL73",
  "date_code": "2023-02",
  "description": "Tatamia high chair",
  "bought_where": "handed down from sister",
  "nickname": "highchair"
}
```
**Server returns:** status `CONFIRMED` · top recall: Peg Perego Recalls Tatamia 3-in-1 Recliners, Swings and High Chairs Due to Risk  · case: "highchair"

**Assistant says:**
> Yes — this exact unit is recalled. Here's what's going on and what to do:
> 
> **Why it's recalled:** The Tatamia 3-in-1 (recliner/swing/high chair) was marketed for infant sleep, but its incline angle exceeds 10°, violating federal infant sleep safety standards — that's a suffocation risk. It also doesn't meet warning-label requirements for high chairs. No injuries reported so far, but ~950 units are affected, and yours (model IMTATANA01BL73, made Feb 2023) is confirmed on the list.
> 
> **What to do:**
> 1. **Stop using it immediately** — don't use it in recliner, swing, or high chair mode.
> 2. **Contact Peg Perego for a full refund:**
>    - Phone: 877-737-3464 (M–F, 9am–5pm ET)
>    - Email: service@pegperego.com
>    - Online: pegperego.com/en_us/baby/recalls
> 3. They'll send a prepaid shipping label and box to return the unit.
> 
> I'll mark this case as recalled so you can track it. Want me to update the status once you've contacted Peg Perego or requested the remedy?

**Assistant calls** `update_case` **with**
```json
{
  "case": "highchair",
  "status": "recalled",
  "note": "Confirmed recall cpsc:25706. User needs to stop use and contact Peg Perego (877-737-3464) for refund/return."
}
```
**Server returns:** status `recalled` · case: "highchair"

**Assistant says:**
> Saved — I'll track this under "highchair." Just let me know once you've requested the refund or it arrives, and I can update the status.

<sub>3 turns, 14.7 s, $0.033 · model reported by the CLI: `claude-sonnet-5`</sub>

### Scenario 3: partial information (this is the one that exposed the bug)

**Prompt (as a parent would say it):**
> I'm looking at a used Bicystar high chair at a garage sale. Is it recalled?

**Assistant says:**
> Let me check that for you.

**Assistant calls** `check_item` **with**
```json
{
  "brand": "Bicystar",
  "description": "used high chair",
  "bought_where": "garage sale",
  "nickname": "highchair"
}
```
**Server returns:** status `NEEDS_INFO` · top recall: Bicystar High Chairs Recalled Due to Risk of Serious Injury or Death from Fall a · case: "highchair (Bicystar)"

**Assistant says:**
> There is a real recall for Bicystar high chairs (CPSC #26290, Feb 2026) — missing crotch restraint plus an entrapment hazard between seat and side. I need one more detail to confirm if this specific chair is it.
> 
> Can you check the label stitched to the back of the seat cover for **"Model No.: TB-HC6900"**? That's the exact model recalled. If it matches that model number, it's affected.
> 
> If it's a match: the hazard is a fall/entrapment risk, and the remedy is a full refund — not a repair kit. You'd need to stop using it, disassemble it, cut the restraints/fabric, write "Recall" on the backseat, photograph it, and email those photos to bicystarhighchair@outlook.com for the refund. Given that remedy process, I'd lean toward not buying it at the garage sale unless the seller is clearly offloading it before doing that themselves.

<sub>2 turns, 9.8 s, $0.020 · model reported by the CLI: `claude-sonnet-5`</sub>


## Honest notes

- Each run is one headless `claude -p` call (model as reported by the CLI above, about 10 to 15 seconds and 2 to 4 cents). Results can vary between runs; the transcripts above are the actual outputs of one run each.
- The assistant has its own judgement and its own wording, which is the point: the server returns well-shaped data and a speakable headline, and the host decides how to say it.
- This is not Alexa+. It shows the server works with a real MCP-speaking assistant; it says nothing about Alexa+'s own language understanding.
