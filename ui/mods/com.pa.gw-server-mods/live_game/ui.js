// build.js loaded shared_build before any scene script ran, so the server
// mods' share of that list is loaded here.
(function () {
  try {
    window.GwServerMods.serverUi.load("shared_build");
    window.GwServerMods.serverUi.load("live_game");
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
