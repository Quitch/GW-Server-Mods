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
  fakeSessionStorage,
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

  // Stock resets gw_campaign_role only in gw_play, so a viewer that exits to
  // the main menu still reads as one here.
  it("forgets a host list left from viewing before it mounts", async () => {
    const storage = fakeSessionStorage({
      gw_server_mods_viewer_host_mods: JSON.stringify(["com.other"]),
    });
    // The store read checks the key as a property, as the engine's storage has.
    storage.installedModsDB = "1";
    const fixture = sharedScene({
      cmm: null,
      files: [],
      stubs: {
        ko: fakeKo([mod({ context: "server", enabled: true })]),
        localStorage: storage,
        sessionStorage: fakeSessionStorage({
          gw_campaign_role: JSON.stringify("viewer"),
        }),
      },
    });

    loadScene(fixture.ctx, "gw_start");
    await flush();

    assert.equal("gw_server_mods_viewer_host_mods" in storage.store, false);
    assert.deepEqual(fixture.api.calls.zipMount, [
      ["/download/com.example.server.zip", "/", false],
    ]);
  });

  it("logs rather than throws when the shared modules did not load", () => {
    const ctx = createContext();

    loadFile(ctx, "gw_start/mount.js");

    assert.match(ctx.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});
