// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});
  var MARK = "__gwServerModsPatched";

  // The same suffix test Community Mods uses to skip these modes; the two
  // wrappers are nested on one call and must agree about what is GW.
  function isGwMode(mode) {
    return _.isString(mode) && mode.substr(-2, 2).toLowerCase() === "gw";
  }

  var GW_PLAY = "coui://ui/main/game/galactic_war/gw_play/gw_play.html";

  function urlParam(name) {
    var match = new RegExp("[?&]" + name + "=([^&#]*)").exec(
      (root.location && root.location.search) || ""
    );

    if (!match) {
      return null;
    }

    try {
      return decodeURIComponent(match[1].replace(/\+/g, " "));
    } catch (e) {
      return match[1];
    }
  }

  function parsed(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  // ko's session extender reads the engine's backup only when sessionStorage
  // has nothing under the key. It writes the backup encoded, and writes the
  // string "undefined" for a cleared value.
  function session(key) {
    var text = sessionStorage.getItem(key);

    if (text) {
      return parsed(text);
    }

    var backup = root.gSessionBackup && root.gSessionBackup[key];

    if (!_.isString(backup) || backup === "undefined") {
      return null;
    }

    var decoded = parsed(backup);

    return decoded === null ? backup : decoded;
  }

  function fromGwPlay() {
    var destination = session("connect_fail_destination");

    return _.isString(destination) && _.startsWith(destination, GW_PLAY);
  }

  // See design.md.
  function isGwConnect() {
    var mode = urlParam("mode");

    if (urlParam("action") === "start") {
      return (
        isGwMode(mode) ||
        mode === "gw_campaign" ||
        (mode === "loadsave" && fromGwPlay())
      );
    }

    var setup = session("game_server_setup");

    if (setup) {
      return setup === "gw_campaign" || session("game_type") === "GalacticWar";
    }

    var reconnect =
      parsed(localStorage.getItem("reconnect_to_game_info")) || {};

    return (
      reconnect.setup === "gw_campaign" || reconnect.game === "GalacticWar"
    );
  }

  function applyIdentifiers() {
    if (!model || !_.isFunction(model.gameModIdentifiers)) {
      return;
    }

    // This list goes back to the game, not to the gate, so case matters.
    var expected = ns.manifest.rawIdentifiers();

    if (!expected.length) {
      return;
    }

    model.gameModIdentifiers(
      _.uniq((model.gameModIdentifiers() || []).concat(expected))
    );

    var applied = model.gameModIdentifiers() || [];
    var lost = _.filter(expected, function (identifier) {
      return !_.includes(applied, identifier);
    });

    if (lost.length) {
      // Something wrote over the list; the battle would start without its
      // server mods declared.
      ns.alarm("identifiers_lost", { expected: expected, applied: applied });
    }
  }

  function patchStartGame() {
    if (!api.net || !_.isFunction(api.net.startGame)) {
      return false;
    }

    if (api.net.startGame[MARK]) {
      return true;
    }

    var previous = api.net.startGame;

    api.net.startGame = function (region, mode, startParams) {
      if (root.gNoMods || !isGwMode(mode)) {
        return previous(region, mode, startParams);
      }

      // A mount that failed must not hold up the battle, so its outcome is
      // dropped rather than chained. The chain starts native so it adopts
      // whatever shape startGame returns - engine on the remote branch of
      // api/net.js, jQuery on the local one - and ends jQuery because stock
      // connect_to_game.js:709 calls .always() on it.
      return ns.jq(
        ns
          .settled([ns.mount.run()])
          .then(function () {
            return previous(region, mode, startParams);
          })
          .then(function (data) {
            applyIdentifiers();
            return data;
          })
      );
    };

    api.net.startGame[MARK] = true;

    ns.log("startGame patched");

    return true;
  }

  try {
    if (isGwConnect()) {
      ns.manifest.markGwBattle(true);
      ns.hooks.install();
    } else {
      // Community Mods loads this battle's server mod UI itself.
      ns.manifest.markGwBattle(false);
      ns.manifest.forgetScenes();
      ns.log("not a Galactic War connect; hooks not installed");
    }

    if (!patchStartGame()) {
      ns.alarm("start_unavailable", { where: "api.net.startGame" });
    }
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})(window);
