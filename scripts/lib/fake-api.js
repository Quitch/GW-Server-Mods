"use strict";

// The api.* surface the shipped code reaches. Every member is optional so a test
// can leave out the one whose absence it asserts (pass `false`); every call is
// recorded on `api.calls`. An option handler may return a plain value, a Deferred
// or a native promise; undefined resolves.
//
// A call returns an *engine* promise, as the game's does: `then` and nothing
// jQuery recognises. A shipped file that hands one to $.when therefore fails a
// test instead of silently skipping the wait.

const { enginePromise, isThenable, resolved } = require("./fake-jquery.js");

function asEngine(result) {
  const promise = enginePromise();

  if (isThenable(result)) {
    result.then(
      (value) => promise.resolve(value),
      (error) => promise.reject(error)
    );
  } else {
    promise.resolve(result);
  }

  return promise;
}

function createFakeApi(options) {
  const opts = options || {};
  const calls = {
    zipMount: [],
    list: [],
    mountMemoryFiles: [],
    unmountAllMemoryFiles: [],
    remount: [],
    startGame: [],
  };

  function record(name, handler, fallback) {
    return function () {
      const args = Array.prototype.slice.call(arguments);
      calls[name].push(args);

      return asEngine(handler ? handler.apply(null, args) : fallback);
    };
  }

  const api = { calls: calls, file: {}, content: {}, net: {} };

  if (opts.zipMount !== false) {
    api.file.zip = {
      mount: record("zipMount", opts.zipMount, resolved(true)),
    };
  }
  if (opts.list !== false) {
    api.file.list = record("list", opts.list, resolved([]));
  }
  if (opts.mountMemoryFiles !== false) {
    api.file.mountMemoryFiles = record(
      "mountMemoryFiles",
      opts.mountMemoryFiles
    );
  }
  if (opts.unmountAllMemoryFiles !== false) {
    api.file.unmountAllMemoryFiles = record(
      "unmountAllMemoryFiles",
      opts.unmountAllMemoryFiles
    );
  }
  if (opts.remount !== false) {
    api.content.remount = record("remount", opts.remount);
  }
  if (opts.startGame !== false) {
    api.net.startGame = record(
      "startGame",
      opts.startGame,
      resolved("started")
    );
  }

  return api;
}

module.exports = { createFakeApi };
