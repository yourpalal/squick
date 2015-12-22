"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var Squick = require("../lib/index");
var buffer = require("vinyl-buffer");
var concat = require("concat-stream");
var dust = require("dustjs-linkedin");
var stream_1 = require("stream");
var File = require("vinyl");
var path = require("path");
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
function template(content, name) {
    if (name === void 0) { name = "simple.html"; }
    return new File({
        base: "/b/t/",
        path: path.join("/b/t/", name),
        contents: new Buffer(content)
    });
}
function post(name, frontMatter, content) {
    frontMatter = frontMatter ? JSON.stringify(frontMatter) : "";
    return new File({
        base: "/b/c/",
        path: path.join("/b/c/", name),
        contents: new Buffer(frontMatter + content)
    });
}
var conditionalTemplate = template("{@eq key=post.name value=nope}YES{:else}NO{/eq}");
var includerTemplate = template("{post.content}\n{@fetch paths=post.meta.include as=\"article\"}\n    |{article.content}\n{/fetch}", "fetch.html");
var badTemplate = template("{% wow %}");
var simpleTemplate = template("page content: {post.content}");
var partial = template("partial", "partial.html");
var partialIncluder = template("cool {>\"partial.html\" /}, bro");
var postsCountTemplate = template("{@postsCount /}");
var customFilter = template("{post.content|catify}");
var customHelper = template("{@meow /}");
var siteTemplate = template("site msg: {site.msg}");
var badJSON = post("bad.md", null, "{nope00----} wow");
var simpleContent = post("simple.md", {
    template: "simple.html",
}, "wow");
var includerContent = post("lots.md", {
    template: "fetch.html",
    include: ["simple.md", "simple.md"]
}, "neat");
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
                contents: "page content: wow"
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
                contents: "page content: wow"
            });
        });
    });
    it("can include partials", function () {
        return squickToFiles([simpleContent], [partial, partialIncluder]).then(function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "cool partial, bro"
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
                contents: "neat|wow|wow"
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
                contents: "meow wow meow"
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
    it("adds a all_posts Promise to the context options", function () {
        return squickToFiles([simpleContent], [postsCountTemplate], {
            helpers: {
                "postsCount": function (chunk, context) {
                    return context.options.all_posts.then(function (posts) { return posts.length; });
                }
            }
        }).then(function (files) {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "1"
            });
        });
    });
    describe("the @markdown helper", function () {
        var contextRenderTemplate = template("{@markdown:post.content/}");
        var argRenderTemplate = template("{@markdown content=post.content/}");
        var wrapperTemplate = template("{#post.content}<div>{@markdown /}</div>{/post.content}");
        it("can render the current context", function () {
            return squickToFiles([simpleContent], [contextRenderTemplate]).then(function (files) {
                files[0].contents.toString().trim().should.eql("<p>wow</p>");
            });
        });
        it("can render the current context", function () {
            return squickToFiles([simpleContent], [argRenderTemplate]).then(function (files) {
                files[0].contents.toString().trim().should.eql("<p>wow</p>");
            });
        });
        it("can render the current context in a block", function () {
            return squickToFiles([simpleContent], [wrapperTemplate]).then(function (files) {
                files[0].contents.toString().trim().should.eql("<div><p>wow</p>\n</div>");
            });
        });
    });
    describe("can determine the title of a post through:", function () {
        var hasMeta = post("cool-title.md", {
            title: "wow",
            template: "simple.html",
        }, "# NEAT STUFF");
        var hasH1HashTitle = post("cool-title.md", {
            template: "simple.html",
        }, "# NEAT STUFF");
        var hasH2HashTitle = post("cool-title.md", {
            template: "simple.html",
        }, "# NEAT STUFF");
        var hasEqualsTitle = post("cool-title.md", {
            template: "simple.html",
        }, "NEAT STUFF\n=======");
        var hasDashesTitle = post("cool-title.md", {
            template: "simple.html",
        }, "NEAT STUFF\n----------");
        var hasNoTitle = post("cool-title.md", {
            template: "simple.html",
        }, "oh dang");
        var titleTemplate = template("{post.title}");
        it("post.meta.title", function () {
            return squickToFiles([hasMeta], [titleTemplate]).then(function (files) {
                files[0].contents.toString().should.eql("wow");
            });
        });
        it("a # header", function () {
            return squickToFiles([hasH1HashTitle], [titleTemplate]).then(function (files) {
                files[0].contents.toString().should.eql("NEAT STUFF");
            });
        });
        it("a ## header", function () {
            return squickToFiles([hasH2HashTitle], [titleTemplate]).then(function (files) {
                files[0].contents.toString().should.eql("NEAT STUFF");
            });
        });
        it("a ==== header", function () {
            return squickToFiles([hasEqualsTitle], [titleTemplate]).then(function (files) {
                files[0].contents.toString().should.eql("NEAT STUFF");
            });
        });
        it("a ----- header", function () {
            return squickToFiles([hasEqualsTitle], [titleTemplate]).then(function (files) {
                files[0].contents.toString().should.eql("NEAT STUFF");
            });
        });
        it("the filename", function () {
            return squickToFiles([hasNoTitle], [titleTemplate]).then(function (files) {
                files[0].contents.toString().should.eql("cool title");
            });
        });
    });
});
