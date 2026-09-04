"use strict";

// connect_to_game/gate.js: the host publishes the server mods a viewer must
// match, the viewer reports the ones it shares, through the two seams the
// scene assigns after mod scripts run.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const {
  fakeSessionStorage,
  loadFile,
} = require("../scripts/lib/scene-loader.js");

const REQUIRED = "set_required_client_mods";
const MANIFEST = "client_mod_manifest";

function recorder() {
  const calls = [];
  const fn = function (message, payload, respond) {
    calls.push({ self: this, message, payload, respond });
    return "sent";
  };
  fn.calls = calls;
  return fn;
}

// The whole connect_to_game scene; start.js is inert here beyond its hooks.
function scene(options) {
  const opts = options || {};
  const send = recorder();
  const request = recorder();
  const fixture = sharedScene(
    Object.assign(
      {
        model: opts.model === null ? null : { send_message: send },
        stubs: {
          handlers:
            opts.handlers === null
              ? undefined
              : { request_client_mod_manifest: request },
        },
      },
      opts
    )
  );
  loadFile(fixture.ctx, "connect_to_game/start.js");
  loadFile(fixture.ctx, "connect_to_game/gate.js");
  fixture.send = send;
  fixture.request = request;
  return fixture;
}

function relevance(map) {
  return {
    sessionStorage: fakeSessionStorage({
      gw_server_mods_relevance: JSON.stringify(map),
    }),
  };
}

describe("gate installation", () => {
  it("raises gate_unavailable naming the missing half", () => {
    const noModel = scene({ model: null });
    assert.deepEqual(noModel.alarm("gate_unavailable")[0].detail, {
      send_message: false,
      request_manifest: true,
    });

    const noHandlers = scene({ handlers: null });
    assert.deepEqual(noHandlers.alarm("gate_unavailable")[0].detail, {
      send_message: true,
      request_manifest: false,
    });
  });

  it("logs rather than throws when a seam cannot take an accessor", () => {
    const fixture = sharedScene({ stubs: { handlers: {} } });
    Object.defineProperty(fixture.model, "send_message", {
      value: () => {},
      configurable: false,
    });

    loadFile(fixture.ctx, "connect_to_game/gate.js");

    assert.match(fixture.console.lines.error.at(-1), /^\[GW-SM\] TypeError/);
    assert.deepEqual(fixture.ns.gate.hostRequired(), []);
  });

  it("survives the scene creating send_message after the mod loaded", () => {
    const fixture = scene({ cmmOptions: { serverMods: [mod()] } });
    const late = recorder();

    fixture.model.send_message = late;
    fixture.model.send_message(REQUIRED, {});

    assert.equal(
      late.calls[0].payload.required_identifiers[0],
      "com.example.server"
    );
    assert.equal(fixture.model.send_message.__gwServerModsPatched, true);
  });

  it("wraps once, however many times the scene loads it", () => {
    const fixture = scene({ cmmOptions: { serverMods: [mod()] } });
    loadFile(fixture.ctx, "connect_to_game/gate.js");

    fixture.model.send_message(REQUIRED, {});

    assert.equal(fixture.send.calls.length, 1);
    assert.deepEqual(fixture.send.calls[0].payload.required_identifiers, [
      "com.example.server",
    ]);
  });

  it("leaves a non-function seam alone", () => {
    const fixture = scene({ model: { send_message: undefined } });

    fixture.model.send_message = "later";

    assert.equal(fixture.model.send_message, "later");
  });
});

describe("publishing the host's server mods", () => {
  it("requires every active server mod until a mount has classified them", () => {
    const fixture = scene({
      cmmOptions: {
        serverMods: [
          mod({ identifier: "Com.A", display_name: "A", version: "1" }),
          mod({ identifier: "com.b", display_name: "B", version: "2" }),
        ],
      },
    });
    const respond = () => {};
    const self = {};

    const result = fixture.model.send_message.call(
      self,
      REQUIRED,
      { required_identifiers: ["com.client", "com.a"] },
      respond
    );

    assert.equal(result, "sent");
    const call = fixture.send.calls[0];
    assert.equal(call.self, self);
    assert.equal(call.respond, respond);
    assert.deepEqual(call.payload, {
      required_identifiers: ["com.client", "com.a", "com.b"],
      required_names_by_id: { "com.a": "A", "com.b": "B" },
      required_versions_by_id: { "com.a": "1", "com.b": "2" },
    });
    assert.equal(fixture.ns.hostRequiresMod("com.b"), true);
    assert.equal(
      fixture.console.lines.log.includes(
        "[GW-SM] server mods unclassified, requiring all"
      ),
      true
    );
  });

  it("requires only the client-relevant mods once classified", () => {
    const fixture = scene({
      cmmOptions: {
        serverMods: [
          mod({ identifier: "com.a" }),
          mod({ identifier: "com.b" }),
        ],
      },
      stubs: relevance({ "com.a": true, "com.b": false }),
    });

    fixture.model.send_message(REQUIRED, {});

    assert.deepEqual(fixture.send.calls[0].payload.required_identifiers, [
      "com.a",
    ]);
  });

  it("leaves the payload untouched when nothing is required", () => {
    const fixture = scene();
    const payload = { required_identifiers: ["com.client"] };

    fixture.model.send_message(REQUIRED, payload);

    assert.equal(fixture.send.calls[0].payload, payload);
    assert.deepEqual(payload, { required_identifiers: ["com.client"] });
  });

  it("raises gate_publish_failed and still sends when the listing throws", () => {
    const fixture = scene();
    fixture.cmm.activeServerModsToMount = () => {
      throw new Error("cmm broke");
    };
    const payload = {};

    fixture.model.send_message(REQUIRED, payload);

    assert.deepEqual(fixture.alarm("gate_publish_failed")[0].detail, {
      error: "Error: cmm broke",
    });
    assert.equal(fixture.send.calls[0].payload, payload);
  });
});

describe("reporting the viewer's server mods", () => {
  it("always reports a Galactic War server mod", () => {
    const fixture = scene({
      cmmOptions: {
        serverMods: [
          mod({
            identifier: "com.gw",
            galacticWarMod: true,
            display_name: "GW",
            version: "3",
          }),
          mod({ identifier: "com.plain" }),
        ],
      },
    });

    fixture.model.send_message(MANIFEST, {
      active_identifiers: ["com.client"],
    });

    assert.deepEqual(fixture.send.calls[0].payload, {
      active_identifiers: ["com.client", "com.gw"],
      active_required_identifiers: ["com.gw"],
      active_required_names_by_id: { "com.gw": "GW" },
      active_required_versions_by_id: { "com.gw": "3" },
    });
  });

  it("reports a plain server mod only once the host has asked for it", () => {
    const fixture = scene({
      cmmOptions: { serverMods: [mod({ identifier: "com.plain" })] },
    });

    fixture.ctx.handlers.request_client_mod_manifest({
      required_identifiers: ["COM.PLAIN"],
      required_names_by_id: { "com.plain": "Plain" },
      required_versions_by_id: { "com.plain": "1" },
    });
    fixture.model.send_message(MANIFEST, {
      active_identifiers: ["com.plain"],
      active_required_identifiers: ["com.plain"],
    });

    assert.deepEqual(fixture.ns.gate.hostRequired(), ["com.plain"]);
    assert.equal(fixture.ns.hostRequiresMod("com.plain"), true);
    assert.deepEqual(fixture.send.calls[0].payload.active_identifiers, [
      "com.plain",
    ]);
    assert.deepEqual(
      fixture.send.calls[0].payload.active_required_identifiers,
      ["com.plain"]
    );
    assert.equal(fixture.request.calls.length, 1);
  });

  it("leaves the payload untouched when nothing is shared", () => {
    const fixture = scene({ cmmOptions: { serverMods: [mod()] } });
    const payload = {};

    fixture.model.send_message(MANIFEST, payload);

    assert.deepEqual(payload, {});
  });

  it("raises gate_manifest_failed and still sends when the listing throws", () => {
    const fixture = scene();
    fixture.cmm.activeServerModsToMount = () => {
      throw new Error("cmm broke");
    };

    fixture.model.send_message(MANIFEST, {});

    assert.equal(fixture.alarm("gate_manifest_failed").length, 1);
    assert.equal(fixture.send.calls.length, 1);
  });

  it("passes other messages and non-object payloads straight through", () => {
    const fixture = scene({ cmmOptions: { serverMods: [mod()] } });

    fixture.model.send_message("chat", { text: "hi" });
    fixture.model.send_message(REQUIRED, "raw");
    fixture.model.send_message(MANIFEST, null);

    assert.deepEqual(
      fixture.send.calls.map((call) => call.payload),
      [{ text: "hi" }, "raw", null]
    );
  });
});

describe("the manifest request handler", () => {
  it("survives the scene assigning the handler after the mod loaded", () => {
    const fixture = scene();
    const late = recorder();

    const self = {};
    fixture.ctx.handlers.request_client_mod_manifest = late;
    const result = fixture.ctx.handlers.request_client_mod_manifest.call(
      self,
      { required_identifiers: ["Com.X"] },
      "extra"
    );

    assert.equal(result, "sent");
    assert.equal(late.calls[0].self, self);
    assert.equal(late.calls[0].payload, "extra");
    assert.deepEqual(fixture.ns.gate.hostRequired(), ["com.x"]);
    assert.equal(
      fixture.ctx.handlers.request_client_mod_manifest.__gwServerModsPatched,
      true
    );
  });

  it("ignores a request without a required list and hands out copies", () => {
    const fixture = scene();

    fixture.ctx.handlers.request_client_mod_manifest();
    fixture.ctx.handlers.request_client_mod_manifest({
      required_identifiers: "x",
    });
    fixture.ns.gate.hostRequired().push("com.injected");

    assert.deepEqual(fixture.ns.gate.hostRequired(), []);
    assert.equal(fixture.request.calls.length, 2);
  });

  it("keeps a non-function assignment as it is", () => {
    const fixture = scene();

    fixture.ctx.handlers.request_client_mod_manifest = null;

    assert.equal(fixture.ctx.handlers.request_client_mod_manifest, null);
  });
});
