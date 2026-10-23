"use strict";

// shared/server_ui.js: the server mods' scene scripts, loaded through the
// game's own loader once each, skipping what the scene already listed.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const { flush, loadFile } = require("../scripts/lib/scene-loader.js");
const { resolved } = require("../scripts/lib/fake-jquery.js");

const A = "coui://ui/mods/com.example/live_game/a.js";
const B = "coui://ui/mods/com.example/live_game/b.js";
const C = "coui://ui/mods/com.other/live_game/c.js";
const NOT_GW = "gw_server_mods_not_gw_battle";

function scene(options) {
  const opts = options || {};
  const loads = [];
  const fixture = sharedScene(
    Object.assign({}, opts, {
      cmmOptions: {
        serverMods: [
          mod({ scenes: { live_game: [A, B], shared_build: [C] } }),
          mod({ identifier: "com.other", scenes: { live_game: [C, ""] } }),
        ],
      },
      stubs: Object.assign(
        {
          loadMods:
            opts.loadMods === null
              ? undefined
              : (list) => {
                  loads.push(list);
                  if (opts.loadModsThrows) {
                    throw new Error("boom");
                  }
                },
        },
        opts.stubs
      ),
    })
  );
  if (opts.notGw) {
    fixture.ctx.localStorage.setItem(NOT_GW, "true");
  }
  loadFile(fixture.ctx, "shared/server_ui.js");
  fixture.loads = loads;
  return fixture;
}

// The ko that manifest.load reads Community Mods' installed-mods store through,
// holding one enabled server mod with a live_game script.
function storeKo() {
  const records = [
    mod({ context: "server", enabled: true, scenes: { live_game: [A] } }),
  ];
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

describe("serverUi.load", () => {
  it("loads each scene's scripts once, in mod order, skipping empty entries", () => {
    const fixture = scene();

    assert.deepEqual(fixture.ns.serverUi.load("live_game"), [A, B, C]);
    assert.deepEqual(fixture.ns.serverUi.load("live_game"), []);
    assert.deepEqual(fixture.ns.serverUi.load("shared_build"), []);
    assert.deepEqual(fixture.loads, [[A, B, C]]);
    assert.deepEqual(fixture.ns.serverUi.loaded(), [A, B, C]);
    assert.equal(
      fixture.console.lines.log.includes(
        '[GW-SM] server mod UI loaded {"scene":"live_game","count":3}'
      ),
      true
    );
  });

  it("skips scripts the scene or the global list already carries", () => {
    const fixture = scene({
      stubs: { scene_mod_list: { live_game: [A] }, global_mod_list: [C] },
    });

    assert.deepEqual(fixture.ns.serverUi.load("live_game"), [B]);
  });

  it("loads nothing for a scene no mod declares", () => {
    const fixture = scene();

    assert.deepEqual(fixture.ns.serverUi.load("gw_play"), []);
    assert.deepEqual(fixture.loads, []);
  });

  it("logs and loads nothing without the game's loader", () => {
    const fixture = scene({ loadMods: null });

    assert.deepEqual(fixture.ns.serverUi.load("live_game"), []);
    assert.equal(
      fixture.console.lines.log.includes(
        '[GW-SM] loadMods unavailable; server mod UI not loaded {"scene":"live_game"}'
      ),
      true
    );
  });

  it("logs a loader failure and does not retry the same scripts", () => {
    const fixture = scene({ loadModsThrows: true });

    assert.deepEqual(fixture.ns.serverUi.load("live_game"), [A, B, C]);
    assert.deepEqual(fixture.ns.serverUi.load("live_game"), []);
    assert.equal(
      fixture.console.lines.log.includes(
        "[GW-SM] server mod UI load failed boom live_game"
      ),
      true
    );
  });

  it("reads the persisted scene list where Community Mods is absent", () => {
    const fixture = scene({
      cmm: null,
      stubs: {
        sessionStorage:
          require("../scripts/lib/scene-loader.js").fakeSessionStorage({
            gw_server_mods_scenes: JSON.stringify({ live_game: [A] }),
          }),
      },
    });

    assert.deepEqual(fixture.ns.serverUi.load("live_game"), [A]);
    assert.deepEqual(fixture.codes(), []);
  });

  it("reads the store and loads late when nothing is listed or persisted", async () => {
    const ko = storeKo();
    const fixture = scene({
      cmm: null,
      stubs: { ko, localStorage: { installedModsDB: "1" } },
    });

    assert.deepEqual(fixture.ns.serverUi.load("live_game"), []);
    await flush();

    assert.deepEqual(fixture.loads, [[A]]);
    assert.deepEqual(fixture.ns.serverUi.loaded(), [A]);
    assert.deepEqual(fixture.codes(), []);
  });

  // This client's store names its own active server mods, which a battle
  // hosted elsewhere need not run.
  it("loads nothing outside a Galactic War battle, from a list or the store", async () => {
    const ko = storeKo();
    const listed = scene({ notGw: true });
    const stored = scene({
      cmm: null,
      stubs: {
        ko,
        localStorage: {
          installedModsDB: "1",
          getItem: (key) => (key === NOT_GW ? "true" : null),
        },
      },
    });

    assert.deepEqual(listed.ns.serverUi.load("live_game"), []);
    assert.deepEqual(listed.ns.serverUi.load("shared_build"), []);
    assert.deepEqual(stored.ns.serverUi.load("live_game"), []);
    await flush();

    assert.deepEqual(listed.loads, []);
    assert.deepEqual(stored.loads, []);
    assert.equal(
      listed.console.lines.log.filter(
        (line) =>
          line === "[GW-SM] not a Galactic War battle; server mod UI not loaded"
      ).length,
      1
    );
  });

  // Before the mark existed every battle loaded the list; a storage that
  // cannot be read keeps that.
  it("reads a mark it cannot read as a Galactic War battle", () => {
    const fixture = scene({
      stubs: {
        localStorage: {
          getItem: () => {
            throw new Error("denied");
          },
        },
      },
    });

    assert.deepEqual(fixture.ns.serverUi.load("live_game"), [A, B, C]);
  });

  it("is loaded once per page", () => {
    const fixture = scene();
    const first = fixture.ns.serverUi;

    loadFile(fixture.ctx, "shared/server_ui.js");

    assert.equal(fixture.ns.serverUi, first);
  });
});
