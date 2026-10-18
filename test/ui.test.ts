import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("MCP App screen: its script parses (a syntax slip would blank the Echo Show)", () => {
  const html = readFileSync(join(root, "src", "ui", "result.html"), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)![1]!;
  assert.doesNotThrow(() => new Function(script));
  // the host-bridge methods the screen relies on
  for (const m of ["ui/initialize", "ui/notifications/initialized", "ui/notifications/tool-result", "ui/notifications/tool-input", "ui/open-link", "tools/call"]) assert.ok(script.includes(m), `missing ${m}`);
});

test("simulator script parses and implements the MCP Apps host side", () => {
  const js = readFileSync(join(root, "simulator", "app.js"), "utf8");
  assert.doesNotThrow(() => new Function(js.replace(/^import .*$/gm, "")));
  for (const m of ["ui/initialize", "ui/notifications/tool-result", "ui/notifications/tool-input", "ui/open-link", "tools/call", "initialize", "tools/list", "resources/read"]) assert.ok(js.includes(m), `missing ${m}`);
  assert.match(js, /sandbox", "allow-scripts"/); // the view must stay sandboxed
});
