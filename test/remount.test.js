"use strict";

// live_game/remount.js: keep the mounts through a battle without touching the
// renderer.

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

const BUILD = "coui://ui/mods/com.example/shared_build.js";
const LIVE = "coui://ui/mods/com.example/live_game.js";

describe("live_game remount", () => {
  it("installs the hooks, mounts without content registration and loads the server mod UI", async () => {
    const loads = [];
    const fixture = sharedScene({
      cmmOptions: {
        serverMods: [
          mod({ scenes: { shared_build: [BUILD], live_game: [LIVE] } }),
        ],
      },
      ajax: (url) =>
        url.endsWith("unit_list.json") ? JSON.stringify({ units: [] }) : "",
    });

    fixture.ctx.loadMods = (list) => loads.push(list);
    loadScene(fixture.ctx, "live_game");
    await flush();

    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.api.calls.remount.length, 0);
    assert.deepEqual(loads, [[BUILD], [LIVE]]);

    const runs = [];
    fixture.ns.mount.run = (options) => {
      runs.push(options);
      return resolved(true);
    };
    fixture.api.file.unmountAllMemoryFiles();
    await flush();

    assert.deepEqual(runs, [{ remountContent: false }]);
    assert.deepEqual(fixture.codes(), []);
  });

  it("logs rather than throws when the shared modules did not load", () => {
    const ctx = createContext();

    loadFile(ctx, "live_game/remount.js");

    assert.match(ctx.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});
