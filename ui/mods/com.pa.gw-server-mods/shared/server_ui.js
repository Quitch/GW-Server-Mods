// A server mod's scene scripts load in a skirmish through the list Community
// Mods generates into its zip, which Galactic War never loads. See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.serverUi) {
    return;
  }

  var loaded = [];

  function alreadyListed(scene, url) {
    var lists = [
      root.global_mod_list,
      root.scene_mod_list && root.scene_mod_list[scene],
    ];

    return _.some(lists, function (list) {
      return _.isArray(list) && _.contains(list, url);
    });
  }

  function loadUrls(scene, urls) {
    urls = _.filter(urls, function (url) {
      return (
        _.isString(url) &&
        url.length &&
        !_.contains(loaded, url) &&
        !alreadyListed(scene, url)
      );
    });

    if (!urls.length) {
      return [];
    }

    loaded = loaded.concat(urls);

    try {
      loadMods(urls);
      ns.log("server mod UI loaded", { scene: scene, count: urls.length });
    } catch (e) {
      ns.log(
        "server mod UI load failed " + ((e && e.message) || e) + " " + scene
      );
    }

    return urls;
  }

  // loadMods is the game's own loader, synchronous, so this runs to completion
  // before the scene binds when called from a scene script. With no list in
  // hand the store is read instead, and that load lands after the scene has
  // bound - late, but the scripts still run.
  function load(scene) {
    if (typeof loadMods !== "function") {
      ns.log("loadMods unavailable; server mod UI not loaded", {
        scene: scene,
      });
      return [];
    }

    var urls = ns.manifest.scenes(scene);

    if (!urls.length && !ns.manifest.listed()) {
      ns.manifest.load().then(function () {
        loadUrls(scene, ns.manifest.scenes(scene));
      });
      return [];
    }

    return loadUrls(scene, urls);
  }

  ns.serverUi = {
    load: load,
    loaded: function () {
      return loaded.slice();
    },
  };
})(window);
