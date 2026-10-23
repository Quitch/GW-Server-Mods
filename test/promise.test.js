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

  it("rejects with a fail handler's plain return value", () => {
    const $ = createFakeJQuery();
    const seen = [];

    $.Deferred()
      .reject("refused")
      .then(null, (error) => "recovered from " + error)
      .done((value) => seen.push(["done", value]))
      .fail((value) => seen.push(["fail", value]));

    assert.deepEqual(seen, [["fail", "recovered from refused"]]);
  });

  it("resolves when a fail handler returns a resolved jQuery promise", () => {
    const $ = createFakeJQuery();
    const seen = [];

    $.Deferred()
      .reject("refused")
      .then(null, () => $.Deferred().resolve("recovered").promise())
      .done((value) => seen.push(["done", value]))
      .fail((value) => seen.push(["fail", value]));

    assert.deepEqual(seen, [["done", "recovered"]]);
  });

  it("rejects when a fail handler returns a rejected jQuery promise", () => {
    const $ = createFakeJQuery();
    const seen = [];

    $.Deferred()
      .reject("refused")
      .then(null, () => $.Deferred().reject("still refused").promise())
      .done((value) => seen.push(["done", value]))
      .fail((value) => seen.push(["fail", value]));

    assert.deepEqual(seen, [["fail", "still refused"]]);
  });

  it("passes a rejection through a then with no fail handler", () => {
    const $ = createFakeJQuery();
    const seen = [];

    $.Deferred()
      .reject("refused")
      .then((value) => "mapped " + value)
      .done((value) => seen.push(["done", value]))
      .fail((value) => seen.push(["fail", value]));

    assert.deepEqual(seen, [["fail", "refused"]]);
  });

  it("resolves with a done handler's plain return value", () => {
    const $ = createFakeJQuery();
    const seen = [];

    $.Deferred()
      .resolve("started")
      .then((value) => value + " and mapped")
      .done((value) => seen.push(["done", value]))
      .fail((value) => seen.push(["fail", value]));

    assert.deepEqual(seen, [["done", "started and mapped"]]);
  });

  it("throws from the settle when a then handler throws, and runs nothing after it", () => {
    const $ = createFakeJQuery();
    const source = $.Deferred();
    const error = new Error("handler threw");
    const seen = [];

    source.always(() => seen.push("registered before"));
    source
      .then(() => {
        throw error;
      })
      .done(() => seen.push("chained done"))
      .fail(() => seen.push("chained fail"));
    source.always(() => seen.push("registered after"));

    assert.throws(() => source.resolve(), error);
    source.done(() => seen.push("added once settled"));

    assert.equal(source.state(), "resolved");
    assert.deepEqual(seen, ["registered before"]);
  });

  it("adopts a returned object with a promise method and no then", () => {
    const $ = createFakeJQuery();
    const inner = $.Deferred();
    let value;

    $.Deferred()
      .resolve()
      .then(() => ({ promise: () => inner.promise() }))
      .done((result) => {
        value = result;
      });

    inner.resolve("adopted");

    assert.equal(value, "adopted");
  });

  it("calls a then handler with the source promise as this", () => {
    const $ = createFakeJQuery();
    const resolving = $.Deferred();
    const rejecting = $.Deferred();
    const seen = {};

    const chained = resolving.then(function () {
      seen.done = this;
    });
    chained.done(function () {
      seen.chained = this;
    });
    rejecting.then(null, function () {
      seen.fail = this;
    });

    resolving.resolve();
    rejecting.reject();

    assert.equal(seen.done, resolving.promise());
    assert.equal(seen.fail, rejecting.promise());
    assert.equal(seen.chained, chained);
  });

  it("throws from a handler added once settled, and runs nothing after it", () => {
    const $ = createFakeJQuery();
    const source = $.Deferred().resolve();
    const error = new Error("handler threw");
    const seen = [];

    assert.throws(
      () =>
        source.done(() => {
          throw error;
        }),
      error
    );
    source.done(() => seen.push("done"));
    source.always(() => seen.push("always"));

    assert.deepEqual(seen, []);
  });

  it("returns the deferred from done, fail and always, so a chain can settle it", () => {
    const $ = createFakeJQuery();
    const seen = [];

    $.Deferred()
      .done(() => seen.push("done"))
      .fail(() => seen.push("fail"))
      .always(() => seen.push("always"))
      .resolve();

    assert.deepEqual(seen, ["done", "always"]);
  });

  it("runs always and fail handlers in the order they were added", () => {
    const $ = createFakeJQuery();
    const deferred = $.Deferred();
    const seen = [];

    deferred.always(() => seen.push("always"));
    deferred.done(() => seen.push("done"));
    deferred.fail(() => seen.push("fail"));
    deferred.reject();

    assert.deepEqual(seen, ["always", "fail"]);
  });

  it("resolves $.when of several inputs with their contexts and every value", () => {
    const $ = createFakeJQuery();
    const first = $.Deferred();
    const second = $.Deferred();
    const seen = {};

    $.when(first.promise(), "plain", second.promise()).done(function () {
      seen.this = this;
      seen.values = Array.prototype.slice.call(arguments);
    });
    second.resolve("one", "two");
    first.resolve("only");

    assert.equal(seen.this.length, 3);
    assert.equal(seen.this[0], first.promise());
    assert.equal(seen.this[1], undefined);
    assert.equal(seen.this[2], second.promise());
    assert.deepEqual(seen.values, ["only", "plain", ["one", "two"]]);
  });

  it("rejects $.when of several inputs with the first rejection", () => {
    const $ = createFakeJQuery();
    const first = $.Deferred();
    const seen = [];

    $.when(first.promise(), $.Deferred().promise()).fail((error) =>
      seen.push(error)
    );
    first.reject("refused");

    assert.deepEqual(seen, ["refused"]);
  });

  it("runs always and done handlers in the order they were added", () => {
    const $ = createFakeJQuery();
    const deferred = $.Deferred();
    const seen = [];

    deferred.always(() => seen.push("always"));
    deferred.done(() => seen.push("done"));
    deferred.resolve();

    assert.deepEqual(seen, ["always", "done"]);
  });
});
