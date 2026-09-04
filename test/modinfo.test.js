"use strict";

// modinfo.json: every scene entry is a shipped file in the order the modules
// depend on, and the release metadata agrees with the changelog.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  MOD_ROOT,
  REPO_ROOT,
  couiToFsPath,
  modinfo,
  sceneFiles,
} = require("../scripts/lib/scene-loader.js");
const { SHARED } = require("../scripts/lib/shared-scene.js");

const info = modinfo();
const scenes = Object.keys(info.scenes);

function shipped(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? shipped(full) : [full];
  });
}

describe("modinfo scenes", () => {
  it("name only files that exist", () => {
    for (const scene of scenes) {
      for (const entry of sceneFiles(scene)) {
        assert.equal(fs.existsSync(couiToFsPath(entry)), true, entry);
      }
    }
  });

  it("load every shipped file somewhere", () => {
    const referenced = new Set(
      scenes.flatMap((scene) => sceneFiles(scene).map(couiToFsPath))
    );

    for (const file of shipped(MOD_ROOT)) {
      assert.equal(referenced.has(file), true, path.relative(REPO_ROOT, file));
    }
  });

  it("load the shared modules first, in dependency order", () => {
    const order = SHARED.concat(["shared/server_ui.js"]).map((file) =>
      path.join(MOD_ROOT, file)
    );
    const required = SHARED.slice(0, 2).map((file) =>
      path.join(MOD_ROOT, file)
    );

    for (const scene of scenes.filter((name) => name !== "icon_atlas")) {
      const files = sceneFiles(scene).map(couiToFsPath);
      const shared = files.filter((file) => order.includes(file));
      const own = files.filter((file) => !order.includes(file));

      assert.deepEqual(files.slice(0, shared.length), shared, scene);
      assert.deepEqual(
        shared,
        order.filter((file) => shared.includes(file)),
        scene
      );
      for (const file of required) {
        assert.equal(shared.includes(file), true, scene + " " + file);
      }
      for (const file of own) {
        assert.equal(path.dirname(file), path.join(MOD_ROOT, scene), file);
      }
    }
  });

  it("give gw_coop_per_player_loadout the shared modules and nothing else", () => {
    // The Galactic War mod calls mount.run itself there, so a viewer who is not
    // choosing a modded commander pays for no mount. See design.md.
    assert.deepEqual(
      sceneFiles("gw_coop_per_player_loadout").map(couiToFsPath),
      [
        "promise.js",
        "alarm.js",
        "manifest.js",
        "mount.js",
        "capability.js",
      ].map((file) => path.join(MOD_ROOT, "shared", file))
    );
  });

  it("cover every scene a faction server mod ships build bar data in", () => {
    // Bugs and Exiles put their build groups and their SpecIdToGridMap entries
    // in shared_build. Without an entry here that script never runs, every one
    // of that faction's units falls into a group no tab shows, and the player
    // has no build bar. See design.md.
    for (const scene of ["shared_build", "live_game_build_bar"]) {
      assert.equal(scenes.includes(scene), true, scene);
    }
  });

  it("give icon_atlas only its own script", () => {
    assert.deepEqual(sceneFiles("icon_atlas").map(couiToFsPath), [
      path.join(MOD_ROOT, "icon_atlas", "icons.js"),
    ]);
  });
});

describe("modinfo release metadata", () => {
  it("is a Galactic War client mod", () => {
    assert.equal(info.context, "client");
    assert.equal(info.galacticWarMod, true);
  });

  it("has a changelog entry for its version", () => {
    const changelog = fs.readFileSync(
      path.join(REPO_ROOT, "CHANGELOG.md"),
      "utf8"
    );

    assert.match(
      changelog,
      new RegExp("^## v" + info.version.replace(/\./g, "\\.") + " ", "m")
    );
  });
});
