# 3-minute demo script

Run `npm start`, open http://127.0.0.1:3333/ and press **Reset**. Screen-record the browser. Either speak the lines in **bold** (🎤), click the numbered prompts, or press **▶ Play demo** to run the whole story hands-free (about 40 seconds, so narrate over it or pause between steps). Open **Under the hood** to show the protocol log and the 500 ms budget.

**0:00–0:20 — The problem (voice-over, simulator closed)**
"Recalled baby gear is still sold secondhand and handed down. The government publishes the data, but the model-number field is empty in every CPSC record, and half of the notices name no model at all. So 'search the name' doesn't work. Recall Radar does what a careful friend would: asks for the one detail that matters, and tells you *why* it decided."

**0:20–1:00 — Describe → ask for the right detail**
- **"I'm buying a used Peg Perego Tatamia high chair. Can you check it for recalls?"**
- Point at: amber banner "one detail needed", the reference label photos ("where to look"), and the log: 3–15 ms vs Alexa+'s 500 ms budget.

**1:00–1:40 — Verify with evidence**
- **"The label says Model No: IMTATANA01BL73, made in February 2023."**
- Point at: red "This is recalled", the ✓ evidence list (model named, date inside "on or after June 23, 2022"), official fix box. Click **Open the official recall page**.

**1:40–2:10 — The precision moment**
- **"Actually, I got the date wrong, it was made in November 2021."**
- Point at: it's now **ruled out, with the reason** (outside the window). Then upload a blurry/unreadable label photo (📷) to show it asks instead of guessing.

**2:10–2:40 — Follow through and resume**
- **"I requested the refund."** → progress steps update.
- Reload the page (state is saved by the server), then: **"Where were we with the high chair?"**

**2:40–2:55 — Cars seats and honesty**
- **"Check a Graco SnugRide Turn & Slide car seat made January 2026."** → exact match from NHTSA's structured dates.
- Show `docs/results.txt`: "0 false confirms across 1,855 guard cases", and say what it does *not* prove.

**2:55–3:00 — Close**
"Real MCP server, real government data, honest answers. Open source, MIT."

Notes for recording: don't use third-party music or footage; say that the Alexa+ host is simulated because Alexa+ add-on tooling is partner-only.
