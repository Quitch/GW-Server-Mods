"use strict";

// The jQuery 2 subset the shipped code calls: a Deferred whose callbacks fire
// synchronously on settle, $.when with jQuery's pass-through and spread-argument
// semantics, and an $.ajax routed to a per-test resolver. Synchronous settlement
// keeps these tests free of await; a Deferred left pending holds a seam open.
//
// `when` and `then` identify a promise the way jQuery 2.1.4 does - by a `promise`
// method, not by `then`. That is why an engine promise handed to $.when is read
// as a plain value and never waited for, and `enginePromise()` below is how a
// test reproduces one. See docs/design.md.

function isThenable(value) {
  return !!value && typeof value.then === "function";
}

function isJqPromise(value) {
  return !!value && typeof value.promise === "function";
}

function Deferred() {
  let state = "pending";
  let args = [];
  const done = [];
  const fail = [];
  const always = [];

  function fire(list) {
    while (list.length) {
      list.shift().apply(null, args);
    }
  }

  function settle(next, list) {
    return function () {
      if (state !== "pending") {
        return deferred;
      }
      state = next;
      args = Array.prototype.slice.call(arguments);
      fire(list);
      fire(always);
      return deferred;
    };
  }

  function on(list, when) {
    return function (fn) {
      if (typeof fn !== "function") {
        return promise;
      }
      if (state === "pending") {
        list.push(fn);
      } else if (when === "always" || state === when) {
        fn.apply(null, args);
      }
      return promise;
    };
  }

  function then(onDone, onFail) {
    const next = Deferred();

    function forward(handler, fallback) {
      return function () {
        if (typeof handler !== "function") {
          fallback.apply(next, arguments);
          return;
        }
        let result;
        try {
          result = handler.apply(null, arguments);
        } catch (e) {
          next.reject(e);
          return;
        }
        if (isJqPromise(result)) {
          // Not next.resolve itself: as a handler it would return the
          // deferred, a thenable, and an already settled chain would recurse.
          result.then(
            function () {
              next.resolve.apply(next, arguments);
            },
            function () {
              next.reject.apply(next, arguments);
            }
          );
        } else {
          next.resolve(result);
        }
      };
    }

    promise.done(forward(onDone, next.resolve));
    promise.fail(forward(onFail, next.reject));
    return next.promise();
  }

  const promise = {
    done: on(done, "resolved"),
    fail: on(fail, "rejected"),
    always: on(always, "always"),
    then: then,
    state: () => state,
    promise: () => promise,
  };

  const deferred = Object.assign({}, promise, {
    resolve: settle("resolved", done),
    reject: settle("rejected", fail),
  });

  return deferred;
}

function resolved() {
  const deferred = Deferred();
  return deferred.resolve.apply(deferred, arguments).promise();
}

function rejected() {
  const deferred = Deferred();
  return deferred.reject.apply(deferred, arguments).promise();
}

// jQuery's $.when: one jQuery promise is returned as is, anything else with one
// argument resolves to it, several settle together with one value per argument.
// Anything without a `promise` method counts as already resolved, engine and
// native promises included.
function when() {
  const inputs = Array.prototype.slice.call(arguments);

  if (inputs.length === 1) {
    return isJqPromise(inputs[0]) ? inputs[0].promise() : resolved(inputs[0]);
  }

  const deferred = Deferred();
  const values = new Array(inputs.length);
  let remaining = inputs.length;

  function finish() {
    deferred.resolve.apply(deferred, values);
  }

  if (!remaining) {
    finish();
    return deferred.promise();
  }

  inputs.forEach(function (input, index) {
    if (!isJqPromise(input)) {
      values[index] = input;
      remaining -= 1;
      if (!remaining) {
        finish();
      }
      return;
    }
    input.then(
      function (value) {
        values[index] = value;
        remaining -= 1;
        if (!remaining) {
          finish();
        }
      },
      function () {
        deferred.reject.apply(deferred, arguments);
      }
    );
  });

  return deferred.promise();
}

// An engine promise, the shape every api.* call returns: `then` and nothing
// else. No `promise`, `done`, `fail` or `always`, so jQuery does not recognise
// it. A test holds one pending to prove the code under test waits for it.
function enginePromise() {
  let state = "pending";
  let args = [];
  const handlers = [];

  function fire() {
    while (handlers.length) {
      const handler = handlers.shift()[state === "resolved" ? 0 : 1];
      if (typeof handler === "function") {
        handler.apply(null, args);
      }
    }
  }

  function settle(next) {
    return function () {
      if (state !== "pending") {
        return;
      }
      state = next;
      args = Array.prototype.slice.call(arguments);
      fire();
    };
  }

  return {
    then: function (onDone, onFail) {
      handlers.push([onDone, onFail]);
      if (state !== "pending") {
        fire();
      }
    },
    resolve: settle("resolved"),
    reject: settle("rejected"),
    state: () => state,
  };
}

// `ajax(url, options)` returns the response text, or throws to fail the request.
// A URL with no resolver fails, so a fixture cannot silently drift from what the
// code asks for. Every call is kept in `$.ajaxCalls`.
function createFakeJQuery(options) {
  const opts = options || {};
  const $ = function () {};

  $.Deferred = Deferred;
  $.when = when;
  $.ajaxCalls = [];
  $.ajax = function (settings) {
    $.ajaxCalls.push(settings);
    if (!opts.ajax) {
      return rejected(
        new Error("fake-jquery: no ajax resolver for " + settings.url)
      );
    }
    try {
      return resolved(opts.ajax(settings.url, settings));
    } catch (e) {
      return rejected(e);
    }
  };

  return $;
}

module.exports = {
  Deferred,
  createFakeJQuery,
  enginePromise,
  isJqPromise,
  isThenable,
  rejected,
  resolved,
  when,
};
