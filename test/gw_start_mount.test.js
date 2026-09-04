"use strict";

// gw_start/mount.js: the root mounts alone, before a war exists and without
// Community Mods.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const { resolved } = require("../scripts/lib/fake-jquery.js");
const {
  createContext,
  flush,
  loadFile,
  loadScene,
} = require("../scripts/lib/scene-loader.js");

function fakeKo(records) {
  return {
    observableArray: () => {
      const store = () => records;
      store.extend = () => {
        store.ready = resolved(records);
        return store;
      };
      return store;
    },
  };
}

describe("gw_start mount", () => {
  it("mounts the enabled server zips at the root from the store", async () => {
    const fixture = sharedScene({
      cmm: null,
      files: [],
      stubs: {
        ko: fakeKo([mod({ context: "server", enabled: true })]),
        localStorage: { installedModsDB: "1" },
      },
    });

    loadScene(fixture.ctx, "gw_start");
    await flush();
    const ns = fixture.ctx.GwServerMods;

    assert.deepEqual(fixture.api.calls.zipMount, [
      ["/download/com.example.server.zip", "/", false],
    ]);
    // No content remount: the scene reads through coui:, and the remount
    // freezes the UI.
    assert.equal(fixture.api.calls.remount.length, 0);
    assert.equal(ns.mount.state().mounted, true);
    assert.equal(ns.hooks, undefined);
    assert.deepEqual(ns.alarms(), []);
  });

  it("logs rather than throws when the shared modules did not load", () => {
    const ctx = createContext();

    loadFile(ctx, "gw_start/mount.js");

    assert.match(ctx.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});
