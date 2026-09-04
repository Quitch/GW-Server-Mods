"use strict";

// shared/capability.js: the host's required-mod set as other mods query it.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const {
  fakeSessionStorage,
  loadFile,
} = require("../scripts/lib/scene-loader.js");

const KEY = "gw_server_mods_host_identifiers";

describe("capability.remember", () => {
  it("normalises the identifiers, persists the set and returns it", () => {
    const { ns, ctx } = sharedScene();

    const stored = ns.capability.remember(
      ["Com.A", " com.b "],
      { "com.a": "A" },
      { "com.a": "1.0" }
    );

    assert.deepEqual(stored, {
      identifiers: ["com.a", "com.b"],
      namesById: { "com.a": "A" },
      versionsById: { "com.a": "1.0" },
    });
    assert.deepEqual(JSON.parse(ctx.sessionStorage.store[KEY]), stored);
  });

  it("accepts missing arguments", () => {
    const { ns } = sharedScene();

    assert.deepEqual(ns.capability.remember(), {
      identifiers: [],
      namesById: {},
      versionsById: {},
    });
  });

  it("keeps the set for the scene when it cannot be persisted", () => {
    const fixture = sharedScene({
      stubs: {
        sessionStorage: fakeSessionStorage({}, { setItemThrows: true }),
      },
    });

    fixture.ns.capability.remember(["com.a"]);

    assert.equal(fixture.ns.hostRequiresMod("com.a"), true);
    assert.deepEqual(fixture.console.lines.log, [
      "[GW-SM] host mod set not persisted",
    ]);
  });
});

describe("hostRequiresMod", () => {
  it("answers by normalised identifier and never for an empty one", () => {
    const { ns } = sharedScene();
    ns.capability.remember(["Com.A"]);

    assert.equal(ns.hostRequiresMod("com.a"), true);
    assert.equal(ns.hostRequiresMod(" COM.A "), true);
    assert.equal(ns.hostRequiresMod("com.b"), false);
    assert.equal(ns.hostRequiresMod(""), false);
    assert.equal(ns.hostRequiresMod(undefined), false);
  });

  it("reads what another scene persisted, once", () => {
    const storage = fakeSessionStorage({
      [KEY]: JSON.stringify({
        identifiers: ["com.a"],
        namesById: {},
        versionsById: {},
      }),
    });
    const { ns } = sharedScene({ stubs: { sessionStorage: storage } });

    assert.equal(ns.hostRequiresMod("com.a"), true);
    storage.store[KEY] = JSON.stringify({
      identifiers: [],
      namesById: {},
      versionsById: {},
    });
    assert.equal(ns.hostRequiresMod("com.a"), true);
  });

  it("starts empty when nothing or something corrupt was persisted", () => {
    assert.equal(sharedScene().ns.hostRequiresMod("com.a"), false);
    assert.equal(
      sharedScene({
        stubs: { sessionStorage: fakeSessionStorage({ [KEY]: "{oops" }) },
      }).ns.hostRequiresMod("com.a"),
      false
    );
  });
});

describe("hostServerMods", () => {
  it("describes each remembered identifier, falling back to the identifier and an empty version", () => {
    const { ns } = sharedScene();
    ns.capability.remember(
      ["com.a", "com.b"],
      { "com.a": "A" },
      { "com.a": "1.0" }
    );

    assert.deepEqual(ns.hostServerMods(), [
      { identifier: "com.a", displayName: "A", version: "1.0" },
      { identifier: "com.b", displayName: "com.b", version: "" },
    ]);
  });
});

describe("capability module", () => {
  it("does not load twice into one scope", () => {
    const { ctx, ns } = sharedScene();
    const first = ns.capability;

    loadFile(ctx, "shared/capability.js");

    assert.equal(ctx.GwServerMods.capability, first);
  });
});
