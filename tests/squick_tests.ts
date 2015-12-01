/// <reference path="../typings/tsd.d.ts"/>
/// <reference path="./custom_assertions.d.ts"/>

import Squick  = require("../lib/index");

import concat = require("concat-stream");
import * as dust from "dustjs-linkedin";
import {Readable, Transform} from "stream";
import File = require("vinyl");
import buffer = require("vinyl-buffer");

import should = require("should");

should["Assertion"].add("vinylFile", function(expected) {
    this.params = {operator: "to be a vinyl file"};
    File.isVinyl(this.obj).should.be.ok;

    this.obj.should.have.property("path", expected.path);
    this.obj.should.have.property("base", expected.base);
    this.obj.contents.toString().should.equal(expected.contents.toString());
});

class Src extends Readable {
    private i = 0;

    constructor(private files: File[]) {
      super({objectMode: true});
    }

    _read(n: number) {
        for (;n > 0 && this.i < this.files.length; n--, this.i++) {
          this.push(this.files[this.i]);
        }

        if (this.i == this.files.length) {
          this.push(null);
          this.i++;
        }
    }
}

let simpleTemplate = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("page content: {post.content}")
});

let badTemplate = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("{% wow %}")
});

let conditionalTemplate = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("{@eq key=post.name value=nope}YES{:else}NO{/eq}")
});

let customFilter = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("{post.content|catify}")
});

let customHelper = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("{@meow /}")
});

let siteTemplate = new File({
    base: "/b/t/",
    path: "/b/t/simple.html",
    contents: new Buffer("site msg: {site.msg}")
});

let badJSON = new File({
  base: "/b/c/",
  path: "/b/c/bad.md",
  contents: new Buffer(`\{nope00----\} wow`)
});

let simpleContent = new File({
  base: "/b/c/",
  path: "/b/c/simple.md",
  contents: new Buffer(`\{"template": "simple.html"\} wow`)
});

let includerContent = new File({
    base: "/b/c/",
    path: "/b/c/lots.md",
    contents: new Buffer(`\{"template": "fetch.html", "include": ["simple.md", "simple.md"] \}neat`)
});

let includerTemplate = new File({
    base: "/b/t/",
    path: "/b/t/fetch.html",
    contents: new Buffer("{post.content}{@fetch paths=post.meta.include as=\"article\"}{article.content}{/fetch}")
});

let partial = new File({
    base: "b/t/",
    path: "b/t/partial.html",
    contents: new Buffer("partial")
});

let partialIncluder = new File({
    base: "b/t/",
    path: "b/t/simple.html",
    contents: new Buffer("cool {>\"partial.html\" /}, bro")
});


function squickToFiles(posts: File[], templates: File[], opts: any={}): Promise<File[]> {
    opts = opts || {};
    opts.content = new Src(posts);
    opts.views = new Src(templates);

    let result = new Squick(opts);

    return new Promise((resolve, reject) => {
        // catch squick errors
        result.on("error", (err) => reject(err));

        // catch individual file errors
        let buffered = result.pipe(buffer());
        buffered.on("error", (err) => reject(err));

        buffered.pipe(concat((files: File[]) => resolve(files)));
    });
}

describe("squick", () => {
    beforeEach(() => {
        dust.cache = {}; // this kind of sucks, but it works
    });

    it("renders files via templates", () =>
        squickToFiles([simpleContent], [simpleTemplate]).then((files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: new Buffer("page content:  wow")
            });
        }
    ));

    it("can include partials", () =>
        squickToFiles([simpleContent], [partial, partialIncluder]).then((files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: new Buffer("cool partial, bro")
            });
        }
    ));

    it("passes arbitrary site info to templates", () =>
        squickToFiles([simpleContent], [siteTemplate], {
            site: {msg: "site info"}
        })
        .then((files => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "site msg: site info"
            });
        }))
    );

    it("adds a helper named @fetch which loops through posts by name", () =>
        squickToFiles([simpleContent, includerContent], [simpleTemplate, includerTemplate])
        .then((files => {
            files.should.have.length(2);
            files[1].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/lots.html",
                contents: "neat wow wow"
            });
        }))
    );

    it("enables the standard dust helpers", () =>
        squickToFiles([simpleContent], [conditionalTemplate])
        .then((files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "NO"
            });
        })
    );

    it("allows custom filters via an option", () =>
        squickToFiles([simpleContent], [customFilter], {
            filters: {
                "catify": (x) => `meow ${x} meow`
            }
        }).then((files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "meow  wow meow"
            });
        })
    );

    it("allows custom helpers via an option", () =>
        squickToFiles([simpleContent], [customHelper], {
            helpers: {
                "meow": (chunk) => {
                    chunk.write("meow meow meow");
                    return chunk;
                }
            }
        }).then((files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "meow meow meow"
            });
        })
    );

    it("catches JSON syntax errors", () =>
        squickToFiles([badJSON], [simpleTemplate], {})
        .then(()  => {
            Promise.reject("did not produce error message");
        }, (err) => {
            err.toString().indexOf("bad.md").should.be.greaterThanOrEqual(0);
        })
    );

    it("raises an error when a template is missing", () =>
        squickToFiles([simpleContent], []).then((files) => {
            return Promise.reject("did not produce error message");
        }, (err) => {
            err.toString().indexOf("simple.html").should.be.greaterThanOrEqual(0);
        })
    );

    it("raises an error when a template doesn't compile", () =>
        squickToFiles([simpleContent], [badTemplate]).then((files) => {
            return Promise.reject("did not produce error message");
        }, (err) => {
            err.toString().indexOf("simple.html").should.be.greaterThanOrEqual(0);
        })
    );

    it("raises an error when a post is missing", () =>
        squickToFiles([includerContent], [includerTemplate]).then((files) => {
            return Promise.reject("did not produce error message");
        }, (err) => {
            err.toString().indexOf("simple.md").should.be.greaterThanOrEqual(0);
        })
    );
});
