// Runs before the stock scene translates its page, which a scene list does not.
// See design.md.
(function () {
  var translations = window.ModTranslations;

  if (!translations || !_.isFunction(translations.register)) {
    return;
  }

  try {
    translations.register("com.pa.gw-server-mods");
  } catch (e) {
    console.error(
      "[GW-SM] translations not registered " + ((e && e.message) || e)
    );
  }
})();
