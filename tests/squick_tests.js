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
var simpleContent = new File({
    base: "/b/c/",
    path: "/b/c/simple.md",
    contents: new Buffer("{\"template\": \"simple.html\"} wow")
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
function squickToFiles(posts, templates) {
    var result = new Squick(new Src(posts), new Src(templates))
        .pipe(buffer());
    return new Promise(function (resolve, reject) {
        result.on("error", function (err) { return reject(err); });
        result.pipe(concat(function (files) { return resolve(files); }));
    });
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
    it("raises an error when a template is missing", function () {
        return squickToFiles([simpleContent], []).then(function (files) {
            return Promise.reject("did not produce error message");
        }, function (err) {
            err.indexOf("simple.html").should.be.greaterThanOrEqual(0);
        });
    });
});
