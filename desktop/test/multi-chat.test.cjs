"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { ChatStore } = require("../src/services/chat-store.cjs");
const { ChatCore } = require("../src/services/chat-core.cjs");
const { normalizeTtsConfig } = require("../src/services/tts-config.cjs");

test("chat store remains bounded", () => { const store = new ChatStore({ maxMessages: 50 }); for(let i=0;i<80;i++) store.add({platform:"twitch",username:`u${i}`,message:"x"}); assert.equal(store.size(),50); assert.equal(store.list({limit:2})[0].username,"u78"); });

test("chat core batches normalized platform messages", async () => { const core = new ChatCore({ maxMessages: 50, flushMs: 25 }); const batches=[]; core.on("messages", (batch)=>batches.push(batch)); core.ingest({platform:"cng",displayName:"Batto",text:"Hallo",badges:["mod"]}); await new Promise((resolve)=>setTimeout(resolve,60)); assert.equal(batches.length,1); assert.equal(batches[0][0].username,"Batto"); assert.equal(core.history()[0].platform,"cng"); await core.stop(); });

test("tts config clamps unsafe ranges", () => { const cfg=normalizeTtsConfig({enabled:true,rate:9,volume:-2,maxQueue:999,maxCommentLength:99999}); assert.equal(cfg.enabled,true); assert.equal(cfg.rate,2); assert.equal(cfg.volume,0); assert.equal(cfg.maxQueue,100); assert.equal(cfg.maxCommentLength,1000); });
