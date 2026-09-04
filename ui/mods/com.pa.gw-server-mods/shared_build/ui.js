/* shared_build: the server mods' build bar data. A faction that ships its build
   groups and its SpecIdToGridMap entries in the server mod - Bugs and Exiles
   both do - has no build bar at all without this, because every one of its
   units falls into a group that no tab shows. See design.md. */
(function () {
  try {
    window.GwServerMods.serverUi.load("shared_build");
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
