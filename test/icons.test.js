"use strict";

// icon_atlas/icons.js: strategic icons a mounted mod adds, fed into the atlas
// before the stock list is sent.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createFakeApi } = require("../scripts/lib/fake-api.js");
const {
  createFakeJQuery,
  rejected,
  resolved,
} = require("../scripts/lib/fake-jquery.js");
const {
  createContext,
  flush,
  loadScene,
} = require("../scripts/lib/scene-loader.js");

const ICON_DIR = "/ui/main/atlas/icon_atlas/img/strategic_icons/";

function scene(options) {
  const opts = options || {};
  const icons = opts.icons || ["foo"];
  const sends = [];
  const mutations = [];
  const strategicIcons = () => icons;
  strategicIcons.valueHasMutated = () => mutations.push(icons.slice());
  const model =
    opts.model === undefined
      ? {
          strategicIcons,
          sendIconList: function () {
            sends.push(this);
          },
        }
      : opts.model;
  const api =
    opts.api === undefined ? createFakeApi({ list: opts.list }) : opts.api;
  const ctx = createContext({ $: createFakeJQuery(), api, model });
  loadScene(ctx, "icon_atlas");
  return { ctx, api, model, icons, sends, mutations };
}

describe("icon_atlas icons", () => {
  it("adds every icon under the strategic icon directory that the atlas lacks, once", async () => {
    const fixture = scene({
      list: () =>
        resolved([
          ICON_DIR + "icon_si_foo.png",
          ICON_DIR + "icon_si_bar.PNG",
          ICON_DIR + "icon_si_baz.png",
          ICON_DIR + "icon_si_bar.png",
          ICON_DIR + "icon_si_.png",
          ICON_DIR + "readme.txt",
        ]),
    });

    fixture.model.sendIconList();
    await flush();

    assert.deepEqual(fixture.api.calls.list, [[ICON_DIR, false]]);
    assert.deepEqual(fixture.icons, ["foo", "bar", "baz"]);
    assert.deepEqual(fixture.mutations, [["foo", "bar", "baz"]]);
    assert.deepEqual(fixture.sends, [fixture.model]);
    assert.deepEqual(fixture.ctx.console.lines.log, [
      "[GW-SM] strategic icons added=2",
    ]);
  });

  it("reads an object listing by its keys and notifies nobody when nothing is new", async () => {
    const fixture = scene({
      list: () => resolved({ [ICON_DIR + "icon_si_foo.png"]: {} }),
    });

    fixture.model.sendIconList();
    await flush();

    assert.deepEqual(fixture.icons, ["foo"]);
    assert.deepEqual(fixture.mutations, []);
    assert.equal(fixture.sends.length, 1);
  });

  it("still sends the stock list when the directory cannot be listed", async () => {
    const fixture = scene({ list: () => rejected("no dir") });

    fixture.model.sendIconList();
    await flush();

    assert.equal(fixture.sends.length, 1);
    assert.deepEqual(fixture.ctx.console.lines.error, [
      "[GW-SM] could not list " + ICON_DIR,
    ]);
  });

  it("still sends the stock list when files cannot be listed at all", async () => {
    const noList = scene({ api: createFakeApi({ list: false }) });
    noList.model.sendIconList();
    await flush();
    assert.equal(noList.sends.length, 1);

    const noFile = scene();
    noFile.api.file = null;
    noFile.model.sendIconList();
    await flush();
    assert.equal(noFile.sends.length, 1);
  });

  it("patches once", () => {
    const fixture = scene();
    const patched = fixture.model.sendIconList;

    loadScene(fixture.ctx, "icon_atlas");

    assert.equal(fixture.model.sendIconList, patched);
    assert.equal(patched.__gwServerModsPatched, true);
  });

  it("reports when there is no list to patch", () => {
    const fixture = scene({ model: {} });

    assert.deepEqual(fixture.ctx.console.lines.error, [
      "[GW-SM] sendIconList unavailable; modded icons will be dots",
    ]);
  });

  it("logs rather than throws when the model cannot be read", () => {
    const fixture = scene({
      model: {
        get sendIconList() {
          throw new Error("no model");
        },
      },
    });

    assert.match(
      fixture.ctx.console.lines.error[0],
      /^\[GW-SM\] Error: no model/
    );
  });
});
