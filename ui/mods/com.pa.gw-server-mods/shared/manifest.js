// Identifiers and versions are normalised exactly as connect_to_game.js does.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.manifest) {
    return;
  }

  // Community Mods' generated aggregate, derived from the others, so it is not
  // something a player can be missing.
  var GENERATED_SERVER_MOD = "community-mods-server";

  function normalizeIdentifier(identifier) {
    if (!_.isString(identifier)) {
      return "";
    }

    var trimmed = identifier.trim();
    if (!trimmed.length) {
      return "";
    }

    return trimmed.toLowerCase();
  }

  function normalizeVersion(version) {
    if (_.isUndefined(version) || version === null) {
      return "";
    }

    return String(version).trim();
  }

  function manager() {
    return root.CommunityModsManager;
  }

  function available() {
    var mgr = manager();

    return !!(
      mgr &&
      _.isFunction(mgr.activeServerModsToMount) &&
      _.isFunction(mgr.mountServerMods)
    );
  }

  // Community Mods is absent from gw_start, so there its own store is read
  // through the stock `db` extender. Read only, never written: the extender
  // writes back on change and creates the record when the key is missing.
  // See design.md.
  var installed = null;
  var loading = null;

  function readInstalledMods() {
    if (
      typeof ko === "undefined" ||
      !root.localStorage ||
      !root.localStorage.installedModsDB
    ) {
      return Promise.resolve([]);
    }

    var store = ko.observableArray([]).extend({
      db: { local_name: "installedModsDB", db_name: "installed_mods" },
    });

    function read(mods) {
      return _.isArray(mods) ? mods : [];
    }

    // The extender rejects `ready` when the record is missing, which is a store
    // with nothing in it rather than a failure.
    return Promise.resolve(store.ready).then(read, read);
  }

  function load() {
    if (available() || installed) {
      return Promise.resolve(true);
    }

    if (loading) {
      return loading;
    }

    loading = readInstalledMods().then(function (mods) {
      installed = _.filter(mods, function (mod) {
        return mod && mod.enabled;
      });
      loading = null;
      ns.log("installed mods read without Community Mods", {
        count: installed.length,
      });
      return true;
    });

    return loading;
  }

  function listed() {
    return available() || !!installed;
  }

  // The mount order Community Mods uses: priority descending.
  function fallbackServerMods() {
    return _.sortByOrder(
      _.filter(installed, function (mod) {
        return mod.context === "server";
      }),
      "priority",
      "desc"
    );
  }

  function fallbackClientMods() {
    return _.sortBy(
      _.filter(installed, function (mod) {
        return mod.context === "client";
      }),
      "priority"
    );
  }

  function describe(mod) {
    var identifier = normalizeIdentifier(mod && mod.identifier);

    return {
      identifier: identifier,
      // The gate lower-cases; the game needs the case it was installed under.
      rawIdentifier: (mod && mod.identifier) || identifier,
      displayName:
        _.isString(mod && mod.display_name) && mod.display_name.length
          ? mod.display_name
          : identifier,
      version: normalizeVersion(mod && mod.version),
      installedPath: mod && mod.installedPath,
      fileSystem: !!(mod && mod.fileSystem),
      galacticWarMod: !!(mod && mod.galacticWarMod === true),
      scenes: _.isPlainObject(mod && mod.scenes) ? mod.scenes : {},
    };
  }

  function activeServerMods() {
    if (!listed()) {
      ns.alarm("cmm_unavailable", { where: "manifest.activeServerMods" });
      return [];
    }

    var records = available()
      ? manager().activeServerModsToMount()
      : fallbackServerMods();

    var described = _.map(records, describe);

    return _.filter(described, function (mod) {
      return mod.identifier.length && mod.identifier !== GENERATED_SERVER_MOD;
    });
  }

  function serverModInfo(identifier) {
    var wanted = normalizeIdentifier(identifier);

    return _.find(activeServerMods(), function (mod) {
      return mod.identifier === wanted;
    });
  }

  // A faction splits its art: models in the server mod, textures in the client
  // mod it names in `companions`. See design.md.
  function pairedClientMods() {
    var records;
    var clientRecords;

    if (available()) {
      if (!_.isFunction(manager().activeInstalledClientMods)) {
        return [];
      }
      records = manager().activeServerModsToMount();
      clientRecords = manager().activeInstalledClientMods();
    } else if (installed) {
      records = fallbackServerMods();
      clientRecords = fallbackClientMods();
    } else {
      return [];
    }

    var wanted = [];

    _.forEach(records, function (mod) {
      if (_.isArray(mod.companions)) {
        wanted = _.union(wanted, _.map(mod.companions, normalizeIdentifier));
      }
    });

    if (!wanted.length) {
      return [];
    }

    // Folder-installed mods are excluded from activeClientZipMods, and a
    // companion is just as likely to be one.
    var paired = _.filter(_.map(clientRecords, describe), function (mod) {
      return _.contains(wanted, mod.identifier);
    });

    if (paired.length !== wanted.length) {
      ns.log("companion client mods not all active", {
        wanted: wanted,
        mounted: _.map(paired, function (mod) {
          return mod.identifier;
        }),
      });
    }

    return paired;
  }

  // Trees the server reads alone. Anything else under pa/ - units, terrain and
  // its CSG models, effects, anim - has to be on the client too. Excluding the
  // known server-only trees rather than listing the rendered ones means an
  // unrecognised tree is treated as client-relevant: too strict, never too lax.
  var SERVER_ONLY = /^ai(_|$)/;

  // Each scene is its own page with its own copy of this module, so the answer
  // is persisted: the mount that classifies runs in one scene and the gate that
  // reads it runs in another.
  var RELEVANCE_KEY = "gw_server_mods_relevance";
  var relevance = null;

  function loadRelevance() {
    if (relevance) {
      return relevance;
    }

    try {
      relevance = JSON.parse(sessionStorage.getItem(RELEVANCE_KEY) || "{}");
    } catch (e) {
      relevance = {};
    }

    return relevance;
  }

  function saveRelevance() {
    try {
      sessionStorage.setItem(RELEVANCE_KEY, JSON.stringify(loadRelevance()));
    } catch (e) {
      ns.log("server mod classification not persisted");
    }
  }

  // An unpacked mod keeps its install folder name, not its identifier.
  // Community Mods mounts a zip under the identifier's installed case, so the
  // path must use rawIdentifier; the lower-cased form is for the gate only.
  function modRoot(mod) {
    return mod.fileSystem
      ? mod.installedPath
      : "/server_mods/" + mod.rawIdentifier + "/";
  }

  function leafName(path) {
    var trimmed = String(path).replace(/\/$/, "");

    return trimmed.slice(trimmed.lastIndexOf("/") + 1);
  }

  function detectRelevance(mod) {
    function assumeRelevant() {
      // Unknown shape, so assume the client needs it.
      loadRelevance()[mod.identifier] = true;
    }

    if (!api.file || !_.isFunction(api.file.list)) {
      assumeRelevant();
      return Promise.resolve();
    }

    return Promise.resolve(api.file.list(modRoot(mod) + "pa/", false)).then(
      function (listing) {
        var entries =
          listing && listing.length ? listing : _.keys(listing || {});

        loadRelevance()[mod.identifier] = _.some(entries, function (entry) {
          return !SERVER_ONLY.test(leafName(entry));
        });
      },
      assumeRelevant
    );
  }

  function detectClientRelevance(mods) {
    return ns
      .settled(
        _.map(mods, function (mod) {
          return detectRelevance(mod);
        })
      )
      .then(saveRelevance);
  }

  // Only these need to match between host and viewer. Empty until a mount has
  // run, and the gate treats that as "require everything" rather than nothing.
  function clientRelevantServerMods() {
    var known = loadRelevance();

    return _.filter(activeServerMods(), function (mod) {
      return known[mod.identifier] === true;
    });
  }

  function relevanceKnown() {
    return _.keys(loadRelevance()).length > 0;
  }

  // The scene scripts the active server mods declare, keyed by scene, as
  // Community Mods' activeServerModScenes builds them for a skirmish. Persisted
  // like the classification: the battle scenes have no Community Mods and no
  // store of their own to ask.
  //
  // localStorage, not sessionStorage: sessionStorage is per panel, not per
  // process. live_game holds the key and live_game_build_bar cannot see it, and
  // the build bar is the panel that needs the list earliest - build.js reads
  // scene_mod_list["shared_build"] before the scene's own mods load. Without a
  // list in hand at that moment the read goes async and lands after the build
  // set is built, which costs a whole faction its build bar. See design.md.
  var SCENES_KEY = "gw_server_mods_scenes";
  var scenesCache = null;

  function unionScenes(mods) {
    var scenes = {};

    _.forEach(mods, function (mod) {
      _.forEach(mod.scenes, function (urls, scene) {
        if (_.isArray(urls)) {
          scenes[scene] = _.union(scenes[scene] || [], urls);
        }
      });
    });

    return scenes;
  }

  // An empty list is not evidence: connect_to_game mounts before Community
  // Mods has read its store, and that run must not erase what gw_play wrote.
  function rememberScenes(mods) {
    if (!mods || !mods.length) {
      return scenesCache;
    }

    scenesCache = unionScenes(mods);

    try {
      localStorage.setItem(SCENES_KEY, JSON.stringify(scenesCache));
    } catch (e) {
      ns.log("server mod scene list not persisted");
    }

    return scenesCache;
  }

  // localStorage first, then the sessionStorage a previous build of this mod
  // wrote, so an upgrade mid-session still finds a list.
  function storedScenes() {
    var read = function (store) {
      try {
        return JSON.parse(store.getItem(SCENES_KEY) || "null");
      } catch (e) {
        return null;
      }
    };

    return read(localStorage) || read(sessionStorage) || {};
  }

  function scenes(scene) {
    var active = listed() ? activeServerMods() : [];

    if (active.length) {
      scenesCache = unionScenes(active);
    } else if (!scenesCache) {
      scenesCache = storedScenes();
    }

    return _.isUndefined(scene) ? scenesCache : scenesCache[scene] || [];
  }

  function identifiers() {
    return _.map(activeServerMods(), function (mod) {
      return mod.identifier;
    });
  }

  function rawIdentifiers() {
    return _.map(activeServerMods(), function (mod) {
      return mod.rawIdentifier;
    });
  }

  // jQuery on the way out: a caller's $.when cannot see a native promise any
  // more than an engine one. See design.md.
  ns.manifest = {
    available: available,
    load: function () {
      return ns.jq(load());
    },
    listed: listed,
    activeServerMods: activeServerMods,
    serverModInfo: serverModInfo,
    scenes: scenes,
    rememberScenes: rememberScenes,
    modRoot: modRoot,
    pairedClientMods: pairedClientMods,
    detectClientRelevance: function (mods) {
      return ns.jq(detectClientRelevance(mods));
    },
    clientRelevantServerMods: clientRelevantServerMods,
    relevanceKnown: relevanceKnown,
    identifiers: identifiers,
    rawIdentifiers: rawIdentifiers,
    normalizeIdentifier: normalizeIdentifier,
    normalizeVersion: normalizeVersion,
  };
})(window);
