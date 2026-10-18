// Alexa+ simulator for Recall Radar.
//  - MCP client: speaks Streamable HTTP JSON-RPC to /mcp (initialize → tools/list → tools/call, resources/read)
//  - MCP Apps host: renders the server's ui:// resource in a sandboxed iframe and relays tool input/results to it
//  - "Alexa" brain: a tiny rule-based router (what a real host's LLM would do), kept deliberately thin so that
//    all recall logic lives in the MCP server.

const MCP_URL = "/mcp";
const $ = (s) => document.querySelector(s);
const chat = $("#chat"), logEl = $("#log"), input = $("#input"), conn = $("#conn"), bezel = $("#bezel");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- MCP client
let rpcId = 0;
async function rpc(method, params, { notify = false } = {}) {
  const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++rpcId, method, params };
  const t0 = performance.now();
  const res = await fetch(MCP_URL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
  const ms = Math.round(performance.now() - t0);
  if (notify) { logEntry(method, body, null, ms, "notification"); return null; }
  let msg;
  const ct = res.headers.get("content-type") || "";
  const txt = await res.text();
  if (ct.includes("text/event-stream")) {
    const line = txt.split("\n").find((l) => l.startsWith("data:"));
    msg = JSON.parse(line.slice(5));
  } else msg = JSON.parse(txt);
  logEntry(method + (params?.name ? " · " + params.name : ""), body, msg, ms);
  if (msg.error) throw new Error(msg.error.message);
  return msg.result;
}

function logEntry(title, req, res, ms, kind) {
  const d = document.createElement("details"); d.className = "ent";
  const s = document.createElement("summary");
  s.innerHTML = `<span class="m"></span><span class="ms ${ms > 500 ? "slow" : "fast"}">${ms} ms</span>`;
  s.querySelector(".m").textContent = (kind === "notification" ? "→ " : "↔ ") + title;
  const pre = document.createElement("pre");
  const trim = (o) => JSON.stringify(o, (k, v) => (typeof v === "string" && v.length > 600 ? v.slice(0, 600) + "…" : v), 2);
  pre.textContent = "REQUEST\n" + trim(req) + (res ? "\n\nRESPONSE\n" + trim(res) : "");
  d.append(s, pre); logEl.append(d); logEl.scrollTop = logEl.scrollHeight;
  if (kind !== "notification") { $("#lastMs").textContent = ms + " ms"; $("#barFill").style.width = Math.min(100, (ms / 500) * 100) + "%"; $("#barFill").style.background = ms > 500 ? "var(--bad)" : "var(--ok)"; }
}
$("#clearLog").onclick = () => (logEl.textContent = "");
$("#drawerBtn").onclick = (e) => { const on = $("#main").classList.toggle("drawer"); e.currentTarget.setAttribute("aria-expanded", String(on)); setTimeout(sizeFrame, 300); };

let uiHtml = null;
async function connect() {
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: { roots: { listChanged: true } }, clientInfo: { name: "Alexa+ MCP Client (simulated)", version: "1.0.0" } });
    await rpc("notifications/initialized", {}, { notify: true });
    const tools = await rpc("tools/list", {});
    const uri = tools.tools.find((t) => t._meta?.ui?.resourceUri)?._meta.ui.resourceUri;
    if (uri) { const r = await rpc("resources/read", { uri }); uiHtml = r.contents[0].text; }
    conn.textContent = `connected · ${init.serverInfo.name} ${init.serverInfo.version} · ${tools.tools.length} tools`;
    conn.className = "tag live";
    return true;
  } catch (e) { conn.textContent = "server unreachable"; conn.className = "tag down"; say("sys", "Can't reach the MCP server at " + MCP_URL + ". Start it with `npm start`."); return false; }
}

// ---------------------------------------------------------------- MCP Apps host (Echo Show)
const screen = $("#screen");
let frame = null, frameReady = false, queued = null;
function sizeFrame() {
  if (!frame) return;
  const [w, h] = $("#size").value.split("x").map(Number);
  screen.style.aspectRatio = `${w}/${h}`;
  frame.style.width = w + "px"; frame.style.height = h + "px";
  frame.style.transform = `scale(${screen.clientWidth / w})`;
}
$("#size").onchange = sizeFrame; window.addEventListener("resize", sizeFrame);
new ResizeObserver(sizeFrame).observe(screen);

function ensureFrame() {
  if (frame || !uiHtml) return;
  frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts"); // MCP Apps: untrusted view, talks only via postMessage
  frame.title = "Recall Radar MCP App";
  frame.srcdoc = uiHtml;
  $("#idle")?.remove(); screen.append(frame); sizeFrame();
}
const toApp = (method, params) => frame?.contentWindow?.postMessage({ jsonrpc: "2.0", method, params }, "*");

/** Tell the view a call is starting (MCP Apps: ui/notifications/tool-input) so it can show a skeleton immediately. */
function notifyInput(name, args) { ensureFrame(); if (frameReady) toApp("ui/notifications/tool-input", { arguments: args }); $("#uiState").textContent = "loading · " + name; }

function showOnScreen(structured) {
  if (!uiHtml || !structured) return;
  ensureFrame();
  queued = structured; flush();
}
function flush() {
  if (frameReady && queued) {
    toApp("ui/notifications/tool-result", { structuredContent: queued });
    $("#uiState").textContent = "rendered · " + (queued.kind ?? ""); queued = null;
  }
}
window.addEventListener("message", async (ev) => {
  if (!frame || ev.source !== frame.contentWindow) return;
  const m = ev.data; if (!m || m.jsonrpc !== "2.0") return;
  const reply = (result) => frame.contentWindow.postMessage({ jsonrpc: "2.0", id: m.id, result }, "*");
  const fail = (message) => frame.contentWindow.postMessage({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message } }, "*");
  if (m.method === "ui/initialize") { reply({ protocolVersion: m.params?.protocolVersion ?? "2026-01-26", hostInfo: { name: "Alexa+ simulator", version: "0.2" }, hostCapabilities: { openLinks: {}, serverTools: {} }, hostContext: { theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", displayMode: "inline" } }); }
  else if (m.method === "ui/notifications/initialized") { frameReady = true; flush(); }
  else if (m.method === "ui/notifications/size-changed") { /* fixed-size device screen */ }
  else if (m.method === "ui/open-link") { window.open(m.params.url, "_blank", "noopener"); reply({}); }
  else if (m.method === "tools/call") { try { const r = await callTool(m.params.name, m.params.arguments, { fromApp: true }); reply(r); } catch (e) { fail(String(e.message)); } }
});

// ---------------------------------------------------------------- tool calls (with listening glow + typing dots)
async function callTool(name, args, { fromApp = false } = {}) {
  bezel.classList.add("busy");
  const dots = typing(); notifyInput(name, args);
  try {
    const r = await rpc("tools/call", { name, arguments: args });
    handleToolResult(r, { fromApp });
    return r;
  } finally { dots.remove(); bezel.classList.remove("busy"); }
}

// ---------------------------------------------------------------- chat helpers
function say(who, text) {
  const d = document.createElement("div"); d.className = "msg " + who;
  if (who === "bot") { const w = document.createElement("span"); w.className = "who"; w.textContent = "ALEXA+"; d.append(w); }
  d.append(document.createTextNode(text)); chat.append(d); chat.scrollTop = chat.scrollHeight;
  if (who === "bot" && $("#tts").checked && "speechSynthesis" in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); }
}
function typing() { const d = document.createElement("div"); d.className = "typing"; d.innerHTML = "<i></i><i></i><i></i>"; chat.append(d); chat.scrollTop = chat.scrollHeight; return d; }

// ---------------------------------------------------------------- "Alexa" routing (thin on purpose)
const TYPE_WORDS = "high ?chair|stroller|car ?seat|crib|bassinet|play ?yard|swing|rocker|bouncer|walker|carrier|bath ?seat|sleeper|gate|monitor";
const TYPES = [
  [/\b(high ?chair|booster chair|feeding chair)s?\b/i, "high chair"], [/\b(stroller|pram|pushchair|jogger)s?\b/i, "stroller"],
  [/\b(car ?seat|infant seat|child seat)s?\b/i, "car seat"], [/\b(crib|cot)s?\b/i, "crib"], [/\b(bassinet|co-?sleeper|moses basket)s?\b/i, "bassinet"],
  [/\b(play ?yard|pack ?n ?play|pack and play|playpen)s?\b/i, "playard"], [/\b(swing)s?\b/i, "swing"], [/\b(bouncer|rocker)s?\b/i, "rocker"],
  [/\b(walker)s?\b/i, "walker"], [/\b(carrier|sling)s?\b/i, "carrier"], [/\b(bath ?seat|baby ?bather|bath ?tub)s?\b/i, "bath seat"],
  [/\b(sleeper)s?\b/i, "sleeper"], [/\b(baby ?gate|safety ?gate)s?\b/i, "gate"], [/\b(baby ?monitor)s?\b/i, "monitor"],
];
const WHERE = /\b(amazon|target|walmart|costco|ebay|etsy|temu|ikea|facebook marketplace|marketplace|craigslist|offerup|yard sale|garage sale|thrift|consignment|hand[- ]me[- ]down|friend|neighbou?r|family|grandma|grandmother|sister|cousin)\b/i;
const WHEN = /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4})\b/i;
const NOT_BRANDS = new Set(["Alexa", "I", "I'm", "Can", "Check", "Is", "My", "The", "This", "Used", "A", "An", "Ask", "Hey", "Please", "Model", "Made", "It", "It's", "Our", "We", "Do", "Does", "Also", "And", "Or", "But", "So", "Actually"]);

let current = null; // nickname of the item we're talking about
let lastRecallId = null;

function productOf(text) { for (const [re, name] of TYPES) if (re.test(text)) return name; return null; }
// The product phrase as the user said it ("Peg Perego Tatamia high chair"): a run of capitalised words before the product type.
// Brand and model-name interpretation happen server-side, against the real data.
function phraseOf(text) {
  const re = new RegExp(`((?:[A-Z][A-Za-z0-9'&-]*\\s+(?:&\\s+)?){1,6})(?:${TYPE_WORDS})s?\\b`, "i");
  const m = text.match(re);
  if (!m) return null;
  const words = m[1].trim().split(/\s+/);
  while (words.length && (NOT_BRANDS.has(words[0]) || /^[a-z]/.test(words[0]))) words.shift();
  if (!words.length) return null;
  return `${words.join(" ")} ${text.slice(text.indexOf(m[1]) + m[1].length).match(new RegExp(`^(?:${TYPE_WORDS})s?`, "i"))?.[0] ?? ""}`.trim();
}

async function handleUtterance(raw) {
  const text = raw.trim(); if (!text) return;
  say("user", text);
  const t = text.toLowerCase();
  const type = productOf(text);
  try {
    // 1. resume / list
    if (/(where (were|are) we|what('?s| is| am i)? (i )?(tracking|saved)|what do you have (saved|on)|status of|how('?s| is) (my|the)|remind me)/.test(t)) {
      const ref = type || (/(tracking|saved)/.test(t) ? undefined : current);
      return void (await callTool("get_case", ref ? { case: ref } : {}));
    }
    // 2. progress updates on the current item
    const status =
      /(threw|thrown|trashed|disposed|got rid|binned)/.test(t) ? "disposed" :
      /(arrived|came in|received|installed|got the (kit|replacement|refund)|refund (came|arrived)|it'?s (fixed|done))/.test(t) ? "remedy_completed" :
      /(request(ed)?|order(ed)?|asked for|applied|sent (off )?for|signed up).*(kit|refund|replacement|fix|repair)|(kit|refund|replacement|fix|repair).*(request|order)/.test(t) ? "remedy_requested" :
      /(stopped using|stop using|no longer using|put it away|took it out of use|unplugged)/.test(t) ? "stopped_using" : null;
    if (status) {
      const ref = type || current;
      if (!ref) return void say("bot", "Which item is that about? Tell me what it is, like “the high chair”.");
      return void (await callTool("update_case", { case: ref, status, note: status === "remedy_requested" || status === "remedy_completed" ? text : undefined }));
    }
    // 3. "what do I do about it?"
    if (/(what (do|should) i do|how do i (get|claim|order|fix)|what('?s| is) the (fix|remedy)|how (can|do) i (get|claim)|tell me more|more details)/.test(t) && lastRecallId) {
      return void (await callTool("get_recall", { recall_id: lastRecallId }));
    }
    // 4. a check
    const nickname = type || current;
    if (!nickname) return void say("bot", "Sure. What kind of product are you checking — a high chair, stroller, car seat, crib…?");
    current = nickname;
    const labelCue = /\b(model|style|item|sku|serial|lot|batch|dom|mfg|made|manufactur|date)\b|\d{4}|\d{2}\/\d{2}/i.test(text);
    const phrase = phraseOf(text);
    const where = text.match(WHERE)?.[0], when = text.match(WHEN)?.[0];
    const base = { description: phrase ?? type ?? nickname, ...(where && { bought_where: where }), ...(when && { bought_when: when }), nickname };
    await (labelCue ? callTool("check_label", { label_text: text, ...base }) : callTool("check_item", base));
  } catch (e) { say("bot", "Something went wrong: " + e.message); }
}

function handleToolResult(r, { fromApp = false } = {}) {
  const sc = r.structuredContent;
  const spoken = r.content?.map((c) => c.text).join(" ") ?? "";
  if (sc?.matches?.[0]?.recallId) lastRecallId = sc.matches[0].recallId;
  if (sc?.case?.recallId) lastRecallId = sc.case.recallId;
  if (sc?.case?.nickname) current = sc.case.nickname;
  $("#spoken").textContent = spoken ? "“" + (spoken.length > 110 ? spoken.slice(0, 110) + "…" : spoken) + "”" : "";
  if (!fromApp || sc) say("bot", spoken || "Done.");
  showOnScreen(sc);
  return r;
}

// ---------------------------------------------------------------- inputs
$("#form").onsubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ""; handleUtterance(v); };

// voice input (Chrome / Safari)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const mic = $("#mic");
if (!SR) { mic.disabled = true; mic.title = "Speech recognition isn't available in this browser"; }
else {
  const rec = new SR(); rec.lang = "en-US"; rec.interimResults = false;
  rec.onresult = (e) => handleUtterance(e.results[0][0].transcript);
  rec.onend = () => mic.classList.remove("on"); rec.onerror = () => mic.classList.remove("on");
  mic.onclick = () => { if (mic.classList.contains("on")) return rec.stop(); mic.classList.add("on"); rec.start(); };
}

// label photo → OCR → check_label
$("#photoBtn").onclick = () => $("#photo").click();
$("#photo").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return; e.target.value = "";
  say("user", "📷 [photo of the label: " + f.name + "]");
  const t0 = performance.now(); const dots = typing(); bezel.classList.add("busy");
  try {
    const res = await fetch("/api/ocr", { method: "POST", body: await f.arrayBuffer() });
    const j = await res.json();
    dots.remove(); bezel.classList.remove("busy");
    if (!res.ok) throw new Error(j.error || "OCR failed");
    logEntry("POST /api/ocr (Tesseract, local)", { bytes: f.size }, j, Math.round(performance.now() - t0));
    if (!j.text) return say("bot", "I couldn't read any text in that photo. Try a closer, sharper shot of the label, or read me the model number and date.");
    say("sys", "Read from photo: “" + j.text.replace(/\s+/g, " ").slice(0, 160) + "”");
    const nickname = current ?? "item"; current = nickname;
    await callTool("check_label", { label_text: j.text, description: current === "item" ? undefined : current, nickname });
  } catch (err) { dots.remove(); bezel.classList.remove("busy"); say("bot", "I couldn't read that photo: " + err.message + ". You can read me the model number and date instead."); }
};

// ---------------------------------------------------------------- the story (suggested prompts + auto-play)
const STORY = [
  "I'm buying a used Peg Perego Tatamia high chair. Can you check it for recalls?",
  "The label says Model No: IMTATANA01BL73, made in February 2023",
  "What do I do about it?",
  "I requested the refund",
  "Where were we with the high chair?",
  "My friend's Peg Perego Tatamia high chair is the same model, made in November 2021",
  "Check a Graco SnugRide Turn & Slide car seat made January 2026",
];
const chipsEl = $("#chips");
chipsEl.append(Object.assign(document.createElement("div"), { className: "lbl", textContent: "Try the story" }));
STORY.forEach((c, i) => { const b = document.createElement("button"); b.type = "button"; b.innerHTML = `<b>${i + 1}</b><span></span>`; b.lastChild.textContent = c; b.onclick = () => handleUtterance(c); chipsEl.append(b); });

let playing = false;
async function typeInto(text) { input.value = ""; for (const ch of text) { if (!playing) return false; input.value += ch; await sleep(14); } return true; }
$("#play").onclick = async (e) => {
  const btn = e.currentTarget;
  if (playing) { playing = false; btn.textContent = "▶ Play demo"; return; }
  await resetAll(); playing = true; btn.textContent = "■ Stop";
  for (const line of STORY) {
    if (!playing) break;
    if (!(await typeInto(line))) break;
    await sleep(350); input.value = "";
    await handleUtterance(line);
    await sleep(3600); // let the screen be read
  }
  playing = false; btn.textContent = "▶ Play demo";
};

async function resetAll() {
  try { await fetch("/api/reset-cases", { method: "POST" }); } catch {}
  chat.textContent = ""; current = null; lastRecallId = null; $("#spoken").textContent = "";
  frame?.remove(); frame = null; frameReady = false; queued = null; $("#uiState").textContent = "idle";
  screen.style.aspectRatio = "16/10";
  if (!$("#idle")) screen.insertAdjacentHTML("afterbegin", '<div class="idle" id="idle"><div><div class="clock" id="clock"></div><p>“Alexa, check this used high chair for recalls.”</p></div></div>');
  tickClock(); say("sys", "Simulated Alexa+ host. Type, speak 🎤, upload a label photo 📷, or press ▶ Play demo.");
}
$("#reset").onclick = () => { playing = false; $("#play").textContent = "▶ Play demo"; resetAll(); };

function tickClock() { const c = $("#clock"); if (c) c.textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/, ""); }
setInterval(tickClock, 15000);

say("sys", "Simulated Alexa+ host. Type, speak 🎤, upload a label photo 📷, or press ▶ Play demo.");
tickClock();
connect();
