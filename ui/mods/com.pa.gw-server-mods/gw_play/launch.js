// The referee generates unit specs shortly after this, so the mounts have to be
// in place. Stock restartFight delegates to model.fight, so one patch covers
// both entry points.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});
  var MARK = "__gwServerModsPatched";

  function patchFight(name) {
    if (!model || !_.isFunction(model[name])) {
      return false;
    }

    if (model[name][MARK]) {
      return true;
    }

    var previous = model[name];

    model[name] = function () {
      var self = this;
      var args = arguments;

      return ns.mount.run().then(function () {
        return previous.apply(self, args);
      });
    };

    model[name][MARK] = true;

    ns.log(name + " patched");

    return true;
  }

  try {
    ns.hooks.install();

    // Ready before the player can click, not only once they have. The content
    // remount is left to the Fight click: the galaxy map reads specs and
    // portraits through coui:, which the root mounts serve on their own, and
    // the remount blanks the scene for seconds. See design.md.
    ns.mount.run({ remountContent: false });

    if (!patchFight("fight")) {
      ns.alarm("launch_unavailable", { fight: false });
    }
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})(window);
