"use strict";

// global_mod_list/translations.js and the files Mod Translations reads from
// translations/: the en-US catalog holds exactly the !LOC: keys the shipped
// code asks for, and every language file is one the game can load.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MOD_ROOT,
  createContext,
  loadFile,
} = require("../scripts/lib/scene-loader.js");

const DIR = path.join(MOD_ROOT, "translations");
const CATALOG = "en-US.json";
// The game's ui/main/_i18n/locales/ folders, which Mod Translations keys on.
const LOCALES = [
  "ar",
  "cs-CZ",
  "da",
  "de",
  "de-AT",
  "en",
  "en-US",
  "es-ES",
  "fi",
  "fr",
  "hu-HU",
  "it",
  "ja",
  "ko",
  "nl",
  "nl-BE",
  "no",
  "pl-PL",
  "pt-BR",
  "ro",
  "ru",
  "sv",
  "tr-TR",
  "uk",
  "zh-CN",
  "zh-HK",
  "zh-TW",
];

function shippedScripts(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return shippedScripts(full);
    }
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

function sourceKeys() {
  const keys = new Set();
  for (const file of shippedScripts(MOD_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(["'])!LOC:((?:(?!\1).)*)\1/g)) {
      keys.add(match[2]);
    }
  }
  return keys;
}

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
}

const files = fs.readdirSync(DIR);
const catalog = read(CATALOG);

describe("the translation files", () => {
  it("are game locales, with the en-US catalog among them", () => {
    assert.equal(files.includes(CATALOG), true);
    for (const name of files) {
      assert.equal(LOCALES.includes(name.replace(/\.json$/, "")), true, name);
      assert.equal(name.endsWith(".json"), true, name);
    }
  });

  it("catalog exactly the !LOC: keys the shipped code asks for", () => {
    assert.deepEqual(Object.keys(catalog).sort(), [...sourceKeys()].sort());
  });

  it("give the catalog's keys as their own messages, with a note", () => {
    for (const [key, entry] of Object.entries(catalog)) {
      assert.equal(entry.message, key);
      assert.equal(typeof entry.description, "string", key);
      assert.notEqual(entry.description.trim(), "", key);
    }
  });

  it("name in each note a file that holds the key", () => {
    for (const [key, entry] of Object.entries(catalog)) {
      const named = entry.description.match(/[\w/]+\.js/g) || [];
      assert.notEqual(named.length, 0, key);
      for (const file of named) {
        const source = fs.readFileSync(path.join(MOD_ROOT, file), "utf8");
        assert.equal(source.includes('"!LOC:' + key + '"'), true, file);
      }
    }
  });

  it("translate only catalog keys, with no note", () => {
    for (const name of files.filter((file) => file !== CATALOG)) {
      for (const [key, entry] of Object.entries(read(name))) {
        assert.equal(key in catalog, true, name + " " + key);
        assert.deepEqual(Object.keys(entry), ["message"], name + " " + key);
      }
    }
  });

  it("hold entries the loader accepts, sorted, each key once", () => {
    for (const name of files) {
      const text = fs.readFileSync(path.join(DIR, name), "utf8");
      const keys = Object.keys(JSON.parse(text));
      // JSON.parse keeps the last of two equal keys without a word.
      const lines = text.match(/^ {2}"(?:[^"\\]|\\.)*":/gm) || [];

      assert.equal(lines.length, keys.length, name);
      assert.deepEqual(
        keys,
        keys.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        name
      );
      for (const [key, entry] of Object.entries(JSON.parse(text))) {
        assert.equal(key, key.trim(), name);
        assert.equal(/;;|::/.test(key), false, name + " " + key);
        assert.equal(typeof entry.message, "string", name + " " + key);
        assert.notEqual(entry.message.trim(), "", name + " " + key);
      }
    }
  });
});

describe("the translation registration", () => {
  function page(translations) {
    const ctx = createContext({ ModTranslations: translations });
    loadFile(ctx, "global_mod_list/translations.js");
    return ctx;
  }

  it("registers this mod's folder with Mod Translations", () => {
    const calls = [];
    page({ register: (...args) => calls.push(args) });

    assert.deepEqual(calls, [["com.pa.gw-server-mods"]]);
  });

  it("does nothing without Mod Translations or its register", () => {
    assert.doesNotThrow(() => page(undefined));
    assert.doesNotThrow(() => page({}));
  });

  it("logs rather than throws when the register throws", () => {
    const ctx = page({
      register: () => {
        throw new Error("bad root");
      },
    });

    assert.deepEqual(ctx.console.lines.error, [
      "[GW-SM] translations not registered bad root",
    ]);
  });
});
