"use strict";

// shared/alarm.js: the alarm record, its console line and the on-screen banner.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createContext,
  fakeDocument,
  loadFile,
} = require("../scripts/lib/scene-loader.js");

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
    const ctx = load({ document });

    ctx.GwServerMods.alarm("zip_missing", { identifier: "a" });
    ctx.GwServerMods.alarm("zip_missing", { identifier: "b" });
    ctx.GwServerMods.alarm("cmm_unavailable", {});

    assert.equal(document.appended.length, 1);
    const banner = document.appended[0];
    assert.equal(banner.id, "gw-sm-alarm");
    assert.match(banner.style.cssText, /position:fixed/);
    assert.match(banner.textContent, /^!LOC:GW Server Mods: /);
    assert.match(banner.textContent, /\(a\)/);
    assert.doesNotMatch(banner.textContent, /\(b\)/);
    assert.equal(banner.textContent.split("  |  ").length, 2);
  });

  it("uses the code itself when no wording is defined", () => {
    const document = fakeDocument();
    const ctx = load({ document });

    ctx.GwServerMods.alarm("something_new");

    assert.equal(
      document.appended[0].textContent,
      "!LOC:GW Server Mods: something_new"
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
