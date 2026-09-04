"use strict";

// gw_lobby/keepalive.js: hold the mounts through co-op lobby setup.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const {
  createContext,
  flush,
  loadFile,
  loadScene,
} = require("../scripts/lib/scene-loader.js");

describe("gw_lobby keepalive", () => {
  it("installs the hooks and mounts with content registration", async () => {
    const fixture = sharedScene({
      cmmOptions: { serverMods: [mod()] },
      ajax: (url) =>
        url.endsWith("unit_list.json") ? JSON.stringify({ units: [] }) : "",
    });

    loadScene(fixture.ctx, "gw_lobby");
    await flush();

    assert.equal(
      fixture.api.file.unmountAllMemoryFiles.__gwServerModsWrapped,
      true
    );
    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.api.calls.remount.length, 1);
    assert.deepEqual(fixture.codes(), []);
  });

  it("logs rather than throws when the shared modules did not load", () => {
    const ctx = createContext();
    loadFile(ctx, "shared/alarm.js");

    loadFile(ctx, "gw_lobby/keepalive.js");

    assert.equal(ctx.GwServerMods.hooks, undefined);
    assert.match(ctx.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});
