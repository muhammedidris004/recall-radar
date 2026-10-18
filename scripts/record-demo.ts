/**
 * Records the demo video: drives the simulator in Chrome at human typing speed, timed to the shot windows in
 * docs/DEMO_SCRIPT.md, captures it with Chrome's screencast, and adds narration with macOS `say`.
 *
 *   npm run record                      → recordings/recall-radar-demo.mp4 (dark theme, voice "Samantha")
 *   npm run record -- --scheme light    → light theme
 *   npm run record -- --no-audio        → silent screen capture (record your own voice-over)
 *   npm run record -- --no-audio --captions → silent, with the narration burned in as captions
 *   npm run record -- --name my-take.mp4  → output file name inside recordings/
 *   npm run record -- --voice Daniel --rate 165
 *
 * Needs: Google Chrome, ffmpeg + ffprobe, macOS `say` (omit with --no-audio).
 */
import { chromium } from "playwright-core";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] ?? d : d; };
const flag = (n: string) => process.argv.includes(`--${n}`);
const SCHEME = (arg("scheme", "dark") as "dark" | "light");
const VOICE = arg("voice", "Samantha")!;
const RATE = Number(arg("rate", "168"));
const AUDIO = !flag("no-audio");
const CAPTIONS = flag("captions");
const NAME = arg("name", AUDIO ? "recall-radar-demo.mp4" : CAPTIONS ? "recall-radar-demo-captions.mp4" : "recall-radar-demo-clean.mp4")!;
const PORT = 3344;
const W = 1920, H = 1080, END = 170; // seconds
const out = join(root, "recordings");
const work = join(out, ".work");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- narration, straight from the script table ----------
const md = readFileSync(join(root, "docs", "DEMO_SCRIPT.md"), "utf8");
const narration: Record<number, string> = {};
for (const line of md.split("\n")) {
  const m = line.match(/^\| \*\*(\d)\*\* \|/);
  if (!m) continue;
  const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  narration[Number(m[1])] = cells[cells.length - 1]!.replace(/[*“”"`]/g, "").replace(/\s+/g, " ");
}

// ---------- the timeline (seconds from start). Shot starts mirror the script table. ----------
const L = {
  one: "I'm buying a used Peg Perego Tatamia high chair. Can you check it for recalls?",
  two: "The label says Model No: IMTATANA01BL73, made in February 2023",
  refund: "I requested the refund",
  resume: "Where were we with the high chair?",
  friend: "My friend's Peg Perego Tatamia high chair is the same model, made in November 2021",
  seat: "Check a Graco SnugRide Turn & Slide car seat made January 2026",
};
const START = { 0: 0, 1: 15, 2: 35, 3: 65, 4: 90, 5: 115, 6: 135, 7: 158 } as const;

// ---------- server ----------
let server: ChildProcess | undefined;
async function startServer() {
  server = spawn(process.execPath, ["--import", "tsx", "src/http.ts"], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("server did not start");
}

function card(html: string): string {
  const dark = SCHEME === "dark";
  const c = dark ? { bg: "#12110f", ink: "#f3efe7", mute: "#a8a196", acc: "#4fd0ec", line: "#34312b", panel: "#1c1a17" } : { bg: "#f6f4ee", ink: "#1a1917", mute: "#66615a", acc: "#0a8fb0", line: "#dedacd", panel: "#ffffff" };
  return `<!doctype html><meta charset=utf-8><style>*{box-sizing:border-box}html,body{margin:0;height:100%;background:${c.bg};color:${c.ink};font:28px/1.45 -apple-system,"SF Pro Text",system-ui,sans-serif}
  body{display:grid;place-items:center;padding:60px}.w{max-width:1500px;width:100%}h1{font-size:76px;letter-spacing:-.03em;margin:0 0 10px}h2{font-size:44px;letter-spacing:-.02em;margin:0 0 24px}
  p{margin:10px 0;color:${c.mute}}.big{font-size:118px;font-weight:700;letter-spacing:-.04em;color:${c.acc};line-height:1;white-space:nowrap}.url{display:inline-block;margin-top:30px;padding:16px 30px;border:2px solid ${c.line};border-radius:18px;background:${c.panel};font:600 40px ui-monospace,Menlo,monospace;color:${c.ink}}
  pre{background:${c.panel};border:1px solid ${c.line};border-radius:20px;padding:26px 32px;font:26px/1.5 ui-monospace,Menlo,monospace;margin:0}.row{display:grid;grid-template-columns:1fr 1.5fr;gap:50px;align-items:center}.tag{font-size:22px;letter-spacing:.1em;text-transform:uppercase;color:${c.acc};font-weight:700;margin-bottom:14px}</style>${html}`;
}


let currentCap = "";
const CAP_CSS = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:1560px;width:max-content;z-index:2147483647;background:rgba(10,10,10,.82);color:#fff;font:600 32px/1.3 -apple-system,'SF Pro Text',system-ui,sans-serif;padding:12px 26px;border-radius:16px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35)";
async function applyCap(page: import("playwright-core").Page, text: string) {
  currentCap = text;
  if (!CAPTIONS) return;
  try {
    await page.evaluate(([t, css]) => {
      let e = document.getElementById("__cap");
      if (!e) { e = document.createElement("div"); e.id = "__cap"; e.style.cssText = css as string; document.body.append(e); }
      e.textContent = t as string; (e as HTMLElement).style.display = t ? "block" : "none";
    }, [text, CAP_CSS]);
  } catch { /* page is mid-navigation; the next call re-applies */ }
}
/** Splits a shot's narration into sentence-sized captions timed at ~155 words per minute. */
function captionPlan(): { at: number; text: string }[] {
  const plan: { at: number; text: string }[] = [];
  for (const [shot, text] of Object.entries(narration)) {
    let t = START[Number(shot) as keyof typeof START] + 0.5;
    for (const sentence of text.split(/(?<=[.!?:])\s+/)) {
      const words = sentence.split(/\s+/).length;
      plan.push({ at: t, text: sentence });
      t += Math.max(1.8, (words / 155) * 60 + 0.35);
    }
    plan.push({ at: t, text: "" }); // clear after the last sentence of the shot
  }
  return plan;
}

async function main() {
  await startServer();
  await fetch(`http://127.0.0.1:${PORT}/api/reset-cases`, { method: "POST" });

  // narration clips
  const clips: { shot: number; file: string; dur: number }[] = [];
  if (AUDIO) {
    for (const [shot, text] of Object.entries(narration)) {
      const file = join(work, `n${shot}.aiff`);
      execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", file, "--", text]);
      const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
      clips.push({ shot: Number(shot), file, dur });
    }
    const next = (s: number) => (s === 7 ? END : START[(s + 1) as keyof typeof START]);
    for (const c of clips) {
      const room = next(c.shot) - START[c.shot as keyof typeof START] - 0.5;
      console.log(`shot ${c.shot}: narration ${c.dur.toFixed(1)}s in ${room.toFixed(1)}s ${c.dur > room ? "  <-- TOO LONG" : ""}`);
    }
  }

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: SCHEME });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => document.getElementById("conn")?.textContent?.startsWith("connected"));
  await page.evaluate(() => { document.getElementById("chat")!.textContent = ""; });
  await sleep(800);

  // screencast
  const frames: { t: number; file: string }[] = [];
  const cdp = await context.newCDPSession(page);
  let n = 0;
  cdp.on("Page.screencastFrame", (f: any) => {
    const file = join(work, `f${String(++n).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ t: f.metadata.timestamp, file });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const t0 = Date.now() / 1000;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  const now = () => Date.now() / 1000 - t0;
  if (CAPTIONS) for (const c of captionPlan()) setTimeout(() => applyCap(page, c.text), Math.max(0, c.at * 1000 - (Date.now() - t0 * 1000)));
  const until = async (s: number) => { const d = (s - now()) * 1000; if (d > 0) await sleep(d); else if (d < -1500) console.warn(`  running ${(-d / 1000).toFixed(1)}s behind at t=${s}`); };

  async function say(text: string) {
    const before = await page.locator(".msg.bot").count();
    await page.click("#input");
    await page.keyboard.type(text, { delay: 26 });
    await sleep(450);
    await page.keyboard.press("Enter");
    await page.waitForFunction((b) => document.querySelectorAll(".msg.bot").length > b && !document.querySelector(".typing"), before, { timeout: 20000 });
  }

  const results = readFileSync(join(root, "docs", "results.txt"), "utf8");
  const bench = results.split("\n").filter((l) => /^[A-K]  .*\d%\s*$/.test(l)).join("\n");

  await until(START[1]); await say(L.one);
  await until(START[2]); await say(L.two);
  await until(START[3]); await say(L.refund);
  await until(START[3] + 11); await say(L.resume);
  await until(START[4]); await say(L.friend);
  await until(START[5]); await say(L.seat);
  await until(START[6] + 0.8); await page.click("#drawerBtn"); await sleep(1500);
  await page.evaluate(() => { const l = document.getElementById("log")!; l.scrollTop = l.scrollHeight; });
  await until(START[6] + 8);
  await page.setContent(card(`<div class="w"><div class="row"><div><div class="tag">Tested against its own mistakes</div><div class="big">0 / 1,924</div><p>wrongly confirmed recalls across deliberately wrong inputs: typos, decoy models, wrong dates.</p><p>If a notice points to a longer list, it never clears a product.</p></div><pre>${bench.replace(/</g, "&lt;")}</pre></div></div>`));
  await applyCap(page, currentCap);
  await until(START[7]);
  await page.setContent(card(`<div class="w"><div class="tag">Alexa+ track · Amazon Developer Hackathon</div><h1>Recall Radar</h1><h2>Real government data. Honest answers. Open source.</h2><p>An MCP server (Streamable HTTP) that checks baby gear against official CPSC and NHTSA recalls, shows its reasoning, and tracks the fix.</p><div class="url">github.com/muhammedidris004/recall-radar</div><p style="margin-top:34px;font-size:22px">The Alexa+ host is simulated: Alexa+ add-on tooling is partner-only.</p></div>`));
  await applyCap(page, currentCap);
  await until(END);

  await cdp.send("Page.stopScreencast");
  const endT = Date.now() / 1000;
  await browser.close();
  await fetch(`http://127.0.0.1:${PORT}/api/reset-cases`, { method: "POST" }).catch(() => {});
  server?.kill();

  // ---------- assemble ----------
  if (frames.length < 2) throw new Error("no frames captured");
  frames[0]!.t = Math.min(frames[0]!.t, t0 + 0.001); // video starts at t0
  const lines: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const nextT = i + 1 < frames.length ? frames[i + 1]!.t : endT;
    lines.push(`file '${frames[i]!.file}'`, `duration ${Math.max(0.001, nextT - frames[i]!.t).toFixed(4)}`);
  }
  lines.push(`file '${frames.at(-1)!.file}'`);
  writeFileSync(join(work, "list.txt"), lines.join("\n"));
  const silent = join(work, "video.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-vf", `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-t", String(END), silent]);

  const final = join(out, NAME);
  if (AUDIO) {
    const inputs = clips.flatMap((c) => ["-i", c.file]);
    const delays = clips.map((c, i) => { const ms = Math.round((START[c.shot as keyof typeof START] + 0.5) * 1000); return `[${i + 1}:a]adelay=${ms}|${ms},volume=1.0[a${i}]`; });
    const mix = `${delays.join(";")};${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,apad[aout]`;
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, ...inputs, "-filter_complex", mix, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", String(END), final]);
  } else {
    execFileSync("cp", [silent, final]);
  }
  rmSync(work, { recursive: true, force: true });
  console.log(`\nSaved ${final}`);
}

main().catch((e) => { console.error(e); server?.kill(); process.exit(1); });
