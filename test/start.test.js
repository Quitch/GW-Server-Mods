"use strict";

// connect_to_game/start.js: mount before a Galactic War server starts, then
// declare the server mods on the connection.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const { enginePromise, rejected } = require("../scripts/lib/fake-jquery.js");
const {
  fakeSessionStorage,
  flush,
  loadFile,
} = require("../scripts/lib/scene-loader.js");

const GW_START = { search: "?action=start&mode=gw&content=PAExpansion1" };

function observable(initial, options) {
  const opts = options || {};
  let value = initial;
  return function () {
    if (arguments.length && !opts.readOnly) {
      value = arguments[0];
    }
    return value;
  };
}

function scene(options) {
  const opts = options || {};
  const fixture = sharedScene(
    Object.assign(
      {
        model: { gameModIdentifiers: observable(["com.client"]) },
        cmmOptions: { serverMods: [mod({ identifier: "Com.Server" })] },
        ajax: (url) =>
          url.endsWith("unit_list.json") ? JSON.stringify({ units: [] }) : "",
      },
      opts,
      { stubs: Object.assign({ location: GW_START }, opts.stubs) }
    )
  );
  const runs = [];
  const mount = fixture.ns.mount;
  fixture.ns.mount = Object.assign({}, mount, {
    run: (o) => {
      runs.push(o);
      return opts.pending || mount.run(o);
    },
  });
  fixture.runs = runs;
  loadFile(fixture.ctx, "connect_to_game/start.js");
  return fixture;
}

// The patched call must still answer .always(), which is how stock
// connect_to_game.js:709 reads it.
async function start(fixture, mode) {
  const outcome = { value: undefined, error: undefined, always: 0 };
  fixture.api.net
    .startGame("region", mode, { p: 1 })
    .done((value) => {
      outcome.value = value;
    })
    .fail((error) => {
      outcome.error = error;
    })
    .always(() => {
      outcome.always += 1;
    });
  await flush();
  return outcome;
}

describe("start installation", () => {
  it("installs the hooks and patches startGame", () => {
    const fixture = scene();

    assert.equal(
      fixture.api.file.unmountAllMemoryFiles.__gwServerModsWrapped,
      true
    );
    assert.equal(fixture.api.net.startGame.__gwServerModsPatched, true);
    assert.deepEqual(fixture.codes(), []);
    assert.equal(
      fixture.console.lines.log.includes("[GW-SM] startGame patched"),
      true
    );
  });

  it("raises start_unavailable without api.net.startGame", () => {
    const fixture = scene({ apiOptions: { startGame: false } });
    assert.deepEqual(fixture.alarm("start_unavailable")[0].detail, {
      where: "api.net.startGame",
    });

    const noNet = sharedScene();
    noNet.api.net = null;
    loadFile(noNet.ctx, "connect_to_game/start.js");
    assert.equal(noNet.alarm("start_unavailable").length, 1);
  });

  it("patches once", () => {
    const fixture = scene();
    const patched = fixture.api.net.startGame;

    loadFile(fixture.ctx, "connect_to_game/start.js");

    assert.equal(fixture.api.net.startGame, patched);
  });

  it("logs rather than throws when the shared modules are missing", () => {
    const fixture = sharedScene({ files: ["shared/alarm.js"] });

    loadFile(fixture.ctx, "connect_to_game/start.js");

    assert.match(fixture.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});

describe("which connects install the hooks", () => {
  const SCENES = JSON.stringify({ live_game: ["coui://ui/mods/x/live.js"] });

  function connect(search, sessionValues, localValues) {
    return scene({
      stubs: {
        location: { search: search },
        sessionStorage: fakeSessionStorage(
          Object.assign({ gw_server_mods_scenes: SCENES }, sessionValues)
        ),
        localStorage: fakeSessionStorage(
          Object.assign(
            {
              gw_server_mods_scenes: SCENES,
              gw_server_mods_not_gw_battle: "true",
              gw_server_mods_viewer_host_mods: JSON.stringify(["com.old"]),
            },
            localValues
          )
        ),
      },
    });
  }

  function hooked(fixture) {
    return (
      fixture.api.file.unmountAllMemoryFiles.__gwServerModsWrapped === true
    );
  }

  function assertSkipped(fixture) {
    assert.equal(hooked(fixture), false);
    assert.equal(
      fixture.cmm.remountClientMods.__gwServerModsWrapped,
      undefined
    );
    assert.equal(
      "gw_server_mods_scenes" in fixture.ctx.localStorage.store,
      false
    );
    assert.equal(
      "gw_server_mods_scenes" in fixture.ctx.sessionStorage.store,
      false
    );
    assert.equal(fixture.ns.manifest.gwBattle(), false);
    assert.equal(
      "gw_server_mods_viewer_host_mods" in fixture.ctx.localStorage.store,
      false
    );
    assert.deepEqual(fixture.ns.manifest.scenes("live_game"), []);
    assert.equal(
      fixture.console.lines.log.includes(
        "[GW-SM] not a Galactic War connect; hooks not installed"
      ),
      true
    );
    assert.deepEqual(fixture.codes(), []);
    assert.equal(fixture.api.net.startGame.__gwServerModsPatched, true);
  }

  it("installs them when this client starts a Galactic War server", () => {
    for (const mode of ["gw", "coop_gw", "gw_campaign", "coop%5Fgw"]) {
      const fixture = connect("?action=start&mode=" + mode + "&local=true");

      assert.equal(hooked(fixture), true, mode);
      assert.equal(
        "gw_server_mods_not_gw_battle" in fixture.ctx.localStorage.store,
        false,
        mode
      );
      // A viewer's reconnect is asked for no manifest, so the list must stay.
      assert.equal(
        "gw_server_mods_viewer_host_mods" in fixture.ctx.localStorage.store,
        true,
        mode
      );
      assert.equal(
        fixture.ctx.localStorage.store.gw_server_mods_scenes,
        SCENES
      );
    }
  });

  it("skips them and forgets the scene list for any other start", () => {
    for (const search of [
      "?action=start&local=true&content=PAExpansion1",
      "?action=start&mode=Config",
      "?action=start&mode=loadsave&replayid=7",
      "?action=start&mode=gw+campaign",
    ]) {
      assertSkipped(
        connect(
          search,
          { game_server_setup: JSON.stringify("gw_campaign") },
          { gw_server_mods_not_gw_battle: "false" }
        )
      );
    }
  });

  it("installs them for a join the previous scene marked as Galactic War", () => {
    const marks = [
      [{ game_server_setup: JSON.stringify("gw_campaign") }, {}],
      [
        {
          game_server_setup: JSON.stringify("game"),
          game_type: JSON.stringify("GalacticWar"),
        },
        {},
      ],
      [
        {},
        { reconnect_to_game_info: JSON.stringify({ setup: "gw_campaign" }) },
      ],
      [{}, { reconnect_to_game_info: JSON.stringify({ game: "GalacticWar" }) }],
    ];

    for (const [sessionValues, localValues] of marks) {
      const fixture = connect(
        "?content=PAExpansion1",
        sessionValues,
        localValues
      );

      assert.equal(hooked(fixture), true, JSON.stringify(marks));
    }
  });

  it("installs them when a Galactic War battle resumes from its save", () => {
    const search = "?action=start&mode=loadsave&loadpath=gw.pas&local=true";

    for (const page of [
      "coui://ui/main/game/galactic_war/gw_play/gw_play.html",
      "coui://ui/main/game/galactic_war/gw_play/gw_play.html?gw_campaign=1",
    ]) {
      assert.equal(
        hooked(
          connect(search, { connect_fail_destination: JSON.stringify(page) })
        ),
        true,
        page
      );
    }

    assertSkipped(
      connect(search, {
        connect_fail_destination: JSON.stringify(
          "coui://ui/main/game/start/start.html"
        ),
      })
    );
  });

  it("lets a set game_server_setup outrank the reconnect record", () => {
    assertSkipped(
      connect(
        "?content=PAExpansion1",
        {
          game_server_setup: JSON.stringify("game"),
          game_type: JSON.stringify("FreeForAll"),
        },
        {
          reconnect_to_game_info: JSON.stringify({
            setup: "gw_campaign",
            game: "GalacticWar",
          }),
        }
      )
    );
  });

  it("reads the engine's session backup when sessionStorage has no value", () => {
    function joined(backup, sessionValues, localValues) {
      const fixture = scene({
        stubs: {
          location: { search: "?content=PAExpansion1" },
          sessionStorage: fakeSessionStorage(sessionValues),
          localStorage: fakeSessionStorage(localValues),
          gSessionBackup: backup,
        },
      });
      return hooked(fixture);
    }

    assert.equal(
      joined({
        game_server_setup: JSON.stringify("game"),
        game_type: JSON.stringify("GalacticWar"),
      }),
      true
    );
    assert.equal(joined({ game_server_setup: "gw_campaign" }), true);
    assert.equal(
      joined(
        { game_server_setup: "undefined" },
        {},
        { reconnect_to_game_info: JSON.stringify({ game: "GalacticWar" }) }
      ),
      true
    );
    assert.equal(joined({ game_server_setup: 7 }), false);
    assert.equal(
      joined(
        { game_type: JSON.stringify("GalacticWar") },
        {
          game_server_setup: JSON.stringify("game"),
          game_type: JSON.stringify("Waiting"),
        }
      ),
      false
    );
    assert.equal(
      joined(
        { game_server_setup: JSON.stringify("gw_campaign") },
        { game_server_setup: "null" }
      ),
      false
    );
  });

  it("reads a malformed escape in the URL as it stands", () => {
    assertSkipped(connect("?action=start&mode=%E0"));
    assert.equal(hooked(connect("?action=start&mode=coop%E0gw")), true);
  });

  it("skips them for any other join", () => {
    assertSkipped(
      connect(
        "?content=PAExpansion1",
        {
          game_server_setup: JSON.stringify("game"),
          game_type: JSON.stringify("Waiting"),
        },
        { reconnect_to_game_info: JSON.stringify(false) }
      )
    );
    assertSkipped(connect("", { game_server_setup: "{" }));
  });

  it("reads no URL as a join", () => {
    const fixture = scene({ stubs: { location: undefined } });

    assert.equal(hooked(fixture), false);
  });

  it("logs rather than throws when the battle cannot be marked", () => {
    const fixture = scene({
      stubs: {
        location: { search: "?action=start" },
        localStorage: fakeSessionStorage({}, { setItemThrows: true }),
      },
    });

    assert.equal(hooked(fixture), false);
    assert.equal(
      fixture.console.lines.log.includes(
        '[GW-SM] battle mark not stored {"error":"Error: QuotaExceededError"}'
      ),
      true
    );
  });

  it("logs rather than throws when the scene list cannot be cleared", () => {
    const fixture = scene({
      stubs: {
        location: { search: "?action=start" },
        localStorage: { getItem: () => null },
      },
    });

    assert.equal(hooked(fixture), false);
    assert.match(
      fixture.console.lines.log.find((line) =>
        line.startsWith("[GW-SM] server mod scene list not cleared")
      ),
      /\{"error":"TypeError: .*"\}$/
    );
  });
});

describe("the patched startGame", () => {
  it("starts other modes directly", () => {
    const fixture = scene();

    for (const mode of ["ladder", "Custom", undefined, 42]) {
      fixture.api.net.startGame("region", mode, {});
    }

    assert.equal(fixture.runs.length, 0);
    assert.equal(fixture.api.calls.startGame.length, 4);
  });

  it("starts directly when mods are disabled", () => {
    const fixture = scene({ stubs: { gNoMods: true } });

    fixture.api.net.startGame("region", "gw", {});

    assert.equal(fixture.runs.length, 0);
  });

  it("mounts first for any mode ending in gw, then declares the server mods", async () => {
    for (const mode of ["gw", "GW", "coop_gw"]) {
      const fixture = scene();

      const outcome = await start(fixture, mode);

      assert.deepEqual(fixture.runs, [undefined]);
      assert.deepEqual(fixture.api.calls.startGame, [
        ["region", mode, { p: 1 }],
      ]);
      assert.equal(outcome.value, "started");
      assert.equal(outcome.always, 1);
      assert.deepEqual(fixture.model.gameModIdentifiers(), [
        "com.client",
        "Com.Server",
      ]);
      assert.deepEqual(fixture.codes(), []);
    }
  });

  it("waits for the mount before starting", async () => {
    const pending = enginePromise();
    const fixture = scene({ pending });

    const outcome = start(fixture, "gw");
    await flush();
    assert.equal(fixture.api.calls.startGame.length, 0);

    pending.resolve(false);
    await flush();
    assert.equal(fixture.api.calls.startGame.length, 1);
    assert.equal((await outcome).always, 1);
  });

  it("starts even after a mount that failed", async () => {
    const pending = enginePromise();
    const fixture = scene({ pending });

    const outcome = start(fixture, "gw");
    pending.reject("mount broke");

    assert.equal((await outcome).value, "started");
  });

  it("rejects when the start rejects", async () => {
    const fixture = scene({
      apiOptions: { startGame: () => rejected("refused") },
    });

    const outcome = await start(fixture, "gw");

    assert.equal(outcome.error, "refused");
    assert.equal(outcome.always, 1);
    assert.deepEqual(fixture.model.gameModIdentifiers(), ["com.client"]);
  });

  it("accepts a start that returns a plain value", async () => {
    const fixture = scene({ apiOptions: { startGame: () => "plain" } });

    assert.equal((await start(fixture, "gw")).value, "plain");
  });
});

describe("declaring the identifiers", () => {
  it("does nothing without the list or without server mods", async () => {
    const noList = scene({ model: {} });
    assert.equal((await start(noList, "gw")).value, "started");

    const noModel = scene({ model: null });
    noModel.ctx.model = null;
    assert.equal((await start(noModel, "gw")).value, "started");

    const noMods = scene({ cmmOptions: { serverMods: [] } });
    await start(noMods, "gw");
    assert.deepEqual(noMods.model.gameModIdentifiers(), ["com.client"]);
  });

  it("starts from an empty list and does not repeat an identifier", async () => {
    const fixture = scene({ model: { gameModIdentifiers: observable(null) } });
    await start(fixture, "gw");
    assert.deepEqual(fixture.model.gameModIdentifiers(), ["Com.Server"]);

    const already = scene({
      model: { gameModIdentifiers: observable(["Com.Server"]) },
    });
    await start(already, "gw");
    assert.deepEqual(already.model.gameModIdentifiers(), ["Com.Server"]);
  });

  it("raises identifiers_lost when the list does not keep them", async () => {
    const fixture = scene({
      model: {
        gameModIdentifiers: observable(["com.client"], { readOnly: true }),
      },
    });

    await start(fixture, "gw");

    assert.deepEqual(fixture.alarm("identifiers_lost")[0].detail, {
      expected: ["Com.Server"],
      applied: ["com.client"],
    });
  });

  it("raises identifiers_lost when the list reads back as nothing", async () => {
    let reads = 0;
    const fixture = scene({
      model: {
        gameModIdentifiers: function () {
          reads += 1;
          return reads > 2 ? null : [];
        },
      },
    });

    await start(fixture, "gw");

    assert.equal(fixture.alarm("identifiers_lost")[0].detail.applied.length, 0);
  });
});
