// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});
  var MARK = "__gwServerModsPatched";

  var REQUIRED = "set_required_client_mods";
  var MANIFEST = "client_mod_manifest";

  // Empty until the server asks for a manifest.
  var hostRequired = [];

  // Only mods the client has to render need to match. Until a mount has
  // classified them, require all of them rather than none.
  function requiredServerMods() {
    if (!ns.manifest.relevanceKnown()) {
      ns.log("server mods unclassified, requiring all");
      return ns.manifest.activeServerMods();
    }

    return ns.manifest.clientRelevantServerMods();
  }

  function addHostServerMods(payload) {
    var mods = requiredServerMods();

    if (!mods.length) {
      return payload;
    }

    var identifiers = _.isArray(payload.required_identifiers)
      ? payload.required_identifiers.slice()
      : [];
    var names = _.assign({}, payload.required_names_by_id);
    var versions = _.assign({}, payload.required_versions_by_id);

    _.forEach(mods, function (mod) {
      if (!_.includes(identifiers, mod.identifier)) {
        identifiers.push(mod.identifier);
      }

      names[mod.identifier] = mod.displayName;
      versions[mod.identifier] = mod.version;
    });

    payload.required_identifiers = identifiers;
    payload.required_names_by_id = names;
    payload.required_versions_by_id = versions;

    ns.capability.remember(identifiers, names, versions);

    ns.log("published host server mods", {
      identifiers: _.map(mods, "identifier"),
    });

    return payload;
  }

  // galacticWarMod keeps its stock meaning and is always reported; anything
  // else the host is not running is left out. See design.md.
  function sharedWithHost(mod) {
    return mod.galacticWarMod || _.includes(hostRequired, mod.identifier);
  }

  function addViewerServerMods(payload) {
    var mods = _.filter(ns.manifest.activeServerMods(), sharedWithHost);

    if (!mods.length) {
      return payload;
    }

    var identifiers = _.isArray(payload.active_required_identifiers)
      ? payload.active_required_identifiers.slice()
      : [];
    var names = _.assign({}, payload.active_required_names_by_id);
    var versions = _.assign({}, payload.active_required_versions_by_id);
    var active = _.isArray(payload.active_identifiers)
      ? payload.active_identifiers.slice()
      : [];

    _.forEach(mods, function (mod) {
      if (!_.includes(identifiers, mod.identifier)) {
        identifiers.push(mod.identifier);
      }

      if (!_.includes(active, mod.identifier)) {
        active.push(mod.identifier);
      }

      names[mod.identifier] = mod.displayName;
      versions[mod.identifier] = mod.version;
    });

    payload.active_identifiers = active;
    payload.active_required_identifiers = identifiers;
    payload.active_required_names_by_id = names;
    payload.active_required_versions_by_id = versions;

    ns.log("reported shared server mods", { identifiers: identifiers });

    return payload;
  }

  // The stock handler takes no argument and drops this payload.
  function captureHostRequired(previous) {
    if (!_.isFunction(previous) || previous[MARK]) {
      return previous;
    }

    var wrapped = function (payload) {
      if (payload && _.isArray(payload.required_identifiers)) {
        hostRequired = _.map(
          payload.required_identifiers,
          ns.manifest.normalizeIdentifier
        );

        ns.capability.remember(
          hostRequired,
          payload.required_names_by_id,
          payload.required_versions_by_id
        );

        ns.log("host required mods received", { identifiers: hostRequired });
      }

      return previous.apply(this, arguments);
    };

    wrapped[MARK] = true;

    return wrapped;
  }

  // The scene assigns this handler after mod scripts run.
  function patchManifestRequest() {
    if (!root.handlers) {
      return false;
    }

    var current = captureHostRequired(handlers.request_client_mod_manifest);

    Object.defineProperty(handlers, "request_client_mod_manifest", {
      configurable: true,
      enumerable: true,
      get: function () {
        return current;
      },
      set: function (fn) {
        current = captureHostRequired(fn);
      },
    });

    return true;
  }

  function augment(previous) {
    if (!_.isFunction(previous) || previous[MARK]) {
      return previous;
    }

    var wrapped = function (message, payload, respond) {
      if (message === REQUIRED && _.isObject(payload)) {
        try {
          payload = addHostServerMods(payload);
        } catch (e) {
          ns.alarm("gate_publish_failed", { error: String(e) });
        }
      } else if (message === MANIFEST && _.isObject(payload)) {
        try {
          payload = addViewerServerMods(payload);
        } catch (e) {
          ns.alarm("gate_manifest_failed", { error: String(e) });
        }
      }

      return previous.call(this, message, payload, respond);
    };

    wrapped[MARK] = true;

    return wrapped;
  }

  // The scene creates send_message in app.registerWithCoherent, which runs
  // after loadSceneMods.
  function patchSendMessage() {
    if (!root.model) {
      return false;
    }

    var current = augment(model.send_message);

    Object.defineProperty(model, "send_message", {
      configurable: true,
      enumerable: true,
      get: function () {
        return current;
      },
      set: function (fn) {
        current = augment(fn);
      },
    });

    return true;
  }

  try {
    var send = patchSendMessage();
    var request = patchManifestRequest();

    if (!send || !request) {
      // A partly installed guard must never read as enforcement.
      ns.alarm("gate_unavailable", {
        send_message: send,
        request_manifest: request,
      });
    }
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }

  ns.gate = {
    hostRequired: function () {
      return hostRequired.slice();
    },
  };
})(window);
