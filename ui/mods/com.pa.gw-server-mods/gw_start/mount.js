/* gw_start: root mounts only, so a mod's commanders can be shown before a war
   exists. The scene reads specs and portraits through coui:, which zip mounts
   alone serve, so the renderer's content remount - seconds of frozen UI - is
   skipped. Community Mods is absent here; see design.md. */
(function () {
  try {
    window.GwServerMods.mount.run({ rootOnly: true, remountContent: false });
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
