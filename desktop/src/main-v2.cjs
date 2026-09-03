"use strict";

const testMode = process.argv.includes("--self-test") || process.argv.includes("--ui-smoke-test");

require("./main.cjs");

if (!testMode) {
  require("./stream-overlay-bootstrap.cjs");
  require("./deck-bootstrap.cjs");
  require("./chat-bootstrap.cjs");
}
