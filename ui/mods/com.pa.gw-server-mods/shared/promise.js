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

  // See design.md.
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
