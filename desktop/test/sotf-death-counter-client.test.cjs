"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { SotfDeathCounterClient, normalizeLoopbackBaseUrl, normalizeSnapshot } = require("../src/services/sotf-death-counter-client.cjs");

test("SOTF DeathCounter v0.3.0 Snapshot wird lokal und ohne erfundene Werte normalisiert", async () => {
  const server = http.createServer((request, response) => {
    if (request.url === "/api/v1/snapshot") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        version: 1,
        title: "Crazy Batto SOTF",
        sessionId: "session-1",
        onlinePlayers: 1,
        knownPlayers: 2,
        showLifetimeDeaths: true,
        lastEvent: { sequence: 4, type: "death", playerId: "p1", playerName: "Batto", sessionDeaths: 2, lifetimeDeaths: 8, reason: "Mutant" },
        players: [{ rank: 1, id: "p1", name: "Batto", sessionDeaths: 2, lifetimeDeaths: 8, online: true, state: "alive" }]
      }));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const client = new SotfDeathCounterClient({ baseUrl: `http://127.0.0.1:${port}/`, timeoutMs: 1000 });
  let changes = 0;
  client.on("changed", () => { changes += 1; });
  try {
    const status = await client.refresh({ throwOnError: true });
    assert.equal(status.connected, true);
    assert.equal(status.snapshot.players[0].name, "Batto");
    assert.equal(status.snapshot.players[0].sessionDeaths, 2);
    assert.equal(status.snapshot.lastEvent.reason, "Mutant");
    assert.match(status.overlayUrl, new RegExp(`127\\.0\\.0\\.1:${port}/overlay`));
    await client.refresh({ throwOnError: true });
    assert.equal(changes, 1, "identische Polling-Antworten dürfen keinen Vollzustand auslösen");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const offline = await client.refresh();
  assert.equal(offline.connected, false);
  assert.ok(offline.error);
});

test("SOTF API akzeptiert ausschließlich Loopback und begrenzt Snapshotdaten", () => {
  assert.throws(() => normalizeLoopbackBaseUrl("http://192.168.1.10:19447/"), /lokale HTTP-Adresse/);
  const normalized = normalizeSnapshot({ players: Array.from({ length: 150 }, (_, index) => ({ id: index, name: `P${index}` })) });
  assert.equal(normalized.players.length, 100);
  assert.equal(normalized.knownPlayers, 100);
});
