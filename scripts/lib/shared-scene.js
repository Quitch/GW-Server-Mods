"use strict";

// The six shared modules loaded in modinfo.json's order over a full set of
// engine fakes, which a test then adjusts or extends with a scene script. Pass
// `null` for api/cmm/model to leave that global absent.

const { createContext, loadFile } = require("./scene-loader.js");
const { createFakeApi } = require("./fake-api.js");
const { createFakeCmm } = require("./fake-cmm.js");
const { createFakeJQuery } = require("./fake-jquery.js");

const SHARED = [
  "shared/promise.js",
  "shared/alarm.js",
  "shared/manifest.js",
  "shared/mount.js",
  "shared/hooks.js",
  "shared/capability.js",
];

function orAbsent(value, build) {
  if (value === null) {
    return undefined;
  }
  return value === undefined ? build() : value;
}

function sharedScene(options) {
  const opts = options || {};
  const $ = opts.$ || createFakeJQuery({ ajax: opts.ajax });
  const api = orAbsent(opts.api, () => createFakeApi(opts.apiOptions));
  const cmm = orAbsent(opts.cmm, () => createFakeCmm(opts.cmmOptions));
  const model = orAbsent(opts.model, () => ({}));
  const ctx = createContext(
    Object.assign(
      { $: $, api: api, CommunityModsManager: cmm, model: model },
      opts.stubs
    )
  );

  (opts.files || SHARED).forEach((file) => loadFile(ctx, file));

  return {
    ctx: ctx,
    ns: ctx.GwServerMods,
    api: api,
    cmm: cmm,
    model: model,
    $: $,
    console: ctx.console,
    codes: () => ctx.GwServerMods.alarms().map((record) => record.code),
    alarm: (code) =>
      ctx.GwServerMods.alarms().filter((record) => record.code === code),
  };
}

module.exports = { SHARED, sharedScene };
