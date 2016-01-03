"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var bl = require("bl");
var dust = require("dustjs-helpers");
var gutil = require("gulp-util");
var marked = require("marked");
var path = require("path");
var stream_1 = require("stream");
var File = require("vinyl");
var PostDepot = (function () {
    function PostDepot(squick) {
        var _this = this;
        this.squick = squick;
        this.waiting = {};
        this.listener = function (post) { return _this.handlePost(post); };
        squick.on("post-available", this.listener);
        squick.allPosts.then(function () {
            squick.removeListener("post-available", _this.listener);
        });
    }
    PostDepot.prototype.handlePost = function (post) {
        if (post.name() in this.waiting) {
            return this.waiting[post.name()].resolve(post);
        }
        this.waiting[post.name()] = {
            promise: Promise.resolve(post),
            resolve: function () { return 0; }
        };
    };
    PostDepot.prototype.getPost = function (name) {
        var _this = this;
        var waiter = this.waiting[name];
        if (waiter) {
            return waiter.promise;
        }
        var resolver = null;
        var promise = new Promise(function (resolve, reject) {
            resolver = resolve;
            var error = "cannot find post " + name;
            _this.squick.allPosts.then(function () { return reject(error); });
        });
        this.waiting[name] = {
            promise: promise,
            resolve: resolver
        };
        return promise;
    };
    return PostDepot;
})();
var DustStream = (function (_super) {
    __extends(DustStream, _super);
    function DustStream(template, context, name) {
        var _this = this;
        _super.call(this);
        dust.stream(template, context)
            .on("data", function (d) {
            _this.push(d);
        })
            .on("end", function () { _this.push(null); })
            .on("error", function (err) {
            _this.emit("error", new gutil.PluginError({
                plugin: "squick",
                showProperties: false,
                stack: err.stack,
                message: "Error while rendering " + name + " with " + template + ":\n\t" + err
            }));
        });
    }
    DustStream.prototype._read = function () { };
    return DustStream;
})(stream_1.Readable);
var Post = (function () {
    function Post(file) {
        this.file = file;
        this.parseContents(file.contents.toString());
    }
    Post.prototype.name = function () {
        return this.file.relative;
    };
    Post.prototype.title = function () {
        if (this.meta.title) {
            return this.meta.title;
        }
        var match = this.content.match(/\s*#+([^\n]*)/);
        if (match) {
            return match[1].trim();
        }
        match = this.content.match(/s*([^\n]*)\n=+/);
        if (match) {
            return match[1].trim();
        }
        match = this.content.match(/s*([^\n]*)\n-+/);
        if (match) {
            return match[1].trim();
        }
        var ext = path.extname(this.file.relative);
        return path.basename(this.file.relative, ext).replace(/-+/, " ");
    };
    Post.prototype.parseContents = function (source) {
        if (source[0] != "{") {
            this.meta = {};
            this.content = source;
            console.log("no front matter found in", this.file.path);
            return;
        }
        var nested = 0;
        for (var i = 0; i < source.length; i++) {
            if (source[i] == "{") {
                nested += 1;
            }
            else if (source[i] == "}") {
                nested -= 1;
            }
            if (nested == 0) {
                this.content = source.substr(i + 1);
                this.meta = JSON.parse(source.substr(0, i + 1));
                break;
            }
        }
    };
    return Post;
})();
var Squick = (function (_super) {
    __extends(Squick, _super);
    function Squick(options) {
        var _this = this;
        _super.call(this, { objectMode: true });
        this.options = options;
        this.posts = [];
        this.allTemplatesAvailable = false;
        this.setMaxListeners(100);
        if (this.options.marked) {
            marked.setOptions(this.options.marked);
        }
        this.allPosts = new Promise(function (resolve, reject) {
            _this.once("error", reject);
            _this.once("finish", function () { return resolve(_this.posts); });
        });
        this.postDepot = new PostDepot(this);
        this.setupDust();
        options.views
            .on("data", function (f) {
            if (f.isBuffer()) {
                return _this.addTemplate(f);
            }
            f.contents.pipe(new bl(function (err, data) {
                if (err) {
                    return _this.emit("error", err);
                }
                f.contents = data;
                _this.addTemplate(f);
            }));
        })
            .on("end", function () {
            _this.allTemplatesAvailable = true;
            _this.emit("templates-ended");
        });
        if ("content" in options) {
            options.content.pipe(this);
        }
    }
    Squick.prototype._transform = function (f, ignored, cb) {
        var _this = this;
        if (f.isBuffer()) {
            return cb(null, this.addPost(f));
        }
        f.contents.pipe(new bl(function (err, data) {
            if (err) {
                return cb(err, null);
            }
            f = f.clone();
            f.contents = data;
            cb(null, _this.addPost(f));
        }));
    };
    Squick.prototype.setupDust = function () {
        var _this = this;
        var globals = {
            site: this.options.site || {},
        };
        var options = {
            all_posts: this.allPosts
        };
        this.baseContext = dust.makeBase(globals, options);
        dust.onLoad = function (templateName, options, callback) {
            return _this.getTemplate(templateName)
                .then(function (template) { return callback(null, template); }, function (err) { return callback(err, null); });
        };
        for (var key in this.options.filters) {
            if (this.options.filters.hasOwnProperty(key)) {
                dust.filters[key] = this.options.filters[key];
            }
        }
        for (var key in this.options.helpers) {
            if (this.options.helpers.hasOwnProperty(key)) {
                dust.helpers[key] = this.options.helpers[key];
            }
        }
        dust.helpers["markdown"] = function (chunk, context, bodies, params) {
            var fallback = (typeof context.current() == "string") ? context.current() : "";
            return chunk.write(marked(params.content || fallback));
        };
        dust.helpers["fetch"] = function (chunk, context, bodies, params) {
            var key = params["as"] || "post";
            var paths = params["paths"] || [];
            return chunk.map(function (chunk) {
                Promise.all(paths.map(function (path) {
                    return _this.getPost(path).then(function (post) {
                        var data = {};
                        data[key] = post;
                        return data;
                    });
                })).then(function (posts) {
                    for (var _i = 0, posts_1 = posts; _i < posts_1.length; _i++) {
                        var post = posts_1[_i];
                        chunk = bodies.block(chunk, context.clone().push(post));
                    }
                    chunk.end();
                }).catch(function (err) {
                    chunk.setError(err);
                });
                return chunk;
            });
        };
    };
    Squick.prototype.getPost = function (name) {
        return this.postDepot.getPost(name);
    };
    Squick.prototype.addPost = function (file) {
        try {
            var post = new Post(file);
        }
        catch (e) {
            this.emit("error", new gutil.PluginError({
                plugin: "Squick",
                message: "JSON Syntax error in " + file.path + ":\n\t" + e.toString()
            }));
            return;
        }
        this.posts.push(post);
        this.emit("post-available", post);
        return this.renderPostForFile(post);
    };
    Squick.prototype.addTemplate = function (file) {
        try {
            dust.compileFn(file.contents.toString(), file.relative);
            this.emit("template-available", file.relative);
        }
        catch (err) {
            this.emit("error", new gutil.PluginError({
                plugin: "squick",
                message: "compilation of template (" + file.relative + ") failed with error:\n\t" + err.toString()
            }));
        }
    };
    Squick.prototype.getTemplate = function (name) {
        var _this = this;
        if (name in dust.cache) {
            return Promise.resolve(dust.cache[name]);
        }
        var errorMessage = "template " + name + " not found";
        if (this.allTemplatesAvailable) {
            return Promise.reject(errorMessage);
        }
        return new Promise(function (resolve, reject) {
            var onAvailable;
            var onFinished = function () {
                _this.removeListener("template-available", onAvailable);
                reject(errorMessage);
            };
            onAvailable = function (templateName) {
                if (templateName == name) {
                    _this.removeListener("template-available", onAvailable);
                    _this.removeListener("templates-ended", onFinished);
                    resolve();
                }
            };
            _this.on("template-available", onAvailable);
            _this.once("templates-ended", onFinished);
        });
    };
    Squick.prototype.renderPostForFile = function (post) {
        var result = new File({
            base: post.file.base,
            path: post.file.path,
            contents: this.startRender(post)
        });
        result.extname = ".html";
        return result;
    };
    Squick.prototype.startRender = function (post, template) {
        var _this = this;
        if (template === void 0) { template = null; }
        template = template || post.meta.template;
        var context = this.baseContext.clone().push({ post: post });
        var stream = new DustStream(template, context, post.name());
        stream.on("error", function (err) { _this.emit("error", err); });
        return stream;
    };
    return Squick;
})(stream_1.Transform);
module.exports = Squick;
