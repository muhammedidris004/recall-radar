/**
 * HTTP entry point.
 *   POST /mcp       MCP over Streamable HTTP (spec 2025-11-25), stateless, JSON responses
 *   POST /api/ocr   label photo -> text, via the free `tesseract` CLI (optional)
 *   GET  /          the Alexa+-style web simulator (an actual MCP client)
 *
 * Binds to 127.0.0.1 by default (MCP spec guidance for local servers). Set HOST=0.0.0.0 behind a tunnel.
 */
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RadarEngine } from "./engine.ts";
import { FileCaseStore } from "./cases.ts";
import { createServer } from "./server.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const simDir = join(root, "simulator");
const PORT = Number(process.env.PORT ?? 3333);
const HOST = process.env.HOST ?? "127.0.0.1";

const engine = new RadarEngine();
const cases = new FileCaseStore();

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };

function cors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, accept, mcp-session-id, mcp-protocol-version, authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

async function readBody(req: IncomingMessage, limit = 12_000_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new Error("body too large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
};

function ocr(image: Buffer): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const dir = await mkdtemp(join(tmpdir(), "radar-ocr-"));
    const file = join(dir, "label");
    try {
      await writeFile(file, image);
      // psm 6: a single uniform block of text, which suits stickers; psm 11 (sparse) as fallback is slower, so keep one pass.
      execFile("tesseract", [file, "stdout", "--psm", "6"], { timeout: 20_000, maxBuffer: 2_000_000 }, (err, stdout) => {
        rm(dir, { recursive: true, force: true }).catch(() => {});
        err ? reject(err) : resolve(stdout.trim());
      });
    } catch (e) {
      rm(dir, { recursive: true, force: true }).catch(() => {});
      reject(e);
    }
  });
}

const http = createHttp(async (req, res) => {
  cors(res);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (req.method === "OPTIONS") return void res.writeHead(204).end();

    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        return json(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)." }, id: null });
      }
      const body = JSON.parse((await readBody(req, 1_000_000)).toString("utf8") || "null");
      // Stateless: one server + transport per request. Engine and case store are shared.
      const server = createServer({ engine, cases });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      return void (await transport.handleRequest(req, res, body));
    }

    if (url.pathname === "/api/ocr" && req.method === "POST") {
      const img = await readBody(req);
      try {
        return json(res, 200, { text: await ocr(img) });
      } catch (e: any) {
        return json(res, e?.code === "ENOENT" ? 501 : 500, { error: e?.code === "ENOENT" ? "tesseract is not installed (brew install tesseract)" : String(e?.message ?? e) });
      }
    }

    if (url.pathname === "/api/reset-cases" && req.method === "POST") {
      // demo helper: lets the simulator start from a clean slate for repeatable recordings
      cases.clear();
      return json(res, 200, { ok: true });
    }

    if (url.pathname === "/api/health") {
      return json(res, 200, { ok: true, recalls: engine.dataset.recalls.length, dataThrough: engine.dataset.dataThrough, ocr: true });
    }

    if (req.method === "GET") {
      const rel = url.pathname === "/" ? "index.html" : normalize(url.pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
      const file = join(simDir, rel);
      if (file.startsWith(simDir) && existsSync(file)) {
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
        return void res.end(await readFile(file));
      }
    }
    json(res, 404, { error: "not found" });
  } catch (e: any) {
    if (!res.headersSent) json(res, 500, { jsonrpc: "2.0", error: { code: -32603, message: String(e?.message ?? e) }, id: null });
  }
});

http.listen(PORT, HOST, () => {
  console.log(`Recall Radar MCP server  http://${HOST}:${PORT}/mcp`);
  console.log(`Simulator                http://${HOST}:${PORT}/`);
  console.log(`${engine.dataset.recalls.length} recalls loaded, data through ${engine.dataset.dataThrough}`);
});
