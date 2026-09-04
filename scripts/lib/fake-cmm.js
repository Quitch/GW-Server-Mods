"use strict";

// A Community Mods manager and the mod records it hands out. Records carry the
// raw CMM field names (display_name, installedPath); manifest.js's describe()
// turns them into the shape the rest of the mod reads.

const { resolved } = require("./fake-jquery.js");

function mod(overrides) {
  return Object.assign(
    {
      identifier: "com.example.server",
      display_name: "Example Server",
      version: "1.0.0",
      installedPath: "/download/com.example.server.zip",
      fileSystem: false,
      galacticWarMod: false,
    },
    overrides
  );
}

function createFakeCmm(options) {
  const opts = options || {};
  const calls = { mountServerMods: 0, remountClientMods: [] };
  const mgr = { calls: calls };

  if (opts.available !== false) {
    mgr.activeServerModsToMount = () => opts.serverMods || [];
    mgr.mountServerMods = () => {
      calls.mountServerMods += 1;
      return opts.mountServerMods ? opts.mountServerMods() : resolved();
    };
  }
  if (opts.clientMods) {
    mgr.activeInstalledClientMods = () => opts.clientMods;
  }
  if (opts.mergeUnitServerMods !== undefined) {
    mgr.mergeUnitServerMods = () => opts.mergeUnitServerMods;
  }
  if (opts.remountClientMods !== false) {
    mgr.remountClientMods = function () {
      calls.remountClientMods.push(Array.prototype.slice.call(arguments));
      return opts.remountClientMods ? opts.remountClientMods() : resolved();
    };
  }

  return mgr;
}

module.exports = { createFakeCmm, mod };
