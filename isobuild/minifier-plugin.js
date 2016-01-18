exports.__esModule = true;

var _utilsBuildmessageJs = require('../utils/buildmessage.js');

var _utilsBuildmessageJs2 = babelHelpers.interopRequireDefault(_utilsBuildmessageJs);

var buildPluginModule = require('./build-plugin.js');

var InputFile = (function (_buildPluginModule$InputFile) {
  babelHelpers.inherits(InputFile, _buildPluginModule$InputFile);

  function InputFile(source) {
    var options = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
    babelHelpers.classCallCheck(this, InputFile);

    _buildPluginModule$InputFile.call(this);

    this._source = source;
    this._arch = options.arch;
    this._minifiedFiles = [];
  }

  InputFile.prototype.getContentsAsBuffer = function getContentsAsBuffer() {
    return this._source.contents();
  };

  InputFile.prototype.getPathInPackage = function getPathInPackage() {
    throw new Error("Compiled files don't belong to any package");
  };

  InputFile.prototype.getPackageName = function getPackageName() {
    throw new Error("Compiled files don't belong to any package");
  };

  InputFile.prototype.getSourceHash = function getSourceHash() {
    return this._source.hash();
  };

  InputFile.prototype.getOnDemand = function getOnDemand() {
    return !!this._source.onDemand;
  };

  InputFile.prototype.getArch = function getArch() {
    return this._arch;
  };

  InputFile.prototype.error = function error(_ref) {
    var message = _ref.message;
    var sourcePath = _ref.sourcePath;
    var line = _ref.line;
    var column = _ref.column;
    var func = _ref.func;

    var relPath = this.getPathInBundle();
    _utilsBuildmessageJs2['default'].error(message || 'error minifying ' + relPath, {
      file: sourcePath || relPath,
      line: line ? line : undefined,
      column: column ? column : undefined,
      func: func ? func : undefined
    });
  };

  /**
   * @summary Returns the path of the compiled file in the bundle.
   * @memberof InputFile
   * @returns {String}
   */

  InputFile.prototype.getPathInBundle = function getPathInBundle() {
    return this._source.targetPath;
  };

  /**
   * @summary Returns the source-map associated with the file.
   * @memberof InputFile
   * @returns {String}
   */

  InputFile.prototype.getSourceMap = function getSourceMap() {
    return this._source.sourceMap;
  };

  return InputFile;
})(buildPluginModule.InputFile);

var JsFile = (function (_InputFile) {
  babelHelpers.inherits(JsFile, _InputFile);

  function JsFile() {
    babelHelpers.classCallCheck(this, JsFile);

    _InputFile.apply(this, arguments);
  }

  // - data
  // - sourceMap
  // - path
  // - hash?

  JsFile.prototype.addJavaScript = function addJavaScript(options) {
    var self = this;
    self._minifiedFiles.push({
      data: options.data,
      sourceMap: options.sourceMap,
      path: options.path,
      onDemand: self.getOnDemand()
    });
  };

  return JsFile;
})(InputFile);

exports.JsFile = JsFile;

var CssFile = (function (_InputFile2) {
  babelHelpers.inherits(CssFile, _InputFile2);

  function CssFile() {
    babelHelpers.classCallCheck(this, CssFile);

    _InputFile2.apply(this, arguments);
  }

  // - data
  // - sourceMap
  // - path
  // - hash?

  CssFile.prototype.addStylesheet = function addStylesheet(options) {
    var self = this;
    self._minifiedFiles.push({
      data: options.data,
      sourceMap: options.sourceMap,
      path: options.path,
      onDemand: self.getOnDemand()
    });
  };

  return CssFile;
})(InputFile);

exports.CssFile = CssFile;
//# sourceMappingURL=minifier-plugin.js.map