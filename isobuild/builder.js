exports.__esModule = true;

var _fsWatchJs = require('../fs/watch.js');

var _fsFilesJs = require('../fs/files.js');

var _fsFilesJs2 = babelHelpers.interopRequireDefault(_fsFilesJs);

var _npmDiscardsJs = require('./npm-discards.js');

var _npmDiscardsJs2 = babelHelpers.interopRequireDefault(_npmDiscardsJs);

var _toolEnvProfileJs = require('../tool-env/profile.js');

// Builder has two modes of working:
// - write files to a temp directory and later atomically move it to destination
// - write files in-place replacing the older files
// The later doesn't work on Windows but works well on Mac OS X and Linux, since
// the file system allows writing new files to the path of a file opened by a
// process. The process only retains the inode, not the path.
var ENABLE_IN_PLACE_BUILDER_REPLACEMENT = process.platform !== 'win32' && !process.env.METEOR_DISABLE_BUILDER_IN_PLACE;

// Builder encapsulates much of the file-handling logic need to create
// "bundles" (directory trees such as site archives, programs, or
// packages). It can create a temporary directory in which to build
// the bundle, moving the bundle atomically into place when and if the
// build successfully completes; sanitize and generate unique
// filenames; and track dependencies (files that should be watched for
// changes when developing interactively).
//
// Options:
//  - outputPath: Required. Path to the directory that will hold the
//    bundle when building is complete. It should not exist. Its
//    parents will be created if necessary.
// - previousBuilder: Optional. An in-memory instance of Builder left
// from the previous iteration. It is assumed that the previous builder
// has completed its job successfully and its files are stored on the
// file system in the exact layout as described in its usedAsFile data
// structure; and the hashes of the contents correspond to the
// writtenHashes data strcture.

var Builder = (function () {
  function Builder(_ref) {
    var outputPath = _ref.outputPath;
    var previousBuilder = _ref.previousBuilder;
    babelHelpers.classCallCheck(this, Builder);

    this.outputPath = outputPath;

    // Paths already written to. Map from canonicalized relPath (no
    // trailing slash) to true for a file, or false for a directory.
    this.usedAsFile = { '': false, '.': false };
    this.previousUsedAsFile = {};

    this.writtenHashes = {};
    this.previousWrittenHashes = {};

    // foo/bar => foo/.build1234.bar
    // Should we include a random number? The advantage is that multiple
    // builds can run in parallel. The disadvantage is that stale build
    // files hang around forever. For now, go with the former.
    var nonce = Math.floor(Math.random() * 999999);
    this.buildPath = _fsFilesJs2['default'].pathJoin(_fsFilesJs2['default'].pathDirname(this.outputPath), '.build' + nonce + "." + _fsFilesJs2['default'].pathBasename(this.outputPath));

    var resetBuildPath = true;

    // If we have a previous builder and we are allowed to re-use it,
    // let's keep all the older files on the file-system and replace
    // only outdated ones + write the new files in the same path
    if (previousBuilder && ENABLE_IN_PLACE_BUILDER_REPLACEMENT) {
      if (previousBuilder.outputPath !== outputPath) {
        throw new Error('previousBuilder option can only be set to a builder with the same output path.\nPrevious builder: ' + previousBuilder.outputPath + ', this builder: ' + outputPath);
      }

      if (_fsFilesJs2['default'].exists(previousBuilder.outputPath)) {
        // write files in-place in the output directory of the previous builder
        this.buildPath = previousBuilder.outputPath;

        this.previousWrittenHashes = previousBuilder.writtenHashes;
        this.previousUsedAsFile = previousBuilder.usedAsFile;

        resetBuildPath = false;
      } else {
        resetBuildPath = true;
      }
    }

    // Build the output from scratch
    if (resetBuildPath) {
      _fsFilesJs2['default'].rm_recursive(this.buildPath);
      _fsFilesJs2['default'].mkdir_p(this.buildPath, 493);
    }

    this.watchSet = new _fsWatchJs.WatchSet();

    // XXX cleaner error handling. don't make the humans read an
    // exception (and, make suitable for use in automated systems)
  }

  // Like mkdir_p, but records in self.usedAsFile that we have created
  // the directories, and takes a path relative to the bundle
  // root. Throws an exception on failure.

  Builder.prototype._ensureDirectory = function _ensureDirectory(relPath) {
    var _this = this;

    var parts = _fsFilesJs2['default'].pathNormalize(relPath).split(_fsFilesJs2['default'].pathSep);
    if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop(); // remove trailing slash

    var partsSoFar = [];
    parts.forEach(function (part) {
      partsSoFar.push(part);
      var partial = partsSoFar.join(_fsFilesJs2['default'].pathSep);
      if (!(partial in _this.usedAsFile)) {
        var needToMkdir = true;
        if (partial in _this.previousUsedAsFile) {
          if (_this.previousUsedAsFile[partial]) {
            // was previously used as file, delete it, create a directory
            _fsFilesJs2['default'].unlink(partial);
          } else {
            // is already a directory
            needToMkdir = false;
          }
        }

        if (needToMkdir) {
          // It's new -- create it
          _fsFilesJs2['default'].mkdir(_fsFilesJs2['default'].pathJoin(_this.buildPath, partial), 493);
        }
        _this.usedAsFile[partial] = false;
      } else if (_this.usedAsFile[partial]) {
        // Already exists and is a file. Oops.
        throw new Error('tried to make ' + relPath + ' a directory but ' + partial + ' is already a file');
      } else {
        // Already exists and is a directory
      }
    });
  };

  // isDirectory defaults to false

  Builder.prototype._sanitize = function _sanitize(relPath, isDirectory) {
    var parts = relPath.split(_fsFilesJs2['default'].pathSep);
    var partsOut = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var shouldBeFile = i === parts.length - 1 && !isDirectory;
      var mustBeUnique = i === parts.length - 1;

      // Basic sanitization
      if (part.match(/^\.+$/)) throw new Error('Path contains forbidden segment \'' + part + '\'');

      part = part.replace(/[^a-zA-Z0-9._\:-]/g, '');

      // If at last component, pull extension (if any) off of part
      var ext = '';
      if (shouldBeFile) {
        var split = part.split('.');
        if (split.length > 1) ext = "." + split.pop();
        part = split.join('.');
      }

      // Make sure it's sufficiently unique
      var suffix = '';
      while (true) {
        var candidate = _fsFilesJs2['default'].pathJoin(partsOut.join(_fsFilesJs2['default'].pathSep), part + suffix + ext);
        if (candidate.length) {
          // If we've never heard of this, then it's unique enough.
          if (!(candidate in this.usedAsFile)) break;
          // If we want this bit to be a directory, and we don't need it to be
          // unique (ie, it isn't the very last bit), and it's currently a
          // directory, then that's OK.
          if (!(mustBeUnique || this.usedAsFile[candidate])) break;
          // OK, either we want it to be unique and it already exists; or it is
          // currently a file (and we want it to be either a different file or a
          // directory).  Try a new suffix.
        }

        suffix++; // first increment will do '' -> 1
      }

      partsOut.push(part + suffix + ext);
    }

    return partsOut.join(_fsFilesJs2['default'].pathSep);
  };

  // Write either a buffer or the contents of a file to `relPath` (a
  // path to a file relative to the bundle root), creating it (and any
  // enclosing directories) if it doesn't exist yet. Exactly one of
  // `data` and or `file` must be passed.
  //
  // Options:
  // - data: a Buffer to write to relPath. Overrides `file`.
  // - file: a filename to write to relPath, as a string.
  // - sanitize: if true, then all components of the path are stripped
  //   of any potentially troubling characters, an exception is thrown
  //   if any path segments consist entirely of dots (eg, '..'), and
  //   if there is a file in the bundle with the same relPath, then
  //   the path is changed by adding a numeric suffix.
  // - hash: a sha1 string used to determine if the contents of the
  //   new file written is not cached.
  // - executable: if true, mark the file as executable.
  // - symlink: if set to a string, create a symlink to its value
  //
  // Returns the final canonicalize relPath that was written to.
  //
  // If `file` is used then it will be added to the builder's WatchSet.

  Builder.prototype.write = function write(relPath, _ref2) {
    var _this2 = this;

    var data = _ref2.data;
    var file = _ref2.file;
    var hash = _ref2.hash;
    var sanitize = _ref2.sanitize;
    var executable = _ref2.executable;
    var symlink = _ref2.symlink;

    // Ensure no trailing slash
    if (relPath.slice(-1) === _fsFilesJs2['default'].pathSep) relPath = relPath.slice(0, -1);

    // In sanitize mode, ensure path does not contain segments like
    // '..', does not contain forbidden characters, and is unique.
    if (sanitize) relPath = this._sanitize(relPath);

    var getData = null;
    if (data) {
      if (!(data instanceof Buffer)) throw new Error("data must be a Buffer");
      if (file) throw new Error("May only pass one of data and file, not both");
      getData = function () {
        return data;
      };
    } else if (file) {
      // postpone reading the file into memory
      getData = function () {
        return _fsWatchJs.readAndWatchFile(_this2.watchSet, _fsFilesJs2['default'].pathResolve(file));
      };
    } else if (!symlink) {
      throw new Error('Builder can not write without either data or a file path or a symlink path: ' + relPath);
    }

    this._ensureDirectory(_fsFilesJs2['default'].pathDirname(relPath));
    var absPath = _fsFilesJs2['default'].pathJoin(this.buildPath, relPath);

    if (symlink) {
      _fsFilesJs2['default'].symlink(symlink, absPath);
    } else {
      hash = hash || _fsWatchJs.sha1(getData());

      if (this.previousWrittenHashes[relPath] !== hash) {
        // Builder is used to create build products, which should be read-only;
        // users shouldn't be manually editing automatically generated files and
        // expecting the results to "stick".
        atomicallyRewriteFile(absPath, getData(), {
          mode: executable ? 365 : 292
        });
      }

      this.writtenHashes[relPath] = hash;
    }
    this.usedAsFile[relPath] = true;

    return relPath;
  };

  // Serialize `data` as JSON and write it to `relPath` (a path to a
  // file relative to the bundle root), creating parent directories as
  // necessary. Throw an exception if the file already exists.

  Builder.prototype.writeJson = function writeJson(relPath, data) {
    // Ensure no trailing slash
    if (relPath.slice(-1) === _fsFilesJs2['default'].pathSep) relPath = relPath.slice(0, -1);

    this._ensureDirectory(_fsFilesJs2['default'].pathDirname(relPath));
    var absPath = _fsFilesJs2['default'].pathJoin(this.buildPath, relPath);

    atomicallyRewriteFile(absPath, new Buffer(JSON.stringify(data, null, 2), 'utf8'), { mode: 292 });

    this.usedAsFile[relPath] = true;
  };

  // Add relPath to the list of "already taken" paths in the
  // bundle. This will cause write, when in sanitize mode, to never
  // pick this filename (and will prevent files that from being
  // written that would conflict with paths that we are expecting to
  // be directories). Calling this twice on the same relPath will
  // given an exception.
  //
  // Returns the *current* (temporary!) path to where the file or directory
  // lives. This is so you could use non-builder code to write into a reserved
  // directory.
  //
  // options:
  // - directory: set to true to reserve this relPath to be a
  //   directory rather than a file.

  Builder.prototype.reserve = function reserve(relPath) {
    var _ref3 = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

    var directory = _ref3.directory;

    // Ensure no trailing slash
    if (relPath.slice(-1) === _fsFilesJs2['default'].pathSep) relPath = relPath.slice(0, -1);

    var parts = relPath.split(_fsFilesJs2['default'].pathSep);
    var partsSoFar = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      partsSoFar.push(part);
      var soFar = partsSoFar.join(_fsFilesJs2['default'].pathSep);
      if (this.usedAsFile[soFar]) throw new Error("Path reservation conflict: " + relPath);

      var shouldBeDirectory = i < parts.length - 1 || directory;
      if (shouldBeDirectory) {
        if (!(soFar in this.usedAsFile)) {
          var needToMkdir = true;
          if (soFar in this.previousUsedAsFile) {
            if (this.previousUsedAsFile[soFar]) {
              _fsFilesJs2['default'].unlink(soFar);
            } else {
              needToMkdir = false;
            }
          }
          if (needToMkdir) {
            _fsFilesJs2['default'].mkdir(_fsFilesJs2['default'].pathJoin(this.buildPath, soFar), 493);
          }
          this.usedAsFile[soFar] = false;
        }
      } else {
        this.usedAsFile[soFar] = true;
      }
    }

    // Return the path we reserved.
    return _fsFilesJs2['default'].pathJoin(this.buildPath, relPath);
  };

  // Generate and reserve a unique name for a file based on `relPath`,
  // and return it. If `relPath` is available (there is no file with
  // that name currently existing or reserved, it doesn't contain
  // forbidden characters, a prefix of it is not already in use as a
  // file rather than a directory) then the return value will be
  // `relPath`. Otherwise relPath will be modified to get the return
  // value, say by adding a numeric suffix to some path components
  // (preserving the file extension however) and deleting forbidden
  // characters. Throws an exception if relPath contains any segments
  // that are all dots (eg, '..').
  //
  // options:
  //
  // - directory: generate (and reserve) a name for a directory,
  //   rather than a file.

  Builder.prototype.generateFilename = function generateFilename(relPath) {
    var _ref4 = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

    var directory = _ref4.directory;

    relPath = this._sanitize(relPath, directory);
    this.reserve(relPath, { directory: directory });
    return relPath;
  };

  // Convenience wrapper around generateFilename and write.
  //
  // (Note that in the object returned by builder.enter, this method
  // is patched through directly rather than rewriting its inputs and
  // outputs. This is only valid because it does nothing with its inputs
  // and outputs other than send pass them to other methods.)

  Builder.prototype.writeToGeneratedFilename = function writeToGeneratedFilename(relPath, writeOptions) {
    var generated = this.generateFilename(relPath);
    this.write(generated, writeOptions);
    return generated;
  };

  // Recursively copy a directory and all of its contents into the
  // bundle. But if the symlink option was passed to the Builder
  // constructor, then make a symlink instead, if possible.
  //
  // Unlike with files.cp_r, if a symlink is found, it is copied as a symlink.
  //
  // This does NOT add anything to the WatchSet.
  //
  // Options:
  // - from: source path on local disk to copy from
  // - to: relative path to a directory in the bundle that will
  //   receive the files
  // - ignore: array of regexps of filenames (that is, basenames) to
  //   ignore (they may still be visible in the output bundle if
  //   symlinks are being used).  Like with WatchSets, they match against
  //   entries that end with a slash if it's a directory.
  // - specificFiles: just copy these paths (specified as relative to 'to').
  // - symlink: true if the directory should be symlinked instead of copying

  Builder.prototype.copyDirectory = function copyDirectory(_ref5) {
    var _this3 = this;

    var from = _ref5.from;
    var to = _ref5.to;
    var ignore = _ref5.ignore;
    var specificFiles = _ref5.specificFiles;
    var symlink = _ref5.symlink;
    var npmDiscards = _ref5.npmDiscards;

    if (to.slice(-1) === _fsFilesJs2['default'].pathSep) to = to.slice(0, -1);

    var absPathTo = _fsFilesJs2['default'].pathJoin(this.buildPath, to);
    if (symlink) {
      if (specificFiles) {
        throw new Error("can't copy only specific paths with a single symlink");
      }

      if (this.usedAsFile[to]) {
        throw new Error("tried to copy a directory onto " + to + " but it is is already a file");
      }

      var canSymlink = true;
      // Symlinks don't work exactly the same way on Windows, and furthermore
      // they request Admin permissions to set.
      if (process.platform === 'win32') {
        canSymlink = false;
      } else if (to in this.usedAsFile) {
        // It's already here and is a directory, maybe because of a call to
        // reserve with {directory: true}. If it's an empty directory, this is
        // salvageable. The directory should exist, because all code paths which
        // set usedAsFile to false create the directory.
        //
        // XXX This is somewhat broken: what if the reason we're in
        // self.usedAsFile is because an immediate child of ours was reserved as
        // a file but not actually written yet?
        var children = _fsFilesJs2['default'].readdir(absPathTo);
        if (Object.keys(children).length === 0) {
          _fsFilesJs2['default'].rmdir(absPathTo);
        } else {
          canSymlink = false;
        }
      }

      if (canSymlink) {
        this._ensureDirectory(_fsFilesJs2['default'].pathDirname(to));
        _fsFilesJs2['default'].symlink(_fsFilesJs2['default'].pathResolve(from), absPathTo);
        return;
      }
    }

    ignore = ignore || [];
    var specificPaths = null;
    if (specificFiles) {
      specificPaths = {};
      specificFiles.forEach(function (f) {
        while (f !== '.') {
          specificPaths[_fsFilesJs2['default'].pathJoin(to, f)] = true;
          f = _fsFilesJs2['default'].pathDirname(f);
        }
      });
    }

    var walk = function (absFrom, relTo) {
      _this3._ensureDirectory(relTo);

      _fsFilesJs2['default'].readdir(absFrom).forEach(function (item) {
        var thisAbsFrom = _fsFilesJs2['default'].pathResolve(absFrom, item);
        var thisRelTo = _fsFilesJs2['default'].pathJoin(relTo, item);

        if (specificPaths && !(thisRelTo in specificPaths)) {
          return;
        }

        var fileStatus = _fsFilesJs2['default'].lstat(thisAbsFrom);

        var itemForMatch = item;
        var isDirectory = fileStatus.isDirectory();
        if (isDirectory) {
          itemForMatch += '/';
        }

        // skip excluded files
        if (ignore.some(function (pattern) {
          return itemForMatch.match(pattern);
        })) return;

        if (npmDiscards instanceof _npmDiscardsJs2['default'] && npmDiscards.shouldDiscard(thisAbsFrom, isDirectory)) {
          return;
        }

        if (isDirectory) {
          walk(thisAbsFrom, thisRelTo);
        } else if (fileStatus.isSymbolicLink()) {
          _fsFilesJs2['default'].symlink(_fsFilesJs2['default'].readlink(thisAbsFrom), _fsFilesJs2['default'].pathResolve(_this3.buildPath, thisRelTo));
          // A symlink counts as a file, as far as "can you put something under
          // it" goes.
          _this3.usedAsFile[thisRelTo] = true;
        } else {
          // XXX can't really optimize this copying without reading
          // the file into memory to calculate the hash.
          _fsFilesJs2['default'].copyFile(thisAbsFrom, _fsFilesJs2['default'].pathResolve(_this3.buildPath, thisRelTo), fileStatus.mode);
          _this3.usedAsFile[thisRelTo] = true;
        }
      });
    };

    walk(from, to);
  };

  // Returns a new Builder-compatible object that works just like a
  // Builder, but interprets all paths relative to 'relPath', a path
  // relative to the bundle root which should not start with a '/'.
  //
  // The sub-builder returned does not have all Builder methods (for
  // example, complete() wouldn't make sense) and you should not rely
  // on it being instanceof Builder.

  Builder.prototype.enter = function enter(relPath) {
    var _this4 = this;

    var methods = ["write", "writeJson", "reserve", "generateFilename", "copyDirectory", "enter"];
    var subBuilder = {};
    var relPathWithSep = relPath + _fsFilesJs2['default'].pathSep;

    methods.forEach(function (method) {
      subBuilder[method] = function () {
        if (method !== "copyDirectory") {
          // Normal method (relPath as first argument)
          arguments[0] = _fsFilesJs2['default'].pathJoin(relPath, arguments[0]);
        } else {
          // with copyDirectory the path we have to fix up is inside
          // an options hash
          arguments[0].to = _fsFilesJs2['default'].pathJoin(relPath, arguments[0].to);
        }

        var ret = _this4[method].apply(_this4, arguments);

        if (method === "generateFilename") {
          // fix up the returned path to be relative to the
          // sub-bundle, not the parent bundle
          if (ret.substr(0, 1) === '/') ret = ret.substr(1);
          if (ret.substr(0, relPathWithSep.length) !== relPathWithSep) throw new Error("generateFilename returned path outside of " + "sub-bundle?");
          ret = ret.substr(relPathWithSep.length);
        }

        return ret;
      };
    });

    // Methods that don't have to fix up arguments or return values, because
    // they are implemented purely in terms of other methods which do.
    var passThroughMethods = ["writeToGeneratedFilename"];
    passThroughMethods.forEach(function (method) {
      subBuilder[method] = _this4[method];
    });

    return subBuilder;
  };

  // Move the completed bundle into its final location (outputPath)

  Builder.prototype.complete = function complete() {
    var _this5 = this;

    if (this.previousUsedAsFile) {
      (function () {
        // delete files and folders left-over from previous runs and not
        // re-used in this run
        var removed = {};
        var paths = Object.keys(_this5.previousUsedAsFile);
        paths.forEach(function (path) {
          // if the same path was re-used, leave it
          if (_this5.usedAsFile.hasOwnProperty(path)) {
            return;
          }

          // otherwise, remove it as it is no longer needed

          // skip if already deleted
          if (removed.hasOwnProperty(path)) {
            return;
          }

          var absPath = _fsFilesJs2['default'].pathJoin(_this5.buildPath, path);
          if (_this5.previousUsedAsFile[path]) {
            // file
            _fsFilesJs2['default'].unlink(absPath);
            removed[path] = true;
          } else {
            // directory
            _fsFilesJs2['default'].rm_recursive(absPath);

            // mark all sub-paths as removed, too
            paths.forEach(function (anotherPath) {
              if (anotherPath.startsWith(path + '/')) {
                removed[anotherPath] = true;
              }
            });
          }
        });
      })();
    }

    // XXX Alternatively, we could just keep buildPath around, and make
    // outputPath be a symlink pointing to it. This doesn't work for the NPM use
    // case of renameDirAlmostAtomically since that one is constructing files to
    // be checked in to version control, but here we could get away with it.
    if (this.buildPath !== this.outputPath) {
      _fsFilesJs2['default'].renameDirAlmostAtomically(this.buildPath, this.outputPath);
    }
  };

  // Delete the partially-completed bundle. Do not disturb outputPath.

  Builder.prototype.abort = function abort() {
    _fsFilesJs2['default'].rm_recursive(this.buildPath);
  };

  // Returns a WatchSet representing all files that were read from disk by the
  // builder.

  Builder.prototype.getWatchSet = function getWatchSet() {
    return this.watchSet;
  };

  return Builder;
})();

exports['default'] = Builder;

function atomicallyRewriteFile(path, data, options) {
  var stat = null;
  try {
    stat = _fsFilesJs2['default'].stat(path);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }

  if (stat && stat.isDirectory()) {
    _fsFilesJs2['default'].rm_recursive(path);
    _fsFilesJs2['default'].writeFile(path, data, options);
  } else {
    // create a different file with a random name and then rename over atomically
    var rname = '.builder-tmp-file.' + Math.floor(Math.random() * 999999);
    var rpath = _fsFilesJs2['default'].pathJoin(_fsFilesJs2['default'].pathDirname(path), rname);
    _fsFilesJs2['default'].writeFile(rpath, data, options);
    _fsFilesJs2['default'].rename(rpath, path);
  }
}

// Wrap slow methods into Profiler calls
var slowBuilderMethods = ['_ensureDirectory', 'write', 'enter', 'copyDirectory', 'enter', 'complete'];

slowBuilderMethods.forEach(function (method) {
  Builder.prototype[method] = _toolEnvProfileJs.Profile('Builder#' + method, Builder.prototype[method]);
});
module.exports = exports['default'];
//# sourceMappingURL=builder.js.map