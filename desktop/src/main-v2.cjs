"use strict";

const hardwareApi = require("./services/hardware.cjs");
const { enrichHardware } = require("./services/hardware-enrichment-v2.cjs");

const collectBaseHardware = hardwareApi.collectHardware.bind(hardwareApi);
hardwareApi.collectHardware = async function collectEnrichedHardware() {
  return enrichHardware(await collectBaseHardware());
};

require("./main.cjs");
require("./stream-overlay-bootstrap.cjs");
require("./deck-bootstrap.cjs");
require("./chat-bootstrap.cjs");
