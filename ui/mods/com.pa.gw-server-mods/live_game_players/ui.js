/* live_game_players: the server mods' player list scripts. */
(function () {
  try {
    window.GwServerMods.serverUi.load("live_game_players");
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
