"use strict";

// Runs the shipped IIFEs the way a PA scene does: one shared scope, `window` as
// the root, engine globals as bare identifiers. Each test builds its own window
// object, so module-level state never leaks between tests and a file can be
// loaded twice to exercise its idempotence guard. The file runs in this realm,
// inside `with (window)`, rather than in a vm context: a context has its own
// Object.prototype, and assert.deepEqual rejects objects built there. See
// docs/testing.md.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const MOD_ROOT = path.join(REPO_ROOT, "ui", "mods", "com.pa.gw-server-mods");
const COUI_PREFIX = "coui://";

function modinfo() {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "modinfo.json"), "utf8")
  );
}

function couiToFsPath(entry) {
  if (!entry.startsWith(COUI_PREFIX)) {
    throw new Error("scene-loader: not a coui:// entry: " + entry);
  }
  return path.resolve(REPO_ROOT, entry.slice(COUI_PREFIX.length));
}

// Enough DOM for alarm.js's banner: elements are plain objects, the body keeps
// what is appended, and getElementById finds it again by id.
function fakeDocument(options) {
  const opts = options || {};
  const appended = [];
  return {
    appended: appended,
    body:
      opts.body === null ? null : { appendChild: (el) => appended.push(el) },
    createElement: (tag) => {
      if (opts.createElementThrows) {
        throw new Error("createElement unavailable");
      }
      return { tagName: tag, style: {}, textContent: "" };
    },
    getElementById: (id) => appended.find((el) => el.id === id) || null,
  };
}

// PA keeps only the first console argument per line, and so does this.
function fakeConsole() {
  const lines = { log: [], error: [], warn: [] };
  return {
    lines: lines,
    log: (first) => lines.log.push(String(first)),
    error: (first) => lines.error.push(String(first)),
    warn: (first) => lines.warn.push(String(first)),
  };
}

function fakeSessionStorage(initial, options) {
  const opts = options || {};
  const store = Object.assign({}, initial);
  return {
    store: store,
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      if (opts.setItemThrows) {
        throw new Error("QuotaExceededError");
      }
      store[key] = String(value);
    },
  };
}

// Lets every pending microtask run. A native path settles on a microtask rather
// than in the call, so a test that asserts something has *not* happened yet must
// give it the chance to first. See docs/testing.md.
function flush() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

// `stubs` are the engine globals the test supplies (api, model, handlers, $,
// CommunityModsManager, sessionStorage, document...). A stub given as undefined
// is left absent, which is how a test asserts the missing-engine alarms.
function createContext(stubs) {
  const ctx = {
    _: require("lodash"),
    loc: (value) => value,
    console: fakeConsole(),
    document: fakeDocument(),
    sessionStorage: fakeSessionStorage(),
    // Shared across panels where sessionStorage is not, which is why the scene
    // list lives here. Same fake: the two stores have the same shape.
    localStorage: fakeSessionStorage(),
  };
  Object.keys(stubs || {}).forEach((name) => {
    if (stubs[name] === undefined) {
      delete ctx[name];
    } else {
      ctx[name] = stubs[name];
    }
  });
  ctx.window = ctx;
  return ctx;
}

// The wrapper shares the file's first line so every line number in a stack
// trace and the coverage report is the file's own.
const PRELUDE = "(function (window) { with (window) { ";
const POSTLUDE = "\n}})";

function loadFile(ctx, entry) {
  const fsPath = entry.startsWith(COUI_PREFIX)
    ? couiToFsPath(entry)
    : path.join(MOD_ROOT, entry);
  const source = fs.readFileSync(fsPath, "utf8");
  const run = vm.runInThisContext(PRELUDE + source + POSTLUDE, {
    filename: fsPath,
  });
  run(ctx);
  return ctx;
}

function sceneFiles(scene) {
  const files = modinfo().scenes[scene];
  if (!files) {
    throw new Error("scene-loader: modinfo.json has no scene " + scene);
  }
  return files;
}

// The scene's files in modinfo.json order, optionally stopping before one so a
// test can adjust the context between the shared modules and the scene script.
function loadScene(ctx, scene, options) {
  const opts = options || {};
  for (const entry of sceneFiles(scene)) {
    if (opts.until && entry.endsWith(opts.until)) {
      break;
    }
    loadFile(ctx, entry);
  }
  return ctx;
}

module.exports = {
  MOD_ROOT,
  REPO_ROOT,
  couiToFsPath,
  createContext,
  fakeConsole,
  fakeDocument,
  fakeSessionStorage,
  flush,
  loadFile,
  loadScene,
  modinfo,
  sceneFiles,
};
