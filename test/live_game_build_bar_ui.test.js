"use strict";

// live_game_build_bar/ui.js: the server mods' scripts for this panel, from the
// list the gw_play mount persisted.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createContext,
  fakeSessionStorage,
  loadFile,
  loadScene,
} = require("../scripts/lib/scene-loader.js");
const { createFakeJQuery } = require("../scripts/lib/fake-jquery.js");

const URL = "coui://ui/mods/com.example/live_game_build_bar.js";

describe("live_game_build_bar ui", () => {
  it("loads the panel's server mod scripts", () => {
    const loads = [];
    const ctx = createContext({
      $: createFakeJQuery(),
      loadMods: (list) => loads.push(list),
      sessionStorage: fakeSessionStorage({
        gw_server_mods_scenes: JSON.stringify({ live_game_build_bar: [URL] }),
      }),
    });

    loadScene(ctx, "live_game_build_bar");

    assert.deepEqual(loads, [[URL]]);
    assert.deepEqual(ctx.GwServerMods.alarms(), []);
  });

  it("logs rather than throws when the shared modules did not load", () => {
    const ctx = createContext();

    loadFile(ctx, "live_game_build_bar/ui.js");

    assert.match(ctx.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});
