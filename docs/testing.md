# Testing

## Commands

- `npm test` — every `test/*.test.js` under Node's built-in runner (`node --test`).
- `npm run test:coverage` — the same, with a coverage table for `ui/**` and
  `coverage/lcov.info` for SonarCloud. Fails under 80% line coverage.
- `node --test test/mount.test.js` — one file;
  `--test-name-pattern="<pattern>"` narrows to one test.
- `npm run verify` — the full pre-submit gate, tests included. CI
  (`.github/workflows/ci.yml`) runs exactly this.

There is no third-party runner, assertion library or coverage tool: `node:test`,
`node:assert/strict` and `--experimental-test-coverage` are all of it. The one
devDependency the tests add is lodash 3.9.3, the version the game ships, standing in
for the global `_`.

## How a shipped file is loaded

Every shipped file is an IIFE that takes `window` as its root and reads the engine
(`api`, `model`, `handlers`, `$`, `_`, `loc`, `CommunityModsManager`,
`sessionStorage`, `document`, `console`) as bare globals, exactly as a PA scene
provides them. `scripts/lib/scene-loader.js` reproduces that: a test builds one plain
object as its `window`, puts the fakes it needs on it, and `loadFile` runs the file
inside `(function (window) { with (window) { … } })` in the current realm. The wrapper
shares the file's first line, so stack traces and the coverage report use the file's
own line numbers.

Consequences worth knowing:

- **A test never touches Node's globals.** Every engine object lives on the test's own
  `window`, so nothing needs restoring between tests and two tests cannot see each
  other's state. Module-level state in the shipped files (`raised`, `cached`, `state`,
  `running`, `hostRequired`, `runOptions`) resets simply by building a new window.
- **A missing engine global is a `ReferenceError`, not `undefined`**, as in the game.
  Pass `null` for `api`/`cmm`/`model` in `sharedScene()` to assert the alarm a
  missing engine raises; the fakes otherwise supply everything.
- **A file can be loaded twice** into one window. That is how the `if (ns.x) return`
  guards and the `__gwServerModsPatched` / `__gwServerModsWrapped` marks are pinned.
- **`loadScene(ctx, "gw_play")`** loads a scene's files in `modinfo.json` order, so the
  scene tests exercise the shipped load order rather than restating it.

## The fakes

`scripts/lib/`:

- `fake-jquery.js` — a jQuery 2 `Deferred` (`done`/`fail`/`always`/`then`/`promise`/
  `state`) whose callbacks fire synchronously on settle, `$.when` with jQuery's
  semantics, and `$.ajax` routed to a resolver that returns the body or throws to
  fail. A URL with no resolver fails, so a fixture cannot drift from what the code
  asks for. `$.ajaxCalls` records every request, `cache` flag included.
  `$.when` and `then` identify a promise by a **`promise` method**, exactly as
  jQuery 2.1.4 does, so an engine promise given to either is read as a plain value
  and never waited for. `test/promise.test.js` pins that. Also exported:
  `enginePromise()`, an object with `then`, `resolve` and `reject` and none of
  jQuery's methods — the shape every `api.*` call returns. Hold one pending to
  prove the code under test waits for it.
- `fake-api.js` — `api.file.zip.mount`, `api.file.list`, `mountMemoryFiles`,
  `unmountAllMemoryFiles`, `api.content.remount`, `api.net.startGame`, each optional
  (`false` leaves it out) and each recorded on `api.calls`. Every one returns an
  **engine promise**, as the game's does, whatever shape the option handler gave
  back. That is deliberate: a shipped file that hands one to `$.when` fails a test
  rather than silently skipping the wait.
- `fake-cmm.js` — `CommunityModsManager` and `mod()` records in CMM's raw shape.
- `shared-scene.js` — the six `shared/*.js` files over a full set of fakes, with
  `codes()` / `alarm(code)` readers over the alarms raised.
- `scene-loader.js` — also `fakeDocument`, `fakeSessionStorage`, `fakeConsole` and
  `flush()`; the console keeps only the first argument per line, as PA's log does.

Shipped code runs on native promises, which settle on a microtask rather than in
the call, so a test that goes through one `await`s the result. The three members
that leave the mod — `ns.mount.run`, `ns.manifest.load` and
`ns.manifest.detectClientRelevance` — hand back a jQuery promise over that native
chain, so they settle on the same microtask and are awaited the same way. Where it must assert
that something has **not** happened yet, `flush()` from `scene-loader.js` lets the
pending microtasks run first:

```js
const gate = enginePromise();
const fixture = scene({ apiOptions: { remount: () => gate } });
let done = false;

fixture.ns.mount.run().then(() => {
  done = true;
});
await flush();
assert.equal(done, false); // still registering content

gate.resolve();
await flush();
assert.equal(done, true);
```

The jQuery fakes still settle synchronously, which is what the `ns.jq` seams and
`$.ajax` are asserted through. A `Deferred()` or an `enginePromise()` left pending
is how a test holds a run open (mount coalescing, the unmount hook, the patched
`fight`/`startGame`).

## Conventions

- A test file is named for the shipped file it loads, one per file, plus
  `modinfo.test.js` for the manifest and release metadata.
- New or changed logic gets a test in the same file; a behaviour that is pinned rather
  than endorsed says so in a comment (see `mount.test.js`, the synchronous-run case).
- Genuinely untestable code goes into `sonar.coverage.exclusions` with a rationale,
  never an assertionless test. Today nothing shipped is excluded.

## What tests cannot cover

Nothing here starts PA. Whether `api.file.zip.mount` accepts a root mount, whether
`api.content.remount()` blanks a running battle, whether `spec://` really caches its
first read, which seams the scene assigns after mod scripts run — every fake encodes
an assumption about the engine that only the game can confirm. The verification list
at the end of [`design.md`](design.md) is that check.
