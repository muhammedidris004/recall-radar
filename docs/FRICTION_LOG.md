# Friction log

Real friction hit while researching and building this entry (Oct 18, 2026). The hackathon rules say useful friction logs can earn a judging bonus, so each entry has: the task, what was expected vs. what happened, severity, workaround, and a suggestion. Nothing here is hypothetical.

Severity: **critical** blocks the task, **high** costs hours or forces a redesign, **medium** costs minutes, **low** is polish.

---

### 1. Alexa+ tooling access contradicts the Resources page — **critical**
- **Task:** Plan an Alexa+ submission using the add-on CLI and web simulator.
- **Steps:** Read the Devpost Resources page → Alexa+ docs quickstart (`mcp-toolkit-quickstart`) → `alexa-ai configure`.
- **Expected:** An Alexa developer account is enough (what the quickstart says).
- **Actual:** The Devpost FAQ says the MCP Toolkit, CLI and Web Simulator are in preview and **select partners only**, with no way to apply. The quickstart page doesn't mention this; the FAQ says it's only called out on the docs *home* page.
- **Workaround:** Built a self-hosted MCP server plus our own MCP client/MCP Apps host.
- **Suggestion:** Put a gating banner at the top of every Alexa+ add-on doc page, and on the hackathon's Resources page. I had written a plan around the CLI before finding this.

### 2. The quickstart omits the CLI install command — **medium**
- **Task:** Install the Alexa AI CLI from the quickstart.
- **Expected:** An install command.
- **Actual:** "Download and install the Alexa AI CLI" with no command; you're sent to the dev-environment guide.
- **Suggestion:** One copy-pasteable install line in the quickstart.

### 3. Alexa+ MCP client protocol version vs. the required spec — **medium**
- **Task:** Make the server compatible with Alexa+'s MCP client.
- **Actual:** The hackathon requires spec **2025-11-25** (Streamable HTTP), but the lifecycle doc shows Alexa+'s client sending `initialize` with `protocolVersion: "2025-03-26"`.
- **Workaround:** The server negotiates down; a raw JSON-RPC smoke test with `protocolVersion: "2025-03-26"` initialized successfully and returned `2025-03-26`.
- **Suggestion:** State the version the client actually sends and which spec features (e.g. elicitation, MCP Apps) apply at that version.

### 4. Web simulator docs don't say whether MCP Apps render — **medium**
- **Task:** Check that a `ui://` MCP App renders in the simulator.
- **Actual:** The page describes a Visual Preview for Echo Show sizes but never mentions MCP Apps, so I couldn't confirm whether the custom UI is shown.
- **Suggestion:** Document MCP Apps support (and `ui/*` host methods supported) in the simulator page.

### 5. Doc index file is missing — **low**
- **Task:** Discover all Alexa+ pages programmatically. Each page says "Fetch the complete documentation index at /docs/llms.txt".
- **Actual:** `https://developer.amazon.com/docs/llms.txt` returned HTTP 404.
- **Suggestion:** Publish the index or remove the line. Several guessed page URLs 404'd too; I had to read the sidebar links to find real ones.

### 6. Devpost pages return 403 to non-browser clients — **low**
- **Task:** Read the rules, FAQ and dates with a script/fetch tool.
- **Actual:** HTTP 403 for plain HTTP fetches; works in a real browser.
- **Workaround:** Used a browser. **Suggestion:** none for Amazon; noting for other builders using agents.

### 7. Credits messaging is inconsistent — **medium**
- **Actual:** The Resources page says credit codes ran out on Oct 7; the FAQ still describes a $150 per-person credit.
- **Impact:** A zero-budget entrant can't tell whether AWS Builder is reachable.
- **Suggestion:** Update the FAQ, and state a free-tier path for the AWS Builder mini challenge.

### 8. Deadline shown in an unusual timezone — **low**
- **Actual:** Deadline reads "Oct 24, 2026 @ 12:30am GMT+5:30". It is easy to be off by a day for non-IST entrants (it is Oct 23, 19:00 UTC).
- **Suggestion:** Also show UTC.

### 9. CPSC API: the `Model` field is empty for every recall — **high** (public data, not an Amazon tool)
- **Task:** Match a user's model number against recalls.
- **Expected:** `Products[].Model` populated. **Actual:** empty in all 2,045 recalls since 2021; model numbers, date codes and batches exist only in free text. About 52% of baby-product notices contain no identifier at all.
- **Workaround:** Prose extraction (`src/extract.ts`) with tiered verdicts.
- **Suggestion (for the data publishers):** structured `Model`, `DateCodeRange` and `Batch` fields.

### 10. NHTSA flat file contains inverted manufacture dates — **medium** (public data)
- **Actual:** Campaign `26C006000` lists manufacture begin 2026-08-20, end 2020-11-13.
- **Workaround:** Detect and refuse to trust inverted windows; tell the user to confirm with the source.
