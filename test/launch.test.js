"use strict";

// gw_play/launch.js: mount as the scene loads - without the content remount,
// which the galaxy map does not need - and again on the way into a battle,
// through model.fight, where it does.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { Deferred, resolved } = require("../scripts/lib/fake-jquery.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const { flush, loadFile } = require("../scripts/lib/scene-loader.js");

function scene(options) {
  const opts = options || {};
  const fights = [];
  const fixture = sharedScene(
    Object.assign(
      {
        model: {
          fight: function () {
            fights.push({
              self: this,
              args: Array.prototype.slice.call(arguments),
            });
            return "fought";
          },
        },
      },
      opts
    )
  );
  fixture.fights = fights;
  loadFile(fixture.ctx, "gw_play/launch.js");
  return fixture;
}

describe("launch installation", () => {
  it("installs the hooks, mounts at once and patches fight", async () => {
    const fixture = scene();
    await flush();

    assert.equal(
      fixture.api.file.unmountAllMemoryFiles.__gwServerModsWrapped,
      true
    );
    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.model.fight.__gwServerModsPatched, true);
    assert.equal(
      fixture.console.lines.log.includes("[GW-SM] fight patched"),
      true
    );
    assert.deepEqual(fixture.codes(), []);
  });

  // The remount blanks the scene for seconds, and nothing on the galaxy map
  // goes through the renderer's content catalogue.
  it("mounts without remounting the content", async () => {
    const fixture = scene({ cmmOptions: { serverMods: [mod()] } });
    await flush();

    assert.equal(fixture.api.calls.zipMount.length, 1);
    assert.equal(fixture.api.calls.remount.length, 0);
  });

  // The hooks keep the default, so a mount triggered by an unmount mid-launch
  // still restores the catalogue.
  it("installs the hooks without inheriting the scene's options", async () => {
    const fixture = scene({ cmmOptions: { serverMods: [mod()] } });

    fixture.api.file.unmountAllMemoryFiles();
    await flush();

    assert.equal(fixture.api.calls.remount.length, 1);
  });

  it("raises launch_unavailable without model.fight", () => {
    const fixture = scene({ model: {} });
    assert.deepEqual(fixture.alarm("launch_unavailable")[0].detail, {
      fight: false,
    });

    const noModel = sharedScene({ model: null });
    noModel.ctx.model = null;
    loadFile(noModel.ctx, "gw_play/launch.js");
    assert.equal(noModel.alarm("launch_unavailable").length, 1);
  });

  it("patches once", () => {
    const fixture = scene();
    const patched = fixture.model.fight;

    loadFile(fixture.ctx, "gw_play/launch.js");

    assert.equal(fixture.model.fight, patched);
  });

  it("logs rather than throws when the shared modules are missing", () => {
    const fixture = sharedScene({ files: ["shared/alarm.js"] });

    loadFile(fixture.ctx, "gw_play/launch.js");

    assert.match(fixture.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});

describe("the patched fight", () => {
  it("mounts, then fights with the same this and arguments", () => {
    const fixture = scene();
    const runs = [];
    fixture.ns.mount.run = (options) => {
      runs.push({ options: options, fought: fixture.fights.length });
      return resolved(true);
    };
    const self = {};
    let outcome;

    fixture.model.fight.call(self, 1, 2).then((value) => {
      outcome = value;
    });

    // No options: the battle needs the content remount the scene skipped.
    assert.deepEqual(runs, [{ options: undefined, fought: 0 }]);
    assert.deepEqual(fixture.fights, [{ self, args: [1, 2] }]);
    assert.equal(outcome, "fought");
  });

  it("does not fight until the mount settles", () => {
    const pending = Deferred();
    const fixture = scene();
    fixture.ns.mount.run = () => pending.promise();

    fixture.model.fight();
    assert.equal(fixture.fights.length, 0);

    pending.resolve(true);
    assert.equal(fixture.fights.length, 1);
  });
});
