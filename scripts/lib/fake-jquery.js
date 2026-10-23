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
  let context;
  let firing = false;
  // One list in registration order, as jQuery's `always` is `done` plus `fail`.
  const handlers = [];

  // A throw leaves `firing` set for good, as in jQuery. See docs/testing.md.
  function fire() {
    firing = true;
    while (handlers.length) {
      const handler = handlers.shift();
      if (handler.on === "always" || handler.on === state) {
        handler.fn.apply(context, args);
      }
    }
    firing = false;
  }

  function settleWith(next) {
    return function (withContext, withArgs) {
      if (state !== "pending") {
        return deferred;
      }
      state = next;
      context = withContext;
      args = Array.prototype.slice.call(withArgs || []);
      fire();
      return deferred;
    };
  }

  // Handlers run with this deferred's promise as `this`, unless the settle
  // call was made on something else, as in jQuery.
  function settle(withMethod) {
    return function () {
      return withMethod(this === deferred ? promise : this, arguments);
    };
  }

  function on(when) {
    return function (fn) {
      if (typeof fn === "function") {
        handlers.push({ on: when, fn: fn });
        if (state !== "pending" && !firing) {
          fire();
        }
      }
      return this;
    };
  }

  // jQuery 2.1.4's `then`. See docs/testing.md.
  function then(onDone, onFail) {
    const next = Deferred();

    function forward(handler, action) {
      return function () {
        const nextContext = this === promise ? next.promise() : this;

        if (typeof handler !== "function") {
          next[action](nextContext, arguments);
          return;
        }
        const returned = handler.apply(this, arguments);
        if (isJqPromise(returned)) {
          returned.promise().done(next.resolve).fail(next.reject);
        } else {
          next[action](nextContext, [returned]);
        }
      };
    }

    promise.done(forward(onDone, "resolveWith"));
    promise.fail(forward(onFail, "rejectWith"));
    return next.promise();
  }

  const promise = {
    done: on("resolved"),
    fail: on("rejected"),
    always: on("always"),
    then: then,
    state: () => state,
    promise: () => promise,
  };

  const resolveWith = settleWith("resolved");
  const rejectWith = settleWith("rejected");

  const deferred = Object.assign({}, promise, {
    resolve: settle(resolveWith),
    reject: settle(rejectWith),
    resolveWith: resolveWith,
    rejectWith: rejectWith,
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

// jQuery 2.1.4's $.when: one jQuery promise is returned as is, anything else
// with one argument resolves to it, several settle together with one value per
// argument. Anything without a `promise` method counts as already resolved,
// engine and native promises included.
function when() {
  const values = Array.prototype.slice.call(arguments);
  const length = values.length;
  let remaining = length !== 1 || isJqPromise(values[0]) ? length : 0;

  if (remaining === 1) {
    return values[0].promise();
  }

  const deferred = Deferred();
  const contexts = length > 1 ? new Array(length) : undefined;

  if (length > 1) {
    values.forEach(function (input, index) {
      if (!isJqPromise(input)) {
        remaining -= 1;
        return;
      }
      input
        .promise()
        .done(function (value) {
          contexts[index] = this;
          values[index] =
            arguments.length > 1
              ? Array.prototype.slice.call(arguments)
              : value;
          remaining -= 1;
          if (!remaining) {
            deferred.resolveWith(contexts, values);
          }
        })
        .fail(deferred.reject);
    });
  }

  if (!remaining) {
    deferred.resolveWith(contexts, values);
  }

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

  function then(onDone, onFail) {
    handlers.push([onDone, onFail]);
    if (state !== "pending") {
      fire();
    }
  }

  return {
    then: then,
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
  const $ = {};

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
