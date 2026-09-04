// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});
  var MARK = "__gwServerModsPatched";

  // The same suffix test Community Mods uses to skip these modes; the two
  // wrappers are nested on one call and must agree about what is GW.
  function isGwMode(mode) {
    return _.isString(mode) && mode.substr(-2, 2).toLowerCase() === "gw";
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
      return applied.indexOf(identifier) === -1;
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
    ns.hooks.install();

    if (!patchStartGame()) {
      ns.alarm("start_unavailable", { where: "api.net.startGame" });
    }
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})(window);
