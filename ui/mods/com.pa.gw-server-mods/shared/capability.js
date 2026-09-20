// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.capability) {
    return;
  }

  var KEY = "gw_server_mods_host_identifiers";
  var cached = null;

  function empty() {
    return { identifiers: [], namesById: {}, versionsById: {} };
  }

  function read() {
    if (cached) {
      return cached;
    }

    try {
      cached = JSON.parse(sessionStorage.getItem(KEY) || "null") || empty();
    } catch (e) {
      cached = empty();
    }

    return cached;
  }

  function remember(identifiers, namesById, versionsById) {
    cached = {
      identifiers: _.map(identifiers || [], ns.manifest.normalizeIdentifier),
      namesById: namesById || {},
      versionsById: versionsById || {},
    };

    try {
      sessionStorage.setItem(KEY, JSON.stringify(cached));
    } catch (e) {
      // In-memory only for the rest of this scene.
      ns.log("host mod set not persisted");
    }

    return cached;
  }

  // The remembered set is the host's whole required list, client mods
  // included, so this answers "does the host require it", not "is it a
  // server mod".
  function hostRequiresMod(identifier) {
    var wanted = ns.manifest.normalizeIdentifier(identifier);

    return !!wanted.length && _.includes(read().identifiers, wanted);
  }

  function hostServerMods() {
    var host = read();

    return _.map(host.identifiers, function (identifier) {
      return {
        identifier: identifier,
        displayName: host.namesById[identifier] || identifier,
        version: host.versionsById[identifier] || "",
      };
    });
  }

  ns.capability = {
    remember: remember,
  };

  ns.hostRequiresMod = hostRequiresMod;
  ns.hostServerMods = hostServerMods;
})(window);
