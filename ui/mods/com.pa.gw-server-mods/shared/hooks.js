// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.hooks) {
    return;
  }

  var MARK = "__gwServerModsWrapped";

  // The mount options the scene installed with, live_game's
  // remountContent: false in particular. Wrappers fire long after install,
  // so they must inherit these rather than default.
  var runOptions;
  var seams = { unmount: false, remount: false, content: false };

  function remountAfter(previous) {
    if (!_.isFunction(previous) || previous[MARK]) {
      return previous;
    }

    var wrapped = function () {
      // Before the teardown drops them: a run in flight must not record its
      // mounts as current.
      ns.mount.invalidate();

      var before = ns.mount.sequence();
      var result = previous.apply(this, arguments);

      function remount() {
        // The inner wrapper may already have remounted during that call.
        if (ns.mount.sequence() !== before) {
          return true;
        }

        return ns.mount.run(runOptions);
      }

      // The teardown is an engine promise, so the chain starts native; stock
      // PA calls .always() on the result, so it ends jQuery. Remounting after
      // a teardown that failed is deliberate - the mounts are gone either way,
      // and this is the only thing that puts them back.
      return ns.jq(Promise.resolve(result).then(remount, remount));
    };

    wrapped[MARK] = true;

    return wrapped;
  }

  function installUnmountAccessor() {
    if (!api.file || !_.isFunction(api.file.unmountAllMemoryFiles)) {
      return false;
    }

    var current = api.file.unmountAllMemoryFiles;

    if (current[MARK]) {
      return true;
    }

    var wrapped = remountAfter(current);

    Object.defineProperty(api.file, "unmountAllMemoryFiles", {
      configurable: true,
      enumerable: true,
      get: function () {
        return wrapped;
      },
      set: function (fn) {
        wrapped = remountAfter(fn);
      },
    });

    ns.log("unmountAllMemoryFiles accessor installed");

    return true;
  }

  // Community Mods is absent from some scenes; there is no remount to survive.
  function installRemountClientMods() {
    var mgr = root.CommunityModsManager;

    if (!mgr) {
      return true;
    }

    if (!_.isFunction(mgr.remountClientMods)) {
      return false;
    }

    if (mgr.remountClientMods[MARK]) {
      return true;
    }

    // Assigned once at manager construction, so a plain wrapper is enough.
    mgr.remountClientMods = remountAfter(mgr.remountClientMods);

    ns.log("remountClientMods wrapped");

    return true;
  }

  // Community Mods rebuilds the content catalogue after its client zips are
  // mounted, before this mod's run has put the root zips back. Mounting them
  // first makes that one rebuild cover both, and the run then skips its own.
  // See design.md.
  function registerAfterRoots(previous) {
    if (!_.isFunction(previous) || previous[MARK]) {
      return previous;
    }

    var wrapped = function () {
      var self = this;
      var args = arguments;

      return ns.jq(
        ns.mount.beforeContentRemount().then(function (generation) {
          return Promise.resolve(previous.apply(self, args)).then(
            function (value) {
              ns.mount.contentRegistered(generation);

              return value;
            }
          );
        })
      );
    };

    wrapped[MARK] = true;

    return wrapped;
  }

  function installContentAccessor() {
    if (!api.content || !_.isFunction(api.content.remount)) {
      return false;
    }

    var current = api.content.remount;

    if (current[MARK]) {
      return true;
    }

    var wrapped = registerAfterRoots(current);

    Object.defineProperty(api.content, "remount", {
      configurable: true,
      enumerable: true,
      get: function () {
        return wrapped;
      },
      set: function (fn) {
        wrapped = registerAfterRoots(fn);
      },
    });

    ns.log("content remount accessor installed");

    return true;
  }

  function install(options) {
    runOptions = options;

    seams = {
      unmount: installUnmountAccessor(),
      remount: installRemountClientMods(),
      content: installContentAccessor(),
    };

    if (!seams.unmount || !seams.remount) {
      ns.alarm("hooks_unavailable", {
        unmount: seams.unmount,
        remount: seams.remount,
      });
    }

    return seams.unmount && seams.remount;
  }

  // True only when every seam is taken, so a caller may rely on a teardown
  // registering the content itself.
  function installed() {
    return seams.unmount && seams.remount && seams.content;
  }

  ns.hooks = {
    install: install,
    installed: installed,
  };
})(window);
