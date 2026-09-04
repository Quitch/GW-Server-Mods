"use strict";

// shared/hooks.js: remounting after every teardown, through an accessor on the
// seam the scene assigns after mod scripts run.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { enginePromise, resolved } = require("../scripts/lib/fake-jquery.js");
const { flush, loadFile } = require("../scripts/lib/scene-loader.js");

// hooks.js reads ns.mount at call time, so the real mount is swapped for a
// recorder after loading.
function scene(options) {
  const fixture = sharedScene(options);
  const runs = [];
  let sequence = 0;
  fixture.ns.mount = {
    run: (opts) => {
      runs.push(opts);
      sequence += 1;
      return resolved(true);
    },
    sequence: () => sequence,
    bump: () => {
      sequence += 1;
    },
  };
  fixture.runs = runs;
  return fixture;
}

describe("hooks.install", () => {
  it("wraps the unmount and the client remount and reports success", () => {
    const fixture = scene();

    assert.equal(fixture.ns.hooks.install(), true);
    assert.deepEqual(fixture.codes(), []);
    assert.deepEqual(fixture.console.lines.log, [
      "[GW-SM] unmountAllMemoryFiles accessor installed",
      "[GW-SM] remountClientMods wrapped",
    ]);
  });

  it("raises hooks_unavailable when the unmount is missing", () => {
    const fixture = scene({ apiOptions: { unmountAllMemoryFiles: false } });

    assert.equal(fixture.ns.hooks.install(), false);
    assert.deepEqual(fixture.alarm("hooks_unavailable")[0].detail, {
      unmount: false,
      remount: true,
    });
  });

  it("raises hooks_unavailable when api.file itself is missing", () => {
    const fixture = scene();
    fixture.api.file = null;

    assert.equal(fixture.ns.hooks.install(), false);
  });

  it("raises hooks_unavailable when Community Mods has no remount to wrap", () => {
    const fixture = scene({ cmmOptions: { remountClientMods: false } });

    assert.equal(fixture.ns.hooks.install(), false);
    assert.deepEqual(fixture.alarm("hooks_unavailable")[0].detail, {
      unmount: true,
      remount: false,
    });
  });

  it("needs no client remount in a scene without Community Mods", () => {
    const fixture = scene({ cmm: null });

    assert.equal(fixture.ns.hooks.install(), true);
  });

  it("installs once: a second install finds the marks and wraps nothing again", async () => {
    const fixture = scene();
    fixture.ns.hooks.install();
    fixture.ns.hooks.install();

    fixture.api.file.unmountAllMemoryFiles();
    await flush();
    fixture.cmm.remountClientMods();
    await flush();

    assert.equal(fixture.runs.length, 2);
    assert.equal(fixture.console.lines.log.length, 2);
  });
});

describe("the unmount accessor", () => {
  it("remounts after the original unmount settles, forwarding this and arguments", async () => {
    const calls = [];
    const fixture = scene({
      apiOptions: {
        unmountAllMemoryFiles: function () {
          calls.push(Array.prototype.slice.call(arguments));
          return resolved("unmounted");
        },
      },
    });
    fixture.ns.hooks.install({ remountContent: false });

    let outcome;
    fixture.api.file.unmountAllMemoryFiles("a", "b").then((value) => {
      outcome = value;
    });
    await flush();

    assert.deepEqual(calls, [["a", "b"]]);
    assert.deepEqual(fixture.runs, [{ remountContent: false }]);
    assert.equal(outcome, true);
  });

  it("survives the scene assigning a new unmount after install", async () => {
    const fixture = scene();
    fixture.ns.hooks.install();
    let replaced = 0;

    fixture.api.file.unmountAllMemoryFiles = () => {
      replaced += 1;
    };
    fixture.api.file.unmountAllMemoryFiles();
    await flush();

    assert.equal(replaced, 1);
    assert.equal(fixture.runs.length, 1);
    assert.equal(
      fixture.api.file.unmountAllMemoryFiles.__gwServerModsWrapped,
      true
    );
  });

  it("keeps a non-function assignment as it is", () => {
    const fixture = scene();
    fixture.ns.hooks.install();

    fixture.api.file.unmountAllMemoryFiles = "gone";

    assert.equal(fixture.api.file.unmountAllMemoryFiles, "gone");
  });

  it("skips the remount when the inner wrapper already ran one", async () => {
    const fixture = scene();
    fixture.ns.hooks.install();
    const inner = fixture.api.file.unmountAllMemoryFiles;

    fixture.api.file.unmountAllMemoryFiles = function () {
      fixture.ns.mount.bump();
      return inner();
    };
    let outcome;
    fixture.api.file.unmountAllMemoryFiles().then((value) => {
      outcome = value;
    });
    await flush();

    assert.equal(fixture.runs.length, 1);
    assert.equal(outcome, true);
  });

  // The engine promise this returns is the one $.when read as a plain value,
  // which ran the remount while the teardown was still in flight.
  it("waits for a pending unmount before remounting", async () => {
    const pending = enginePromise();
    const fixture = scene({
      apiOptions: { unmountAllMemoryFiles: () => pending },
    });
    fixture.ns.hooks.install();
    let settled = false;

    fixture.api.file.unmountAllMemoryFiles().always(() => {
      settled = true;
    });
    await flush();

    assert.equal(fixture.runs.length, 0);
    assert.equal(settled, false);

    pending.resolve();
    await flush();

    assert.equal(fixture.runs.length, 1);
    assert.equal(settled, true);
  });

  // The sequence guard is read when the teardown settles, so two teardowns in
  // one tick share the one remount rather than running it twice. That is the
  // same guard that stops a nested wrapper remounting again, and a remount
  // costs seconds.
  it("remounts once for two teardowns in the same tick", async () => {
    const fixture = scene();
    fixture.ns.hooks.install();

    fixture.api.file.unmountAllMemoryFiles();
    fixture.cmm.remountClientMods();
    await flush();

    assert.equal(fixture.runs.length, 1);
  });

  // Nothing else puts the mounts back, so a teardown that failed still remounts.
  it("remounts after a teardown that rejected", async () => {
    const failing = enginePromise();
    const fixture = scene({
      apiOptions: { unmountAllMemoryFiles: () => failing },
    });
    fixture.ns.hooks.install();

    fixture.api.file.unmountAllMemoryFiles();
    failing.reject("refused");
    await flush();

    assert.equal(fixture.runs.length, 1);
  });

  it("is idempotent when the scene assigns the wrapped function back", async () => {
    const fixture = scene();
    fixture.ns.hooks.install();
    const wrapped = fixture.api.file.unmountAllMemoryFiles;

    fixture.api.file.unmountAllMemoryFiles = wrapped;
    fixture.api.file.unmountAllMemoryFiles();
    await flush();

    assert.equal(fixture.api.file.unmountAllMemoryFiles, wrapped);
    assert.equal(fixture.runs.length, 1);
  });
});

describe("the client remount wrapper", () => {
  it("remounts after Community Mods remounts its client mods", async () => {
    const fixture = scene();
    fixture.ns.hooks.install();

    fixture.cmm.remountClientMods("x");
    await flush();

    assert.deepEqual(fixture.cmm.calls.remountClientMods, [["x"]]);
    assert.equal(fixture.runs.length, 1);
  });
});

describe("hooks module", () => {
  it("does not load twice into one scope", () => {
    const { ctx, ns } = sharedScene();
    const first = ns.hooks;

    loadFile(ctx, "shared/hooks.js");

    assert.equal(ctx.GwServerMods.hooks, first);
  });
});
