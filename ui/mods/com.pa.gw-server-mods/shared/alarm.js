// See design.md.
(function (root) {
  var LOG = "[GW-SM]";
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.alarm) {
    return;
  }

  var raised = [];

  var WORDING = {
    cmm_unavailable:
      "!LOC:Community Mods is not active. Server mods cannot load in Galactic War. Enable Community Mods in the Mods menu, then restart PA.",
    content_remount_unavailable:
      "!LOC:PA did not register server mod models and textures. Modded units may be invisible. Restart PA. If this message returns, report it with your PA log.",
    filesystem_server_mod:
      "!LOC:This server mod is installed as a folder. Galactic War cannot use it. Install it as a zip from Community Mods.",
    gate_manifest_failed:
      "!LOC:GW Server Mods could not tell the host which server mods you run. The host cannot check your mods. Leave the game, restart PA, then join again.",
    gate_publish_failed:
      "!LOC:GW Server Mods could not tell the other players which server mods this battle needs. Players who do not have them may join. Restart PA, then host the battle again.",
    gate_unavailable:
      "!LOC:Server mods loaded, but co-op cannot compare them between players. Players with different mods may join. Update GW Server Mods and Community Mods.",
    hooks_unavailable:
      "!LOC:Server mods loaded, but PA may unload them before the battle starts. Update GW Server Mods and Community Mods, then restart PA.",
    identifiers_lost:
      "!LOC:Another mod removed the server mods from the battle setup. The battle may start without them. Disable other Galactic War mods, then start again.",
    launch_unavailable:
      "!LOC:GW Server Mods could not attach to the battle launch. Server mods may not load. Update GW Server Mods, then restart PA.",
    mount_failed:
      "!LOC:This server mod did not load. Its zip may be damaged. Uninstall it in Community Mods, then install it again.",
    probe_failed:
      "!LOC:Server mods loaded, but PA cannot read their files. Modded units may be missing. Restart PA. If this message returns, reinstall the server mods.",
    start_unavailable:
      "!LOC:GW Server Mods could not attach to the battle connection. Server mods may not load. Update GW Server Mods, then restart PA.",
    unit_list_pinned:
      "!LOC:Your server mods changed after you first entered the Galactic War galaxy map. Battles keep the unit list PA read then, so units may be missing. Restart PA, then start the battle.",
    unit_list_unmerged:
      "!LOC:Only one faction's units will load. Several server mods each ship a unit list, and PA refused the merged list. Restart PA, then start the battle again. If this message returns, enable only one faction server mod.",
    zip_missing:
      "!LOC:This server mod is enabled, but its zip is not downloaded. Open Community Mods and download it, or disable it.",
  };

  // loc() can fill these itself, but through String.replace, which reads a "$"
  // in a value as a pattern, and an identifier is another mod's to choose. One
  // pass, so a value that holds a placeholder is not filled in turn.
  function fill(format, values) {
    return format.replace(/__(\w+)__/g, function (placeholder, name) {
      return _.has(values, name) ? values[name] : placeholder;
    });
  }

  function describe(record) {
    var wording = loc(WORDING[record.code] || record.code);
    var identifier = record.detail && record.detail.identifier;

    return identifier
      ? fill(loc("!LOC:__wording__ (__identifier__)"), {
          wording: wording,
          identifier: identifier,
        })
      : wording;
  }

  // Not every scene composites its root document, live_game in particular.
  function banner() {
    var existing = document.getElementById("gw-sm-alarm");

    if (existing) {
      return existing;
    }

    if (!document.body) {
      return null;
    }

    var element = document.createElement("div");
    element.id = "gw-sm-alarm";
    element.style.cssText =
      "position:fixed;left:12px;top:12px;z-index:2147483647;" +
      "max-width:560px;padding:8px 10px;" +
      "font:12px/1.35 Consolas,monospace;color:#e8f0ff;" +
      "background:rgba(10,24,40,0.94);border:1px solid #c92a2a;" +
      "pointer-events:none;word-break:break-word;";
    document.body.appendChild(element);

    return element;
  }

  function show() {
    var element = banner();

    if (!element) {
      return;
    }

    var parts = _.map(_.uniq(raised, "code"), describe);

    element.textContent = fill(loc("!LOC:__name__: __alarms__"), {
      name: loc("!LOC:GW Server Mods"),
      alarms: _.reduce(
        parts.slice(1),
        function (text, part) {
          return fill(loc("!LOC:__first__  |  __next__"), {
            first: text,
            next: part,
          });
        },
        parts[0]
      ),
    });
  }

  ns.alarms = function () {
    return raised.slice();
  };

  ns.alarm = function (code, detail) {
    var record = { code: code, detail: detail || {} };
    raised.push(record);
    console.error(LOG + " ALARM " + code + " " + JSON.stringify(record.detail));

    try {
      show();
    } catch (e) {
      console.error(LOG + " alarm banner failed " + (e && e.message));
    }

    return record;
  };

  // PA's log file keeps only the first console argument, so build one string.
  ns.log = function (message, detail) {
    console.log(
      LOG +
        " " +
        message +
        (_.isUndefined(detail) ? "" : " " + JSON.stringify(detail))
    );
  };
})(window);
