"use strict";

// shared/promise.js: the two helpers that keep native promises inside the mod
// and jQuery promises at the seams stock PA reads.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  createFakeJQuery,
  enginePromise,
} = require("../scripts/lib/fake-jquery.js");
const { createContext, loadFile } = require("../scripts/lib/scene-loader.js");

// The shape every api.* call returns, already settled.
function resolvedEngine(value) {
  const promise = enginePromise();
  promise.resolve(value);
  return promise;
}

function load() {
  const ctx = createContext({ $: createFakeJQuery() });
  loadFile(ctx, "shared/promise.js");
  return ctx.GwServerMods;
}

describe("ns.settled", () => {
  it("resolves with one entry per input, in order", async () => {
    const ns = load();

    assert.deepEqual(await ns.settled([1, Promise.resolve(2), 3]), [1, 2, 3]);
  });

  it("carries on past a rejection, keeping the reason in place", async () => {
    const ns = load();

    assert.deepEqual(
      await ns.settled([Promise.resolve("a"), Promise.reject("no"), "c"]),
      ["a", "no", "c"]
    );
  });

  it("adopts an engine promise, which $.when cannot", async () => {
    const ns = load();

    assert.deepEqual(await ns.settled([resolvedEngine("registered")]), [
      "registered",
    ]);
  });

  it("resolves an empty list", async () => {
    const ns = load();

    assert.deepEqual(await ns.settled([]), []);
  });
});

describe("ns.jq", () => {
  it("gives stock code a promise it can call always, done and fail on", async () => {
    const ns = load();
    const seen = [];
    const promise = ns.jq(Promise.resolve("started"));

    promise.done((value) => seen.push(["done", value]));
    promise.fail(() => seen.push(["fail"]));
    promise.always((value) => seen.push(["always", value]));

    await promise;

    assert.deepEqual(seen, [
      ["done", "started"],
      ["always", "started"],
    ]);
  });

  it("rejects with the reason when the native promise rejects", async () => {
    const ns = load();
    const seen = [];

    ns.jq(Promise.reject("refused"))
      .fail((error) => seen.push(["fail", error]))
      .always((error) => seen.push(["always", error]));

    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(seen, [
      ["fail", "refused"],
      ["always", "refused"],
    ]);
  });

  it("is loaded once, so a second load leaves the first helpers in place", () => {
    const ctx = createContext({ $: createFakeJQuery() });
    loadFile(ctx, "shared/promise.js");
    const first = ctx.GwServerMods.settled;
    loadFile(ctx, "shared/promise.js");

    assert.equal(ctx.GwServerMods.settled, first);
  });
});

// The fake jQuery is this suite's statement of what the shipped one does. These
// pin the premise both helpers rest on, and the reason the fakes hand back
// engine promises everywhere else.
describe("jQuery 2.1.4's promise test", () => {
  it("waits for a jQuery promise and not for an engine promise", () => {
    const $ = createFakeJQuery();
    const settled = [];

    $.when($.Deferred().promise()).always(() => settled.push("jquery"));
    $.when(enginePromise()).always(() => settled.push("engine"));

    assert.deepEqual(settled, ["engine"]);
  });

  it("skips an engine promise among several, and waits for the rest", () => {
    const $ = createFakeJQuery();
    const pending = $.Deferred();
    let settled = false;

    $.when(pending.promise(), enginePromise()).always(() => {
      settled = true;
    });

    assert.equal(settled, false);
    pending.resolve();
    assert.equal(settled, true);
  });

  it("does not chain a `then` handler that returns an engine promise", () => {
    const $ = createFakeJQuery();
    const gate = enginePromise();
    let value;

    $.Deferred()
      .resolve()
      .then(() => gate)
      .done((result) => {
        value = result;
      });

    assert.equal(value, gate);
  });
});
