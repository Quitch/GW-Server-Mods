// The atlas is built once at startup and never rebuilt. See design.md.
(function () {
  var ICON_DIR = "/ui/main/atlas/icon_atlas/img/strategic_icons/";
  var MARK = "__gwServerModsPatched";

  function nameOf(path) {
    return String(path)
      .replace(/^.*icon_si_/, "")
      .replace(/\.png$/i, "");
  }

  // icon_atlas loads this file alone, with none of the shared modules, so the
  // native chain is written out rather than going through ns.settled.
  function addMissingIcons() {
    if (!api.file || !_.isFunction(api.file.list)) {
      return Promise.resolve(0);
    }

    return Promise.resolve(api.file.list(ICON_DIR, false)).then(
      function (listing) {
        var files = listing && listing.length ? listing : _.keys(listing || {});
        var known = model.strategicIcons();
        var added = [];

        _.forEach(files, function (file) {
          if (String(file).indexOf("icon_si_") === -1) {
            return;
          }

          var name = nameOf(file);

          if (
            name.length &&
            known.indexOf(name) === -1 &&
            added.indexOf(name) === -1
          ) {
            added.push(name);
          }
        });

        // One notification for the whole batch; the bound foreach would
        // otherwise rebuild once per push.
        if (added.length) {
          known.push.apply(known, added);
          model.strategicIcons.valueHasMutated();
        }

        console.log("[GW-SM] strategic icons added=" + added.length);

        return added.length;
      },
      function () {
        console.error("[GW-SM] could not list " + ICON_DIR);

        return 0;
      }
    );
  }

  function patchSendIconList() {
    if (!model || !_.isFunction(model.sendIconList)) {
      return false;
    }

    if (model.sendIconList[MARK]) {
      return true;
    }

    var previous = model.sendIconList;

    model.sendIconList = function () {
      var self = this;

      function send() {
        previous.call(self);
      }

      return addMissingIcons().then(send, send);
    };

    model.sendIconList[MARK] = true;

    return true;
  }

  try {
    if (!patchSendIconList()) {
      console.error(
        "[GW-SM] sendIconList unavailable; modded icons will be dots"
      );
    }
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
