var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var concat = require("concat-stream");
var dust = require("dustjs-helpers");
var stream_1 = require("stream");
var File = require("vinyl");
var marked = require("marked");
var DustStream = (function (_super) {
    __extends(DustStream, _super);
    function DustStream(template, context) {
        var _this = this;
        _super.call(this);
        dust.stream(template, context)
            .on("data", function (d) { _this.push(d); })
            .on("end", function () { _this.push(null); })
            .on("error", function (err) { _this.emit("error", err); });
    }
    DustStream.prototype._read = function () { };
    return DustStream;
})(stream_1.Readable);
function concatFile(f, cb) {
    f.pipe(concat({ encoding: "string" }, function (content) {
        cb(f, content);
    }));
}
var Post = (function () {
    function Post(file, contents) {
        this.file = file;
        this.parseContents(contents);
    }
    Post.prototype.name = function () {
        return this.file.relative;
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
module.exports = (function (_super) {
    __extends(Squick, _super);
    function Squick(options) {
        var _this = this;
        _super.call(this, { objectMode: true });
        this.posts = [];
        this.postsRemaining = 0;
        this.allPostsAvailable = false;
        this.allTemplatesAvailable = false;
        this.site = options.site;
        this.setupDust();
        options.content.on("data", function (f) {
            _this.postsRemaining++;
            concatFile(f, function (f, c) { return _this.addPost(f, c); });
        }).on("end", function () {
            _this.allPostsAvailable = true;
            _this.emit("posts-ended");
            _this.endIfFinished();
        });
        options.views.on("data", function (f) {
            concatFile(f, function (f, c) { return _this.addTemplate(f, c); });
        }).on("end", function () {
            _this.allTemplatesAvailable = true;
            _this.emit("templates-ended");
        });
    }
    Squick.prototype.setupDust = function () {
        var _this = this;
        dust.onLoad = function (templateName, options, callback) {
            return _this.getTemplate(templateName)
                .then(function (template) { return callback(null, template); }, function (err) { return callback(err, null); });
        };
        dust.helpers["markdown"] = function (chunk, context, bodies, params) {
            return chunk.write(marked(params.content));
        };
    };
    Squick.prototype._read = function () { };
    Squick.prototype.getPost = function (name) {
        var _this = this;
        for (var _i = 0, _a = this.posts; _i < _a.length; _i++) {
            var post = _a[_i];
            if (post.name() == name) {
                return Promise.resolve(post);
            }
        }
        return new Promise(function (resolve, reject) {
            var postAvailableListener = function (post) {
                if (post.name() == name) {
                    resolve(post);
                    _this.removeListener("post-available", postAvailableListener);
                }
            };
            _this.on("post-available", postAvailableListener);
        });
    };
    Squick.prototype.addPost = function (file, contents) {
        var post = new Post(file, contents);
        this.posts.push(post);
        this.emit("post-available", post);
        this.push(this.renderPostForFile(post));
        this.postsRemaining--;
        this.endIfFinished();
    };
    Squick.prototype.endIfFinished = function () {
        if (this.postsRemaining == 0 && this.allPostsAvailable) {
            this.push(null);
        }
    };
    Squick.prototype.addTemplate = function (file, contents) {
        dust.compileFn(contents, file.relative);
        this.emit("template-available", file.relative);
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
            var onFinished = function () { return reject("template " + name + " not found"); };
            var onAvailable = function (templateName) {
                if (templateName == name) {
                    resolve();
                    _this.removeListener("template-available", onAvailable);
                }
            };
            _this.on("template-available", onAvailable);
            _this.on("templates-ended", onFinished);
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
        if (template === void 0) { template = null; }
        template = template || post.meta.template;
        return new DustStream(template, { post: post, site: this.site });
    };
    return Squick;
})(stream_1.Readable);
