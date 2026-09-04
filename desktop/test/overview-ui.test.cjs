"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.join(__dirname, "..", "src", "renderer");

test("overview uses the Crazy_Batto Multi Chat hero and reconstructed bg image", () => {
  const html = fs.readFileSync(path.join(renderer, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(renderer, "overview-hero.css"), "utf8");
  const bg = path.join(renderer, "assets", "bg.jpg");

  assert.match(html, /Crazy_Batto Multi Chat/);
  assert.match(html, /BATTO OBS TOOL 2\.1\.0/);
  assert.match(html, /OBS, TikTok und Multi-Chat zentral steuern/);
  assert.match(html, /Produktionskern für OBS, TikTok LIVE Studio\/API, Multi-Chat, Touch-Deck Pro und Browser-Overlays\./);
  assert.match(html, /assets\/bg\.jpg/);
  assert.match(css, /object-fit:\s*cover/);
  assert.equal(fs.existsSync(bg), true, "bg.jpg muss durch prepare:integrated erzeugt worden sein");

  const image = fs.readFileSync(bg);
  assert.ok(image.length > 10000);
  assert.equal(image[0], 0xff);
  assert.equal(image[1], 0xd8);
});
