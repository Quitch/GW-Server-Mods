// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.settled) {
    return;
  }

  function pass(value) {
    return value;
  }

  // Promise.allSettled is Chrome 76, so each input is neutralised instead: one
  // failure must not cancel the rest, which is what $.when(...).always() gave.
  ns.settled = function (values) {
    return Promise.all(
      _.map(values, function (value) {
        return Promise.resolve(value).then(pass, pass);
      })
    );
  };

  // Stock PA calls .always() on what three of this mod's wrappers return, and
  // jQuery 2.1.4 recognises a promise by a `promise` method, which neither an
  // engine promise nor a native one has. Only those three seams need this.
  ns.jq = function (promise) {
    var deferred = $.Deferred();

    promise.then(
      function (value) {
        deferred.resolve(value);
      },
      function (error) {
        deferred.reject(error);
      }
    );

    return deferred.promise();
  };
})(window);
