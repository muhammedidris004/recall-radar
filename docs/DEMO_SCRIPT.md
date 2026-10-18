# Demo video: shot-by-shot script (target 2:50, hard limit 3:00)

Judges are not required to watch past 3:00, so the **best material is in the first 35 seconds** and the video finishes at about 2:50 to leave a safety margin. Every line below was run against the live app and produces the result described.

## Before you record (5 minutes)

1. `npm start`, open <http://127.0.0.1:3333/>, press **Reset**. Leave **Under the hood** closed until shot 6.
2. Browser window about 1440×900, zoom 100–110%, no bookmarks bar, notifications off (Do Not Disturb). Use one colour scheme the whole time.
3. Keep this file open on a second screen. For the typed lines, **copy them from the "Type" column**; do not retype them live. (The numbered prompts in the left panel are the same lines: click them if you prefer.)
4. Record screen and microphone together (QuickTime: File → New Screen Recording). Use a quiet room and speak at about 150 words per minute; the narration below is about 270 words (roughly 110 seconds of speech), which leaves time for each screen to be read.
5. Do a full rehearsal first. If a take goes wrong, **Reset** and start the shot again.
6. Don't use music or third-party footage. Export 1080p, upload to YouTube as **Public**, English title.

## The shots

| # | Time | On screen | You type / click | Narration (say this) |
|---|---|---|---|---|
| **0** | 0:00–0:15 | Simulator, idle Echo Show (clock). | nothing | "Recalled baby gear keeps getting resold and handed down. The government publishes the data, but half of the notices never name a model number. So searching by name fails. Recall Radar works like a careful friend." |
| **1** | 0:15–0:35 | Amber **One more detail needed** hero. Reference label photo under *Where to look*. | Type: `I'm buying a used Peg Perego Tatamia high chair. Can you check it for recalls?` | "I'm buying a used high chair. Alexa doesn't guess: it finds the Peg Perego Tatamia recall and asks for the one detail that decides it. And it shows me the recalled chair's own label, so I know where to look." |
| **2** | 0:35–1:05 | Red **This is recalled**. Point at the comparison table: green ✓ on Model and on Made. Then the green **Official fix** box. | Type: `The label says Model No: IMTATANA01BL73, made in February 2023` | "I read the label. Now it's confirmed, and here's how: the model matches, and the date is inside the recalled window, on or after June 23, 2022. Every check is visible. The official fix is a refund, with the contact right here." |
| **3** | 1:05–1:30 | Timeline fills to **Fix requested**, then the resumed saved item. | Type: `I requested the refund` then `Where were we with the high chair?` | "I ask for the refund and Alexa tracks it. Tomorrow I can say 'where were we?' and it picks up exactly where I left off." |
| **4** | 1:30–1:55 | Neutral **Not covered by that recall**. **Made** row is **red** against the window. | Type: `My friend's Peg Perego Tatamia high chair is the same model, made in November 2021` | "Now the part that matters. A friend offers the same chair: same model, made November 2021. It is *not* covered, and the red row shows why: it was made before the cutoff. Precision, not panic." |
| **5** | 1:55–2:15 | Red recalled car seat; table shows **Made: December 2025 to March 27, 2026**. | Type: `Check a Graco SnugRide Turn & Slide car seat made January 2026` | "Car seats come from a different agency, NHTSA, with exact manufacture dates, so this one is matched to the day." |
| **6** | 2:15–2:38 | Click **Under the hood**: the protocol log, response times in green. Then cut to the README results block or `docs/results.txt`. | Click **Under the hood**, scroll the log. | "It's a real MCP server, over Streamable HTTP. Each answer takes a few milliseconds, against Alexa+'s 500-millisecond budget. And it's tested against its own mistakes: zero wrongly confirmed recalls in over nineteen hundred deliberately wrong inputs. If a notice points to a longer list, it never clears a product." |
| **7** | 2:38–2:50 | Title card or the GitHub repo page: `github.com/muhammedidris004/recall-radar`. | nothing | "Real government data, honest answers, open source. The Alexa+ host here is simulated, because that tooling is partner-only. Recall Radar." |

## Timing guide

- Shots 0 to 2 are the hook: a judge who stops at 1:05 has already seen the problem, the question-asking, and the proof.
- Typing is fast in the app, but you should **let each screen sit for 2–3 seconds** while you speak; the narration timings above assume that.
- If you run long, cut shot 3's second line ("Where were we…") first, then shorten shot 5. Never cut shot 4: it's the clearest proof of precision.

## Honesty lines (keep these)

- Say the Alexa+ host is **simulated** (shot 7). The hackathon FAQ says the Alexa+ tooling is partner-only and that a web page acting as a real MCP client is the accepted route.
- Don't say "safe". The app never does. The closest you say is "not covered by that recall".
- If asked what it can't do: it answers when asked (no push alerts), US data only, and about half of notices name no model, so those can only be compared by appearance.

## YouTube details

- **Title:** Recall Radar: check used baby gear against official recalls (Alexa+ MCP, Amazon Developer Hackathon)
- **Description:** one paragraph from the README, the repo link, and "Built for the Amazon Developer Hackathon, Alexa+ track. The Alexa+ host is simulated."
- **Visibility:** Public. **Language:** English. Add captions (auto-captions, then fix "Peg Perego" and "NHTSA").

## Fallbacks

- A screen renders blank right after loading: wait one second, it's a paint delay; or press **Reset** and redo that shot.
- A prompt gives a different answer than expected: check you pressed **Reset** first (saved items carry over between takes).
- **▶ Play demo** runs shots 1 to 5 hands-free in about 40 seconds. Use it for a quick take, then speak the narration over it as a voice-over.
