exports.__esModule = true;
exports.push = push;

var _sourceMapSupport = require('source-map-support');

var _sourceMapSupport2 = babelHelpers.interopRequireDefault(_sourceMapSupport);

// Why this file exists:
// We have two places in the tool where we need to do source maps:
// 1. Loaded isopacks, which use a special custom source map cache
// 2. Transpiled tool code from Babel
//
// In order to avoid crazy bootstrapping, it would be nice to be able to add
// functions to look for source maps, so that we can call
// sourceMapSupport.install as early as possible, and not worry about having
// the right data structures around.
//
// This module maintains a stack of source map retrieval functions, which are
// called in reverse order until one returns a truthy value.

var stack = [];

// Add a function to locate source maps; all of the functions are executed in
// reverse order

function push(func) {
  stack.push(func);
}

function tryAllSourceMapRetrievers(filename) {
  for (var i = stack.length - 1; i >= 0; i--) {
    var sourceMapData = stack[i](filename);

    if (sourceMapData) {
      return sourceMapData;
    }
  }

  return null;
}

function wrapCallSite(unwrappedFrame) {
  var frame = _sourceMapSupport2['default'].wrapCallSite(unwrappedFrame);
  function wrapGetter(name) {
    var origGetter = frame[name];
    frame[name] = function (arg) {
      // replace a custom location domain that we set for better UX in Chrome
      // DevTools (separate domain group) in source maps.
      var source = origGetter(arg);
      if (!source) {
        return source;
      }
      return source.replace(/(^|\()meteor:\/\/..app\//, '$1');
    };
  }
  wrapGetter('getScriptNameOrSourceURL');
  wrapGetter('getEvalOrigin');

  return frame;
}

_sourceMapSupport2['default'].install({
  retrieveSourceMap: tryAllSourceMapRetrievers,
  // For now, don't fix the source line in uncaught exceptions, because we
  // haven't fixed handleUncaughtExceptions in source-map-support to properly
  // locate the source files.
  handleUncaughtExceptions: false,
  wrapCallSite: wrapCallSite
});

// Default retrievers

// Always fall back to the default in the end
push(_sourceMapSupport2['default'].retrieveSourceMap);

/* eslint-disable max-len */

/* eslint-enable max-len */
//# sourceMappingURL=source-map-retriever-stack.js.map