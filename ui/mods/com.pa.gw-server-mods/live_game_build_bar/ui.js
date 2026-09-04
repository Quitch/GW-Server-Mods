/* live_game_build_bar: the server mods' build bar scripts. */
(function () {
  try {
    window.GwServerMods.serverUi.load("live_game_build_bar");
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
