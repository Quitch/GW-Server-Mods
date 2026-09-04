// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.mount) {
    return;
  }

  var state = {
    mounted: false,
    at: 0,
    mods: [],
    sequence: 0,
  };

  var running = null;
  var runningWithContent = false;
  var runningRootOnly = false;

  // A read that failed is a read that found nothing; nothing here treats the
  // two differently, and none of these may reject.
  function nothing() {
    return null;
  }

  function zipMountAvailable() {
    return !!(api.file && api.file.zip && _.isFunction(api.file.zip.mount));
  }

  function mountAtRoot(mod) {
    // Nothing can mount a folder at the root: zip.mount rejects one and there is
    // no directory equivalent. Whether that matters is decided once the mod has
    // been classified, in reportUnmountableMods.
    if (mod.fileSystem) {
      return Promise.resolve(true);
    }

    if (!_.isString(mod.installedPath) || !mod.installedPath.length) {
      ns.alarm("zip_missing", { identifier: mod.identifier });
      return Promise.resolve(false);
    }

    function failed() {
      ns.alarm("mount_failed", {
        identifier: mod.identifier,
        path: mod.installedPath,
      });

      return false;
    }

    // One mod that will not mount must not fail the run, so both outcomes
    // resolve and the caller reads the answer rather than a rejection.
    return Promise.resolve(
      api.file.zip.mount(mod.installedPath, "/", false)
    ).then(function (ok) {
      return ok ? true : failed();
    }, failed);
  }

  // spec:// rejects a query string, so cache-busting it returns 404.
  // Mounting alone leaves models and textures unregistered with the renderer.
  function remountContent() {
    if (!api.content || !_.isFunction(api.content.remount)) {
      ns.alarm("content_remount_unavailable", {});
      return Promise.resolve();
    }

    return Promise.resolve(api.content.remount());
  }

  function readUnitList(url) {
    return Promise.resolve(
      $.ajax({
        url: url,
        dataType: "text",
        cache: url.indexOf("coui://") !== 0,
      })
    ).then(function (data) {
      var parsed = data;

      if (_.isString(data)) {
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = null;
        }
      }

      return parsed && _.isArray(parsed.units) ? parsed.units : null;
    }, nothing);
  }

  // The base game's own unit list, captured before anything shadows it.
  //
  // Every faction server mod ships pa/units/unit_list.json, and mountAtRoot puts
  // them all at "/", so from the first root mount onwards a read of that path
  // returns whichever faction mounted last. This mod is the only thing that
  // mounts at the root - Community Mods mounts under /server_mods/<id>/ and
  // /client_mods/<id>/ - so a read taken before the first mountAtRoot of the
  // process is the unshadowed base list, and it is worth keeping. There is no
  // pa_ex1 path to read instead: pa_ex1 is mounted onto pa before mods are.
  // See design.md.
  var VANILLA_KEY = "gw_server_mods_vanilla_units";
  var vanillaUnits;

  function loadVanillaUnits() {
    if (vanillaUnits) {
      return vanillaUnits;
    }

    try {
      var stored = JSON.parse(sessionStorage.getItem(VANILLA_KEY) || "null");
      if (_.isArray(stored)) {
        vanillaUnits = stored;
      }
    } catch (e) {
      vanillaUnits = undefined;
    }

    return vanillaUnits;
  }

  // Called before the first mount of a run, so the read still sees the base
  // game. Resolves either way: a base list that cannot be read costs four units
  // in one faction combination, and must never cost a battle.
  function captureVanillaUnits() {
    if (loadVanillaUnits()) {
      return Promise.resolve(vanillaUnits);
    }

    return readUnitList("coui://pa/units/unit_list.json").then(
      function (units) {
        if (!_.isArray(units)) {
          ns.log("base unit list not read");
          return undefined;
        }

        vanillaUnits = units;

        try {
          sessionStorage.setItem(VANILLA_KEY, JSON.stringify(units));
        } catch (e) {
          // In-memory only for the rest of this scene.
          ns.log("base unit list not persisted");
        }

        return units;
      }
    );
  }

  function reportUnmerged(detail, reason) {
    detail.reason = reason;

    if (detail.lists > 1) {
      ns.alarm("unit_list_unmerged", detail);
    } else {
      ns.log("unit list not merged", detail);
    }
  }

  // The last merge this scene mounted, kept so a root-only run can put it
  // back: its zip mounts land at "/" after the memory file and re-shadow it.
  // The merge itself cannot run there - its spec:/server_mods/<id>/ reads
  // exist only once CommunityModsManager.mountServerMods has run, and spec:
  // pins a path's first read for the whole process. Scene-scoped on purpose:
  // the harmful sequence - a battle mount then a root-only one - happens
  // inside gw_play, gw_start has no merge to restore, and a merge carried
  // across scenes could name the wrong mod set. See design.md.
  var mergedUnitFile;

  // Every faction ships its own unit_list.json and the root mounts shadow each
  // other, so the referee would only see the last one. See design.md.
  function mergeUnitList(mods) {
    var mgr = CommunityModsManager;

    if (
      _.isFunction(mgr.mergeUnitServerMods) &&
      mgr.mergeUnitServerMods() === false
    ) {
      ns.log("unit list merge disabled by Community Mods");
      return Promise.resolve();
    }

    // Every read is through coui://, never spec://: the engine caches a spec://
    // path after its first read, and the referee reads the merged list through
    // spec://, so a spec:// read here would pin the unmerged list for the whole
    // process. The base list comes from captureVanillaUnits rather than a read
    // taken now, which the root mounts would shadow. See design.md.
    var reads = [Promise.resolve(loadVanillaUnits())].concat(
      _.map(
        _.filter(mods, function (mod) {
          return !mod.fileSystem;
        }),
        function (mod) {
          return readUnitList(
            "spec:/" + ns.manifest.modRoot(mod) + "pa/units/unit_list.json"
          );
        }
      )
    );

    return ns.settled(reads).then(function (lists) {
      var modLists = _.filter(lists.slice(1), _.isArray);

      if (!modLists.length) {
        return undefined;
      }

      var merged = _.union.apply(_, [lists[0] || []].concat(modLists));
      var detail = { units: merged.length, lists: modLists.length };
      var payload = JSON.stringify({ units: merged });

      if (!api.file || !_.isFunction(api.file.mountMemoryFiles)) {
        reportUnmerged(detail, "mountMemoryFiles unavailable");
        return undefined;
      }

      return Promise.resolve(
        api.file.mountMemoryFiles({ "/pa/units/unit_list.json": payload })
      ).then(
        function () {
          mergedUnitFile = { payload: payload, detail: detail };
          ns.log("merged unit list", detail);
        },
        function (error) {
          reportUnmerged(detail, String(error));
        }
      );
    });
  }

  // Called by mountRootOnly after its zip mounts, which re-shadow the memory
  // file. No cached merge means nothing to restore - gw_start, or a scene
  // whose merge never mounted.
  function restoreMergedUnitList() {
    if (
      !mergedUnitFile ||
      !api.file ||
      !_.isFunction(api.file.mountMemoryFiles)
    ) {
      return Promise.resolve();
    }

    var detail = _.clone(mergedUnitFile.detail);

    return Promise.resolve(
      api.file.mountMemoryFiles({
        "/pa/units/unit_list.json": mergedUnitFile.payload,
      })
    ).then(
      function () {
        ns.log("restored merged unit list", detail);
      },
      function (error) {
        reportUnmerged(detail, String(error));
      }
    );
  }

  // GWO's battle-preparation screen, when present. Resolved at call time:
  // GWO loads after this mod, and outside a launch the call is a no-op there.
  // See design.md.
  function report(key) {
    var progress = root.model && root.model.gwoLaunchProgress;

    if (!progress || !_.isFunction(progress.stage)) {
      return;
    }

    try {
      progress.stage(loc(key));
    } catch (e) {
      ns.log("progress report failed " + ((e && e.message) || e));
    }
  }

  function probe(path) {
    var bustable = path.indexOf("coui://") === 0;

    return Promise.resolve(
      $.ajax({ url: path, dataType: "text", cache: !bustable })
    ).then(
      function () {
        return true;
      },
      function () {
        return false;
      }
    );
  }

  // A folder-installed server mod the client has to render cannot be made
  // visible to it. An AI-only one is unaffected, so this waits for the
  // classification rather than warning about every folder mod.
  function reportUnmountableMods() {
    var stranded = _.filter(
      ns.manifest.clientRelevantServerMods(),
      function (mod) {
        return mod.fileSystem;
      }
    );

    _.forEach(stranded, function (mod) {
      ns.alarm("filesystem_server_mod", {
        identifier: mod.identifier,
        path: mod.installedPath,
      });
    });
  }

  function verify(mods) {
    var checks = [probe("coui://server_mods/mods.json")];

    _.forEach(mods, function (mod) {
      checks.push(probe("coui:/" + ns.manifest.modRoot(mod) + "modinfo.json"));
    });

    // The referee's own input.
    checks.push(probe("spec://pa/units/unit_list.json"));

    return ns.settled(checks).then(function (results) {
      var ok = !_.contains(results, false);

      if (!ok) {
        ns.alarm("probe_failed", {
          manifest: results[0],
          mods: results.slice(1, results.length - 1),
          unitList: results[results.length - 1],
        });
      }

      return ok;
    });
  }

  function settle(ok, mods) {
    state = {
      mounted: ok,
      at: Date.now(),
      mods: mods,
      sequence: state.sequence + 1,
    };

    ns.log("mounted server mods", { ok: ok, count: mods.length });
  }

  // gw_start has no Community Mods and no battle to prepare: only the root
  // mounts, so the mods' specs and images are readable there. See design.md.
  function mountRootOnly(mods, withContent) {
    var rootMounts = _.map(
      mods.concat(ns.manifest.pairedClientMods()),
      mountAtRoot
    );
    var ok;

    return ns
      .settled(rootMounts)
      .then(function (results) {
        ok = !_.contains(results, false);

        return ns.settled([
          withContent ? remountContent() : null,
          restoreMergedUnitList(),
        ]);
      })
      .then(function () {
        settle(ok, mods);

        return ok;
      });
  }

  function mountForBattle(mods, withContent) {
    report("!LOC:Mounting server mods");

    var rootMounts = _.map(
      mods.concat(ns.manifest.pairedClientMods()),
      mountAtRoot
    );

    return ns
      .settled(rootMounts)
      .then(function () {
        return ns.settled([CommunityModsManager.mountServerMods()]);
      })
      .then(function () {
        if (withContent) {
          report("!LOC:Registering server mod content");
        }

        return ns.settled([
          withContent ? remountContent() : null,
          mergeUnitList(mods),
          ns.manifest.detectClientRelevance(mods),
        ]);
      })
      .then(function () {
        reportUnmountableMods();

        return verify(mods);
      })
      .then(function (ok) {
        settle(ok, mods);

        return ok;
      });
  }

  // Repeatable: Galactic War tears the mounts down more than once per battle.
  // remountContent is false only for a running battle, where it blanks the scene.
  function runOnce(options) {
    var withContent = !options || options.remountContent !== false;
    var rootOnly = !!(options && options.rootOnly);

    if (!rootOnly && !ns.manifest.available()) {
      return Promise.resolve(false);
    }

    if (!zipMountAvailable()) {
      ns.alarm("cmm_unavailable", { where: "api.file.zip.mount" });
      return Promise.resolve(false);
    }

    return Promise.resolve(ns.manifest.load()).then(function () {
      var mods = ns.manifest.activeServerMods();

      ns.manifest.rememberScenes(mods);

      if (!mods.length) {
        settle(true, []);

        return true;
      }

      // Before the first mountAtRoot, while the base list is still readable.
      return ns.settled([captureVanillaUnits()]).then(function () {
        return rootOnly
          ? mountRootOnly(mods, withContent)
          : mountForBattle(mods, withContent);
      });
    });
  }

  // A single unmount reaches here through two wrappers, and a full cycle costs
  // seconds, so concurrent callers share one run. A caller that needs the
  // content remount is the exception: a run that skipped it leaves the models
  // unregistered, so sharing one would start the battle with every unit
  // invisible. That caller waits for the run in flight and then gets its own -
  // queued rather than started, since two runs must not overlap their mounts.
  // A root-only run in flight is the other exception for a battle caller: it
  // merged nothing and made no /server_mods/<id>/ mounts, so only another
  // root-only caller may share it.
  function run(options) {
    var withContent = !options || options.remountContent !== false;
    var rootOnly = !!(options && options.rootOnly);

    if (
      running &&
      (runningWithContent || !withContent) &&
      (!runningRootOnly || rootOnly)
    ) {
      return running;
    }

    var previous = running;
    var current;

    if (previous) {
      current = ns.settled([previous]).then(function () {
        return runOnce(options);
      });
    } else {
      current = runOnce(options);
    }

    // jQuery on the way out: a caller's $.when cannot see a native promise any
    // more than an engine one. Wrapped once rather than per call, so concurrent
    // callers still share the object. See design.md.
    current = ns.jq(current);

    // The queued run supersedes the one it waits on, so only the run still
    // current may clear. Nothing can settle before this function returns - the
    // native promise behind it settles on a microtask - but the ordering is
    // still the one to keep: two runs must not overlap their mounts.
    function clear() {
      if (running === current) {
        running = null;
      }
    }

    running = current;
    runningWithContent = withContent;
    runningRootOnly = rootOnly;
    current.then(clear, clear);

    return current;
  }

  ns.mount = {
    run: run,
    sequence: function () {
      return state.sequence;
    },
    state: function () {
      return state;
    },
  };
})(window);
