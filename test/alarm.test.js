"use strict";

// shared/alarm.js: the alarm record, its console line and the on-screen banner.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createContext,
  fakeDocument,
  loadFile,
} = require("../scripts/lib/scene-loader.js");

// PA's loc(): the tag stripped and the key trimmed, then looked up. A key with
// no entry stands for itself, as every English string does.
function paLoc(table) {
  return (text) => {
    if (typeof text !== "string" || !text.startsWith("!LOC:")) {
      return text;
    }
    const key = text.slice("!LOC:".length).trim();
    return table && key in table ? table[key] : key;
  };
}

const ZIP_MISSING =
  "This server mod is enabled, but its zip is not downloaded. Open Community Mods and download it, or disable it.";
const CMM_UNAVAILABLE =
  "Community Mods is not active. Server mods cannot load in Galactic War. Enable Community Mods in the Mods menu, then restart PA.";

function load(stubs) {
  const ctx = createContext(stubs);
  loadFile(ctx, "shared/alarm.js");
  return ctx;
}

describe("alarm", () => {
  it("records the code and detail, logs one line, and returns the record", () => {
    const ctx = load();

    const record = ctx.GwServerMods.alarm("zip_missing", { identifier: "x" });

    assert.deepEqual(record, {
      code: "zip_missing",
      detail: { identifier: "x" },
    });
    assert.deepEqual(ctx.GwServerMods.alarms(), [record]);
    assert.deepEqual(ctx.console.lines.error, [
      '[GW-SM] ALARM zip_missing {"identifier":"x"}',
    ]);
  });

  it("defaults a missing detail to an empty object", () => {
    const ctx = load();

    assert.deepEqual(ctx.GwServerMods.alarm("probe_failed").detail, {});
  });

  it("hands out a copy of the raised list", () => {
    const ctx = load();
    ctx.GwServerMods.alarm("probe_failed");

    ctx.GwServerMods.alarms().length = 0;

    assert.equal(ctx.GwServerMods.alarms().length, 1);
  });

  it("creates one banner and reuses it, naming each code once", () => {
    const document = fakeDocument();
    const ctx = load({ document, loc: paLoc() });

    ctx.GwServerMods.alarm("zip_missing", { identifier: "a" });
    ctx.GwServerMods.alarm("zip_missing", { identifier: "b" });
    ctx.GwServerMods.alarm("cmm_unavailable", {});

    assert.equal(document.appended.length, 1);
    const banner = document.appended[0];
    assert.equal(banner.id, "gw-sm-alarm");
    assert.match(banner.style.cssText, /position:fixed/);
    assert.match(banner.textContent, /^GW Server Mods: /);
    assert.match(banner.textContent, /\(a\)/);
    assert.doesNotMatch(banner.textContent, /\(b\)/);
    assert.equal(banner.textContent.split("  |  ").length, 2);
  });

  it("uses the code itself when no wording is defined", () => {
    const document = fakeDocument();
    const ctx = load({ document, loc: paLoc() });

    ctx.GwServerMods.alarm("something_new");

    assert.equal(
      document.appended[0].textContent,
      "GW Server Mods: something_new"
    );
  });

  it("writes the English banner as it always has", () => {
    const document = fakeDocument();
    const ctx = load({ document, loc: paLoc() });

    ctx.GwServerMods.alarm("zip_missing", { identifier: "com.example.server" });
    ctx.GwServerMods.alarm("cmm_unavailable", {});

    assert.equal(
      document.appended[0].textContent,
      "GW Server Mods: " +
        ZIP_MISSING +
        " (com.example.server)  |  " +
        CMM_UNAVAILABLE
    );
  });

  it("takes the banner's punctuation from the translation", () => {
    const document = fakeDocument();
    const ctx = load({
      document,
      loc: paLoc({
        "__name__: __alarms__": "__name__：__alarms__",
        "__wording__ (__identifier__)": "__wording__（__identifier__）",
        "__first__  |  __next__": "__first__　｜　__next__",
        [ZIP_MISSING]: "缺少。",
        [CMM_UNAVAILABLE]: "未启用。",
      }),
    });

    ctx.GwServerMods.alarm("zip_missing", { identifier: "com.example.server" });
    ctx.GwServerMods.alarm("cmm_unavailable", {});

    assert.equal(
      document.appended[0].textContent,
      "GW Server Mods：缺少。（com.example.server）　｜　未启用。"
    );
  });

  // An identifier is another mod's to choose.
  it("puts an identifier in as it is, dollar signs and placeholders included", () => {
    const document = fakeDocument();
    const ctx = load({ document, loc: paLoc() });

    ctx.GwServerMods.alarm("zip_missing", { identifier: "com.$&.__next__" });
    ctx.GwServerMods.alarm("cmm_unavailable", {});

    assert.equal(
      document.appended[0].textContent,
      "GW Server Mods: " +
        ZIP_MISSING +
        " (com.$&.__next__)  |  " +
        CMM_UNAVAILABLE
    );
  });

  it("skips the banner when the scene has no body yet", () => {
    const document = fakeDocument({ body: null });
    const ctx = load({ document });

    ctx.GwServerMods.alarm("probe_failed");

    assert.equal(document.appended.length, 0);
    assert.equal(ctx.GwServerMods.alarms().length, 1);
  });

  it("keeps the record when the banner cannot be built", () => {
    const ctx = load({ document: fakeDocument({ createElementThrows: true }) });

    ctx.GwServerMods.alarm("probe_failed");

    assert.equal(ctx.GwServerMods.alarms().length, 1);
    assert.equal(
      ctx.console.lines.error[1],
      "[GW-SM] alarm banner failed createElement unavailable"
    );
  });

  it("does not load twice into one scope", () => {
    const ctx = load();
    const first = ctx.GwServerMods.alarm;

    loadFile(ctx, "shared/alarm.js");

    assert.equal(ctx.GwServerMods.alarm, first);
  });
});

describe("log", () => {
  it("builds one string, with the detail only when given", () => {
    const ctx = load();

    ctx.GwServerMods.log("hello");
    ctx.GwServerMods.log("hello", { n: 1 });

    assert.deepEqual(ctx.console.lines.log, [
      "[GW-SM] hello",
      '[GW-SM] hello {"n":1}',
    ]);
  });
});
