var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var Squick = require("../lib/index");
var concat = require("concat-stream");
var dust = require("dustjs-linkedin");
var stream_1 = require("stream");
var File = require("vinyl");
var buffer = require("vinyl-buffer");
var should = require("should");
should["Assertion"].add("vinylFile", function (expected) {
    this.params = { operator: "to be a vinyl file" };
    File.isVinyl(this.obj).should.be.ok;
    this.obj.should.have.property("path", expected.path);
    this.obj.should.have.property("base", expected.base);
    this.obj.contents.toString().should.equal(expected.contents.toString());
});
var Src = (function (_super) {
    __extends(Src, _super);
    function Src(files) {
        _super.call(this, { objectMode: true });
        this.files = files;
        this.i = 0;
    }
    Src.prototype._read = function (n) {
        for (; n > 0 && this.i < this.files.length; n--, this.i++) {
            this.push(this.files[this.i]);
        }
        if (this.i == this.files.length) {
            this.push(null);
            this.i++;
        }
    };
    return Src;
})(stream_1.Readable);
var simpleTemplate = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("page content: {post.content}")
});
var badTemplate = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("{% wow %}")
});
var conditionalTemplate = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("{@eq key=post.name value=nope}YES{:else}NO{/eq}")
});
var customFilter = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("{post.content|catify}")
});
var customHelper = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("{@meow /}")
});
var siteTemplate = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("site msg: {site.msg}")
});
var badJSON = new File({
    base: "/b/c/",
    path: "/b/c/bad.md",
    contents: new Buffer("{nope00----} wow")
});
var simpleContent = new File({
    base: "/b/c/",
    path: "/b/c/simple.md",
    contents: new Buffer("{\"template\": \"simple.html\"} wow")
});
var includerContent = new File({
    base: "/b/c/",
    path: "/b/c/lots.md",
    contents: new Buffer("{\"template\": \"fetch.html\", \"include\": [\"simple.md\", \"simple.md\"] }neat")
});
var includerTemplate = new File({
    base: "/b/t/",
    path: "/b/t/fetch.html",
    contents: new Buffer("{post.content}{@fetch paths=post.meta.include as=\"article\"}{article.content}{/fetch}")
});
var partial = new File({
    base: "b/t/",
    path: "b/t/partial.html",
    contents: new Buffer("partial")
});
var partialIncluder = new File({
    base: "b/t/",
    path: "b/t/simple.html",
    contents: new Buffer("cool {>\"partial.html\" /}, bro")
});
function streamToPromise(s) {
    return new Promise(function (resolve, reject) {
        s.on("error", function (err) { return reject(err); });
        var buffered = s.pipe(buffer());
        buffered.on("error", function (err) { return reject(err); });
        buffered.pipe(concat(function (files) { return resolve(files); }));
    });
}
function squickToFiles(posts, templates, opts) {
    if (opts === void 0) { opts = {}; }
    opts = opts || {};
    opts.views = new Src(templates);
    var result = new Src(posts)
        .pipe(new Squick(opts));
    return streamToPromise(result);
}
describe("squick", function () {
    beforeEach(function () {
        dust.cache = {};
    });
    it("renders files via templates", function () {
        return squickToFiles([simpleContent], [simpleTemplate]).then(function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: new Buffer("page content:  wow")
            });
        });
    });
    it("can take the content stream as an option", function () {
        return streamToPromise(new Squick({
            content: new Src([simpleContent]),
            views: new Src([simpleTemplate])
        })).then(function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: new Buffer("page content:  wow")
            });
        });
    });
    it("can include partials", function () {
        return squickToFiles([simpleContent], [partial, partialIncluder]).then(function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: new Buffer("cool partial, bro")
            });
        });
    });
    it("passes arbitrary site info to templates", function () {
        return squickToFiles([simpleContent], [siteTemplate], {
            site: { msg: "site info" }
        })
            .then((function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "site msg: site info"
            });
        }));
    });
    it("adds a helper named @fetch which loops through posts by name", function () {
        return squickToFiles([simpleContent, includerContent], [simpleTemplate, includerTemplate])
            .then((function (files) {
            files.should.have.length(2);
            files[1].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/lots.html",
                contents: "neat wow wow"
            });
        }));
    });
    it("enables the standard dust helpers", function () {
        return squickToFiles([simpleContent], [conditionalTemplate])
            .then(function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "NO"
            });
        });
    });
    it("allows custom filters via an option", function () {
        return squickToFiles([simpleContent], [customFilter], {
            filters: {
                "catify": function (x) { return ("meow " + x + " meow"); }
            }
        }).then(function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "meow  wow meow"
            });
        });
    });
    it("allows custom helpers via an option", function () {
        return squickToFiles([simpleContent], [customHelper], {
            helpers: {
                "meow": function (chunk) {
                    chunk.write("meow meow meow");
                    return chunk;
                }
            }
        }).then(function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "meow meow meow"
            });
        });
    });
    it("catches JSON syntax errors", function () {
        return squickToFiles([badJSON], [simpleTemplate], {})
            .then(function () {
            Promise.reject("did not produce error message");
        }, function (err) {
            err.toString().indexOf("bad.md").should.be.greaterThanOrEqual(0);
        });
    });
    it("raises an error when a template is missing", function () {
        return squickToFiles([simpleContent], []).then(function (files) {
            return Promise.reject("did not produce error message");
        }, function (err) {
            err.toString().indexOf("simple.html").should.be.greaterThanOrEqual(0);
        });
    });
    it("raises an error when a template doesn't compile", function () {
        return squickToFiles([simpleContent], [badTemplate]).then(function (files) {
            return Promise.reject("did not produce error message");
        }, function (err) {
            err.toString().indexOf("simple.html").should.be.greaterThanOrEqual(0);
        });
    });
    it("raises an error when a post is missing", function () {
        return squickToFiles([includerContent], [includerTemplate]).then(function (files) {
            return Promise.reject("did not produce error message");
        }, function (err) {
            err.toString().indexOf("simple.md").should.be.greaterThanOrEqual(0);
        });
    });
});
