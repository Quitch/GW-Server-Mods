"use strict";

// shared/mount.js: the mount sequence, the merged unit list and the probes
// that decide whether a run counts as mounted.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const {
  Deferred,
  enginePromise,
  rejected,
  resolved,
} = require("../scripts/lib/fake-jquery.js");
const {
  fakeSessionStorage,
  flush,
  loadFile,
} = require("../scripts/lib/scene-loader.js");

const ROOT_LIST = "coui://pa/units/unit_list.json";
const MOD_LIST =
  "spec://server_mods/com.example.server/pa/units/unit_list.json";

// The responses a healthy install gives: a unit list wherever one is asked
// for, and an empty body for every probe.
function unitLists(byUrl) {
  return (url) => {
    if (url in byUrl) {
      return byUrl[url];
    }
    if (url.endsWith("unit_list.json")) {
      return JSON.stringify({ units: [] });
    }
    return "";
  };
}

function scene(options) {
  const opts = options || {};
  const lists = Object.assign(
    {
      [ROOT_LIST]: JSON.stringify({ units: ["/pa/units/a.json"] }),
      [MOD_LIST]: JSON.stringify({ units: ["/pa/units/b.json"] }),
    },
    opts.lists
  );
  return sharedScene(
    Object.assign(
      { ajax: opts.ajax || unitLists(lists) },
      { cmmOptions: { serverMods: [mod()] } },
      opts
    )
  );
}

function run(fixture, options) {
  return fixture.ns.mount.run(options);
}

function stages(fixture) {
  const reported = [];
  fixture.model.gwoLaunchProgress = { stage: (key) => reported.push(key) };
  return reported;
}

describe("mount.run", () => {
  // A caller identifies a promise by a `promise` method, which neither an
  // engine promise nor a native one has, so what leaves the mod must be
  // jQuery. GWO waits on this one. See design.md.
  it("hands back a promise a caller's $.when waits for", async () => {
    const fixture = scene();
    const waited = [];
    const running = run(fixture);

    assert.equal(typeof running.promise, "function");
    fixture.$.when(running).always(() => waited.push("settled"));
    assert.deepEqual(waited, []);

    await running;
    assert.deepEqual(waited, ["settled"]);
  });

  it("resolves false without touching anything when Community Mods is absent", async () => {
    const fixture = scene({ cmm: null });

    assert.equal(await run(fixture), false);
    assert.deepEqual(fixture.codes(), []);
    assert.equal(fixture.ns.mount.sequence(), 0);
  });

  it("raises cmm_unavailable when zips cannot be mounted", async () => {
    const fixture = scene({ apiOptions: { zipMount: false } });

    assert.equal(await run(fixture), false);
    assert.deepEqual(fixture.alarm("cmm_unavailable")[0].detail, {
      where: "api.file.zip.mount",
    });
  });

  it("counts a run with no server mods as mounted", async () => {
    const fixture = scene({ cmmOptions: { serverMods: [] } });

    assert.equal(await run(fixture), true);
    const state = fixture.ns.mount.state();
    assert.equal(state.mounted, true);
    assert.deepEqual(state.mods, []);
    assert.equal(state.sequence, 1);
    assert.equal(typeof state.at, "number");
    assert.equal(fixture.cmm.calls.mountServerMods, 0);
  });

  it("mounts, registers, merges, classifies and verifies one zip mod", async () => {
    const fixture = scene();
    const reported = stages(fixture);

    assert.equal(await run(fixture), true);

    assert.deepEqual(fixture.api.calls.zipMount, [
      ["/download/com.example.server.zip", "/", false],
    ]);
    assert.equal(fixture.cmm.calls.mountServerMods, 1);
    assert.equal(fixture.api.calls.remount.length, 1);
    assert.deepEqual(reported, [
      "!LOC:Mounting server mods",
      "!LOC:Registering server mod content",
    ]);
    assert.deepEqual(
      fixture.$.ajaxCalls.map((call) => [call.url, call.cache]),
      [
        [ROOT_LIST, false],
        [MOD_LIST, true],
        ["coui://server_mods/mods.json", false],
        ["coui://server_mods/com.example.server/modinfo.json", false],
        ["spec://pa/units/unit_list.json", true],
      ]
    );
    assert.deepEqual(fixture.api.calls.mountMemoryFiles, [
      [
        {
          "/pa/units/unit_list.json": JSON.stringify({
            units: ["/pa/units/a.json", "/pa/units/b.json"],
          }),
        },
      ],
    ]);
    assert.deepEqual(fixture.codes(), []);
    const state = fixture.ns.mount.state();
    assert.equal(state.mounted, true);
    assert.equal(state.sequence, 1);
    assert.equal(state.mods[0].identifier, "com.example.server");
    assert.equal(
      fixture.console.lines.log.at(-1),
      '[GW-SM] mounted server mods {"ok":true,"count":1}'
    );
  });

  it("root-mounts the paired client mods too", async () => {
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod({ companions: ["com.client"] })],
        clientMods: [
          mod({
            identifier: "com.client",
            installedPath: "/download/client.zip",
          }),
        ],
      },
    });

    await run(fixture);

    assert.deepEqual(
      fixture.api.calls.zipMount.map((call) => call[0]),
      ["/download/com.example.server.zip", "/download/client.zip"]
    );
  });

  it("leaves the renderer alone during a battle", async () => {
    const fixture = scene();
    const reported = stages(fixture);

    assert.equal(await run(fixture, { remountContent: false }), true);

    assert.equal(fixture.api.calls.remount.length, 0);
    assert.deepEqual(reported, ["!LOC:Mounting server mods"]);
  });

  // The bug this file's rewrite came from: api.content.remount() is an engine
  // promise, and $.when read it as a plain value, so the mount reported itself
  // complete while the engine was still registering models and textures.
  it("does not report the mount complete until the content is registered", async () => {
    const pending = enginePromise();
    const fixture = scene({ apiOptions: { remount: () => pending } });
    let outcome;

    fixture.ns.mount.run().then((ok) => {
      outcome = ok;
    });
    await flush();

    assert.equal(fixture.api.calls.remount.length, 1);
    assert.equal(outcome, undefined);
    assert.equal(fixture.ns.mount.sequence(), 0);

    pending.resolve();
    await flush();

    assert.equal(outcome, true);
    assert.equal(fixture.ns.mount.sequence(), 1);
  });

  // Same fault, and this one loses units: the referee reads the merged list, so
  // a run that settled before mountMemoryFiles finished could hand it the
  // unmerged one.
  it("does not report the mount complete until the merged list is mounted", async () => {
    const pending = enginePromise();
    const fixture = scene({ apiOptions: { mountMemoryFiles: () => pending } });
    let outcome;

    fixture.ns.mount.run().then((ok) => {
      outcome = ok;
    });
    await flush();

    assert.equal(fixture.api.calls.mountMemoryFiles.length, 1);
    assert.equal(outcome, undefined);
    assert.equal(
      fixture.console.lines.log.some((line) =>
        line.startsWith("[GW-SM] merged unit list")
      ),
      false
    );

    pending.resolve();
    await flush();

    assert.equal(outcome, true);
    assert.equal(
      fixture.console.lines.log.includes(
        '[GW-SM] merged unit list {"units":2,"lists":1}'
      ),
      true
    );
  });

  it("raises content_remount_unavailable when the engine cannot register content", async () => {
    const fixture = scene({ apiOptions: { remount: false } });

    assert.equal(await run(fixture), true);
    assert.deepEqual(fixture.codes(), ["content_remount_unavailable"]);
  });

  it("raises zip_missing for an undownloaded zip and carries on", async () => {
    const fixture = scene({
      cmmOptions: { serverMods: [mod({ installedPath: "" })] },
    });

    assert.equal(await run(fixture), true);
    assert.deepEqual(fixture.alarm("zip_missing")[0].detail, {
      identifier: "com.example.server",
    });
    assert.equal(fixture.api.calls.zipMount.length, 0);
    assert.equal(fixture.cmm.calls.mountServerMods, 1);
  });

  it("raises mount_failed when the zip mount refuses or throws", async () => {
    const refused = scene({ apiOptions: { zipMount: () => resolved(false) } });
    await run(refused);
    assert.deepEqual(refused.alarm("mount_failed")[0].detail, {
      identifier: "com.example.server",
      path: "/download/com.example.server.zip",
    });

    const thrown = scene({
      apiOptions: { zipMount: () => rejected("bad zip") },
    });
    await run(thrown);
    assert.equal(thrown.alarm("mount_failed").length, 1);
  });

  it("does not mount a folder mod and raises filesystem_server_mod only when the client needs it", async () => {
    const folder = mod({ fileSystem: true, installedPath: "/mods/folder/" });
    const relevant = scene({
      cmmOptions: { serverMods: [folder] },
      apiOptions: { list: () => resolved(["/mods/folder/pa/units/"]) },
    });

    await run(relevant);

    assert.equal(relevant.api.calls.zipMount.length, 0);
    assert.deepEqual(relevant.alarm("filesystem_server_mod")[0].detail, {
      identifier: "com.example.server",
      path: "/mods/folder/",
    });
    assert.equal(
      relevant.$.ajaxCalls.some(
        (call) => call.url === "coui://mods/folder/modinfo.json"
      ),
      true
    );
    assert.equal(relevant.api.calls.mountMemoryFiles.length, 0);

    const aiOnly = scene({
      cmmOptions: { serverMods: [folder] },
      apiOptions: { list: () => resolved(["/mods/folder/pa/ai/"]) },
    });
    await run(aiOnly);
    assert.deepEqual(aiOnly.codes(), []);
  });

  it("raises probe_failed and reports not mounted when a file cannot be read back", async () => {
    const fixture = scene({
      ajax: (url) => {
        if (url === "coui://server_mods/com.example.server/modinfo.json") {
          throw new Error("404");
        }
        return url.endsWith("unit_list.json")
          ? JSON.stringify({ units: [] })
          : "";
      },
    });

    assert.equal(await run(fixture), false);
    assert.deepEqual(fixture.alarm("probe_failed")[0].detail, {
      manifest: true,
      mods: [false],
      unitList: true,
    });
    assert.equal(fixture.ns.mount.state().mounted, false);
    assert.equal(fixture.ns.mount.sequence(), 1);
  });

  it("shares one run between concurrent callers and starts a new one afterwards", async () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = fixture.ns.mount.run();
    const second = fixture.ns.mount.run();
    assert.equal(first, second);
    await flush();
    assert.equal(fixture.ns.mount.sequence(), 0);

    pending.resolve();
    await flush();
    assert.equal(fixture.ns.mount.sequence(), 1);

    assert.notEqual(fixture.ns.mount.run(), first);
    await flush();
    assert.equal(fixture.ns.mount.sequence(), 2);
  });

  // A run with nothing to mount settles on the next microtask; it must still
  // clear, or every later call would hand back that first promise.
  it("starts a fresh run after one that settled at once", async () => {
    const fixture = scene({ cmmOptions: { serverMods: [] } });

    const first = fixture.ns.mount.run();
    await flush();

    assert.notEqual(fixture.ns.mount.run(), first);
    await flush();
    assert.equal(fixture.ns.mount.sequence(), 2);
  });

  // gw_play mounts without the remount, so the Fight click arriving while that
  // run is still open must not inherit a run that left the models unregistered.
  it("queues a content caller behind a run that skipped the remount", async () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = fixture.ns.mount.run({ remountContent: false });
    const second = fixture.ns.mount.run();

    assert.notEqual(first, second);
    await flush();
    assert.equal(fixture.api.calls.remount.length, 0);
    assert.equal(fixture.ns.mount.sequence(), 0);

    pending.resolve();
    await flush();

    assert.equal(fixture.ns.mount.sequence(), 2);
    assert.equal(fixture.api.calls.remount.length, 1);
    assert.equal(await run(fixture, { remountContent: false }), true);
  });

  it("shares a run that remounts with a caller that does not need it", async () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = fixture.ns.mount.run();

    assert.equal(fixture.ns.mount.run({ remountContent: false }), first);
    assert.equal(fixture.ns.mount.run(), first);

    pending.resolve();
    await flush();

    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.api.calls.remount.length, 1);
  });

  it("shares one contentless run between contentless callers", async () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = fixture.ns.mount.run({ remountContent: false });

    assert.equal(fixture.ns.mount.run({ remountContent: false }), first);

    pending.resolve();
    await flush();

    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.api.calls.remount.length, 0);
  });

  // The queued run supersedes the one it waits on, so the run it replaced must
  // not clear it on the way out.
  it("holds the queued run open until it settles", async () => {
    const first = Deferred();
    const second = Deferred();
    const responses = [first, second];
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => responses.shift().promise(),
      },
    });

    fixture.ns.mount.run({ remountContent: false });
    const queued = fixture.ns.mount.run();

    first.resolve();
    await flush();

    assert.equal(fixture.ns.mount.run(), queued);
    assert.equal(fixture.ns.mount.sequence(), 1);

    second.resolve();
    await flush();

    assert.equal(fixture.ns.mount.sequence(), 2);
    assert.notEqual(fixture.ns.mount.run(), queued);
  });

  it("persists the classification for the gate", async () => {
    const storage = fakeSessionStorage();
    const fixture = scene({
      stubs: { sessionStorage: storage },
      apiOptions: {
        list: () => resolved(["/server_mods/com.example.server/pa/units/"]),
      },
    });

    await run(fixture);

    assert.deepEqual(JSON.parse(storage.store.gw_server_mods_relevance), {
      "com.example.server": true,
    });
  });
});

describe("the merged unit list", () => {
  it("is skipped when Community Mods has the merge disabled", async () => {
    const fixture = scene({
      cmmOptions: { serverMods: [mod()], mergeUnitServerMods: false },
    });

    await run(fixture);

    // The base list is still captured - that read belongs to the mount, not the
    // merge - but no mod list is read and nothing is written.
    assert.equal(
      fixture.$.ajaxCalls.filter((call) => call.url === ROOT_LIST).length,
      1
    );
    assert.equal(
      fixture.$.ajaxCalls.some((call) => call.url === MOD_LIST),
      false
    );
    assert.equal(fixture.api.calls.mountMemoryFiles.length, 0);
    assert.equal(
      fixture.console.lines.log.includes(
        "[GW-SM] unit list merge disabled by Community Mods"
      ),
      true
    );
  });

  // The regression this cache exists for: every faction ships its own
  // unit_list.json and they all mount at "/", so a read taken after the mounts
  // returns one faction's list. A base unit that faction omits was lost.
  it("keeps a base unit that no active mod lists", async () => {
    const fixture = scene({
      lists: {
        [ROOT_LIST]: JSON.stringify({
          units: ["/pa/units/base.json", "/pa/units/omitted.json"],
        }),
        [MOD_LIST]: JSON.stringify({
          units: ["/pa/units/base.json", "/pa/units/faction.json"],
        }),
      },
    });

    await run(fixture);

    const written = JSON.parse(
      fixture.api.calls.mountMemoryFiles[0][0]["/pa/units/unit_list.json"]
    );
    assert.deepEqual(written.units.sort(), [
      "/pa/units/base.json",
      "/pa/units/faction.json",
      "/pa/units/omitted.json",
    ]);
  });

  // gw_start captures it; gw_play is a different page with a fresh module scope
  // and must not re-read, because by then its own mounts shadow the path.
  it("reuses a base list captured in an earlier scene", async () => {
    const storage = fakeSessionStorage({
      gw_server_mods_vanilla_units: JSON.stringify(["/pa/units/base.json"]),
    });
    const fixture = scene({ stubs: { sessionStorage: storage } });

    await run(fixture);

    assert.equal(
      fixture.$.ajaxCalls.some((call) => call.url === ROOT_LIST),
      false
    );
    const written = JSON.parse(
      fixture.api.calls.mountMemoryFiles[0][0]["/pa/units/unit_list.json"]
    );
    assert.equal(written.units.indexOf("/pa/units/base.json") !== -1, true);
  });

  it("re-reads the base list when the stored one is corrupt", async () => {
    const storage = fakeSessionStorage({
      gw_server_mods_vanilla_units: "{not json",
    });
    const fixture = scene({ stubs: { sessionStorage: storage } });

    assert.equal(await run(fixture), true);
    assert.equal(
      fixture.$.ajaxCalls.some((call) => call.url === ROOT_LIST),
      true
    );
  });

  it("persists the base list for the scenes that follow", async () => {
    const storage = fakeSessionStorage();
    const fixture = scene({ stubs: { sessionStorage: storage } });

    await run(fixture);

    assert.deepEqual(JSON.parse(storage.store.gw_server_mods_vanilla_units), [
      "/pa/units/a.json",
    ]);
  });

  it("merges from memory when the base list cannot be persisted", async () => {
    const storage = fakeSessionStorage(undefined, { setItemThrows: true });
    const fixture = scene({ stubs: { sessionStorage: storage } });

    assert.equal(await run(fixture), true);
    assert.equal(
      fixture.console.lines.log.includes(
        "[GW-SM] base unit list not persisted"
      ),
      true
    );
    const written = JSON.parse(
      fixture.api.calls.mountMemoryFiles[0][0]["/pa/units/unit_list.json"]
    );
    assert.equal(written.units.indexOf("/pa/units/a.json") !== -1, true);
  });

  it("reads the base list once and reuses it across runs", async () => {
    const fixture = scene();

    await run(fixture);
    await run(fixture);
    await flush();

    assert.equal(
      fixture.$.ajaxCalls.filter((call) => call.url === ROOT_LIST).length,
      1
    );
    assert.equal(fixture.api.calls.mountMemoryFiles.length, 2);
  });

  // A base list that cannot be read costs units in one faction combination. It
  // must not cost the mount.
  it("still merges the mod lists when the base list cannot be read", async () => {
    const fixture = scene({
      ajax: (url) => {
        if (url === ROOT_LIST) {
          throw new Error("404");
        }
        if (url === MOD_LIST) {
          return JSON.stringify({ units: ["/pa/units/faction.json"] });
        }
        return "";
      },
    });

    assert.equal(await run(fixture), true);
    const written = JSON.parse(
      fixture.api.calls.mountMemoryFiles[0][0]["/pa/units/unit_list.json"]
    );
    assert.deepEqual(written.units, ["/pa/units/faction.json"]);
    assert.equal(
      fixture.console.lines.log.includes("[GW-SM] base unit list not read"),
      true
    );
  });

  it("still merges when Community Mods leaves the merge enabled", async () => {
    const fixture = scene({
      cmmOptions: { serverMods: [mod()], mergeUnitServerMods: true },
    });

    await run(fixture);

    assert.equal(fixture.api.calls.mountMemoryFiles.length, 1);
  });

  it("is not written when no mod ships a readable list", async () => {
    const fixture = scene({
      lists: { [MOD_LIST]: "{not json" },
    });

    await run(fixture);

    assert.equal(fixture.api.calls.mountMemoryFiles.length, 0);
    assert.deepEqual(fixture.codes(), []);
  });

  it("ignores a list without a units array and a root list that cannot be read", async () => {
    const fixture = scene({
      ajax: (url) => {
        if (url === ROOT_LIST) {
          throw new Error("missing");
        }
        if (url === MOD_LIST) {
          return JSON.stringify({ units: ["/pa/units/b.json"] });
        }
        if (url.endsWith("unit_list.json")) {
          return JSON.stringify({ nope: true });
        }
        return "";
      },
    });

    await run(fixture);

    assert.deepEqual(fixture.api.calls.mountMemoryFiles, [
      [
        {
          "/pa/units/unit_list.json": JSON.stringify({
            units: ["/pa/units/b.json"],
          }),
        },
      ],
    ]);
  });

  it("dedupes across lists and accepts an already parsed response", async () => {
    const fixture = scene({
      ajax: (url) => {
        if (url === ROOT_LIST) {
          return { units: ["/pa/units/a.json", "/pa/units/b.json"] };
        }
        if (url === MOD_LIST) {
          return JSON.stringify({
            units: ["/pa/units/b.json", "/pa/units/c.json"],
          });
        }
        return url.endsWith("unit_list.json")
          ? JSON.stringify({ units: [] })
          : "";
      },
    });

    await run(fixture);

    assert.deepEqual(
      JSON.parse(
        fixture.api.calls.mountMemoryFiles[0][0]["/pa/units/unit_list.json"]
      ).units,
      ["/pa/units/a.json", "/pa/units/b.json", "/pa/units/c.json"]
    );
    assert.equal(
      fixture.console.lines.log.includes(
        '[GW-SM] merged unit list {"units":3,"lists":1}'
      ),
      true
    );
  });

  it("only logs when one list could not be written, but alarms for several", async () => {
    const one = scene({ apiOptions: { mountMemoryFiles: false } });
    await run(one);
    assert.deepEqual(one.codes(), []);
    assert.equal(
      one.console.lines.log.includes(
        '[GW-SM] unit list not merged {"units":2,"lists":1,"reason":"mountMemoryFiles unavailable"}'
      ),
      true
    );

    const secondList = "spec://server_mods/com.second/pa/units/unit_list.json";
    const two = scene({
      cmmOptions: { serverMods: [mod(), mod({ identifier: "com.second" })] },
      lists: { [secondList]: JSON.stringify({ units: ["/pa/units/c.json"] }) },
      apiOptions: { mountMemoryFiles: () => rejected("refused") },
    });
    await run(two);
    assert.deepEqual(two.alarm("unit_list_unmerged")[0].detail, {
      units: 3,
      lists: 2,
      reason: "refused",
    });
  });

  // The root-only zip mounts land at "/" after the memory file and re-shadow
  // it, so the run must put the merged list back on top before it settles.
  it("goes back on top after a root-only run re-shadows it", async () => {
    const gate = Deferred();
    let gated = false;
    const fixture = scene({
      apiOptions: {
        zipMount: () => (gated ? gate.promise() : resolved(true)),
      },
    });

    assert.equal(await run(fixture), true);
    assert.equal(fixture.api.calls.mountMemoryFiles.length, 1);
    gated = true;

    const rootOnly = run(fixture, { rootOnly: true, remountContent: false });
    await flush();
    assert.equal(fixture.api.calls.mountMemoryFiles.length, 1);

    gate.resolve(true);
    assert.equal(await rootOnly, true);
    assert.equal(fixture.api.calls.mountMemoryFiles.length, 2);
    assert.deepEqual(
      fixture.api.calls.mountMemoryFiles[1],
      fixture.api.calls.mountMemoryFiles[0]
    );
    // Restored from the cache, not re-merged.
    assert.equal(
      fixture.$.ajaxCalls.filter((call) => call.url === MOD_LIST).length,
      1
    );
    assert.equal(
      fixture.console.lines.log.includes(
        '[GW-SM] restored merged unit list {"units":2,"lists":1}'
      ),
      true
    );
  });

  it("is not written by a root-only run before any merge", async () => {
    const fixture = scene();

    assert.equal(
      await run(fixture, { rootOnly: true, remountContent: false }),
      true
    );
    assert.equal(fixture.api.calls.mountMemoryFiles.length, 0);
  });

  it("reports a restore the engine refused", async () => {
    let mounts = 0;
    const fixture = scene({
      apiOptions: {
        mountMemoryFiles: () => (++mounts === 1 ? undefined : rejected("no")),
      },
    });

    assert.equal(await run(fixture), true);
    assert.equal(
      await run(fixture, { rootOnly: true, remountContent: false }),
      true
    );
    assert.deepEqual(fixture.codes(), []);
    assert.equal(
      fixture.console.lines.log.includes(
        '[GW-SM] unit list not merged {"units":2,"lists":1,"reason":"no"}'
      ),
      true
    );
  });
});

describe("the launch progress report", () => {
  it("is a no-op without GWO's progress model and survives a throwing stage", async () => {
    const silent = scene({ model: null });
    assert.equal(await run(silent), true);

    const broken = scene();
    broken.model.gwoLaunchProgress = {
      stage: () => {
        throw new Error("no screen");
      },
    };
    assert.equal(await run(broken), true);
    assert.equal(
      broken.console.lines.log.includes(
        "[GW-SM] progress report failed no screen"
      ),
      true
    );
  });
});

describe("mount module", () => {
  it("does not load twice into one scope", async () => {
    const { ctx, ns } = scene();
    const first = ns.mount;

    loadFile(ctx, "shared/mount.js");

    assert.equal(ctx.GwServerMods.mount, first);
  });
});

describe("mount.run rootOnly", () => {
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

  function startScene(records, options) {
    return scene(
      Object.assign(
        {
          cmm: null,
          stubs: {
            ko: fakeKo(records),
            // A real store as well as the property: gw_start reads the manager's
            // own record off localStorage, and the scene list is written there.
            localStorage: Object.assign(
              fakeSessionStorage({ installedModsDB: "1" }),
              { installedModsDB: "1" }
            ),
          },
        },
        options
      )
    );
  }

  it("mounts the enabled server zips and their companions at the root without Community Mods", async () => {
    const fixture = startScene([
      mod({
        identifier: "com.faction",
        context: "server",
        enabled: true,
        companions: ["com.faction-client"],
        scenes: { live_game: ["coui://ui/mods/com.faction/live_game.js"] },
      }),
      mod({
        identifier: "com.faction-client",
        context: "client",
        enabled: true,
        installedPath: "/download/com.faction-client.zip",
      }),
    ]);
    const storage = fixture.ctx.localStorage;

    assert.equal(await run(fixture, { rootOnly: true }), true);

    assert.deepEqual(fixture.api.calls.zipMount, [
      ["/download/com.example.server.zip", "/", false],
      ["/download/com.faction-client.zip", "/", false],
    ]);
    assert.equal(fixture.api.calls.remount.length, 1);
    assert.deepEqual(fixture.api.calls.mountMemoryFiles, []);
    // gw_start captures the base list as well: its own root mounts are what
    // would shadow it for every later scene.
    assert.deepEqual(
      fixture.$.ajaxCalls.map((call) => call.url),
      [ROOT_LIST]
    );
    assert.deepEqual(JSON.parse(storage.store.gw_server_mods_scenes), {
      live_game: ["coui://ui/mods/com.faction/live_game.js"],
    });
    assert.deepEqual(fixture.codes(), []);
    const state = fixture.ns.mount.state();
    assert.equal(state.mounted, true);
    assert.equal(state.mods[0].identifier, "com.faction");
  });

  it("counts a failed root mount against the run", async () => {
    const fixture = startScene([mod({ context: "server", enabled: true })], {
      apiOptions: { zipMount: () => resolved(false) },
    });

    assert.equal(await run(fixture, { rootOnly: true }), false);
    assert.equal(fixture.alarm("mount_failed").length, 1);
  });

  it("settles as mounted with nothing to mount", async () => {
    const fixture = startScene([]);

    assert.equal(await run(fixture, { rootOnly: true }), true);
    assert.deepEqual(fixture.ns.mount.state().mods, []);
  });

  it("still refuses a battle mount without Community Mods", async () => {
    const fixture = startScene([mod({ context: "server", enabled: true })]);

    assert.equal(await run(fixture), false);
    assert.equal(fixture.ns.mount.sequence(), 0);
  });

  it("records the scene lists on a battle mount", async () => {
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod({ scenes: { live_game: ["coui://ui/mods/x.js"] } })],
      },
    });

    assert.equal(await run(fixture), true);
    assert.deepEqual(
      JSON.parse(fixture.ctx.localStorage.store.gw_server_mods_scenes),
      { live_game: ["coui://ui/mods/x.js"] }
    );
  });

  // A root-only run merged nothing and made no /server_mods/<id>/ mounts, so
  // a battle caller handed it would report success having done neither.
  it("queues a battle caller behind a root-only run", async () => {
    const gate = Deferred();
    const fixture = scene({
      apiOptions: { zipMount: () => gate.promise() },
    });

    const first = run(fixture, { rootOnly: true, remountContent: false });
    const second = run(fixture, { remountContent: false });

    assert.notEqual(first, second);
    await flush();
    assert.equal(fixture.ns.mount.sequence(), 0);

    gate.resolve(true);
    assert.equal(await first, true);
    assert.equal(await second, true);
    assert.equal(fixture.ns.mount.sequence(), 2);
    // Only the queued battle run merges; neither caller remounts content.
    assert.equal(fixture.api.calls.mountMemoryFiles.length, 1);
    assert.equal(fixture.api.calls.remount.length, 0);
  });

  it("lets a root-only caller share a battle run", async () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = run(fixture, { remountContent: false });

    assert.equal(
      run(fixture, { rootOnly: true, remountContent: false }),
      first
    );

    pending.resolve();
    await flush();

    assert.equal(fixture.ns.mount.sequence(), 1);
  });
});
