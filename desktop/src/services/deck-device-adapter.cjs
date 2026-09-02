"use strict";

class DeckDeviceAdapter {
  constructor(info = {}) { this.info = { ...info }; this.connected = false; }
  async connect() { throw new Error("DeckDeviceAdapter.connect() muss vom Geräteadapter implementiert werden."); }
  async disconnect() { this.connected = false; }
  async setKeyImage() { throw new Error("setKeyImage() wird von diesem Gerät nicht unterstützt."); }
  async setBrightness() { throw new Error("setBrightness() wird von diesem Gerät nicht unterstützt."); }
  async clear() { throw new Error("clear() wird von diesem Gerät nicht unterstützt."); }
  geometry() {
    return {
      rows: Number(this.info.rows || 0), columns: Number(this.info.columns || 0),
      keyCount: Number(this.info.keyCount || (Number(this.info.rows || 0) * Number(this.info.columns || 0)))
    };
  }
}

function assertDeckAdapter(adapter) {
  for (const method of ["connect", "disconnect", "setKeyImage", "geometry"]) {
    if (!adapter || typeof adapter[method] !== "function") throw new TypeError(`Ungültiger Touch-Deck-Geräteadapter: ${method} fehlt.`);
  }
  return adapter;
}

module.exports = { DeckDeviceAdapter, assertDeckAdapter };
