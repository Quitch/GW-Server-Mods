"use strict";

// live_game/ui.js: load the server mods' scene scripts. The scene has no
// Community Mods, so the list is the one a Galactic War mount stored.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const {
  createContext,
  flush,
  loadFile,
  loadScene,
} = require("../scripts/lib/scene-loader.js");

const BUILD = "coui://ui/mods/com.example/shared_build.js";
const LIVE = "coui://ui/mods/com.example/live_game.js";

describe("live_game server mod UI", () => {
  it("loads the stored server mod UI, and neither mounts nor takes a seam", async () => {
    const loads = [];
    // The scene as modinfo.json loads it, not the full shared set.
    const fixture = sharedScene({ cmm: null, files: [] });

    fixture.ctx.localStorage.setItem(
      "gw_server_mods_scenes",
      JSON.stringify({ shared_build: [BUILD], live_game: [LIVE] })
    );
    fixture.ctx.loadMods = (list) => loads.push(list);
    const unmount = fixture.api.file.unmountAllMemoryFiles;

    loadScene(fixture.ctx, "live_game");
    await flush();

    assert.deepEqual(loads, [[BUILD], [LIVE]]);
    assert.equal(fixture.ctx.GwServerMods.mount, undefined);
    assert.equal(fixture.api.calls.zipMount.length, 0);
    assert.equal(fixture.api.file.unmountAllMemoryFiles, unmount);
    assert.equal(fixture.ctx.GwServerMods.hooks, undefined);
    assert.deepEqual(fixture.codes(), []);
  });

  it("logs rather than throws when the shared modules did not load", () => {
    const ctx = createContext();

    loadFile(ctx, "live_game/ui.js");

    assert.match(ctx.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});
