// Rebuilding the content catalogue under a running game blanks the scene.
// build.js loaded shared_build before any scene script ran, so the server
// mods' share of that list is loaded here.
(function () {
  try {
    window.GwServerMods.hooks.install({ remountContent: false });
    window.GwServerMods.mount.run({ remountContent: false });
    window.GwServerMods.serverUi.load("shared_build");
    window.GwServerMods.serverUi.load("live_game");
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
