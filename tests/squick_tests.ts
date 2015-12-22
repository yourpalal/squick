/// <reference path="../typings/tsd.d.ts"/>
/// <reference path="./custom_assertions.d.ts"/>

import Squick  = require("../lib/index");

import buffer = require("vinyl-buffer");
import concat = require("concat-stream");
import * as dust from "dustjs-linkedin";
import {Readable, Stream, Transform} from "stream";
import File = require("vinyl");
import path = require("path");

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

function template(content, name="simple.html") {
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

let conditionalTemplate = template(
    "{@eq key=post.name value=nope}YES{:else}NO{/eq}");

let includerTemplate = template(
`\{post.content}
{@fetch paths=post.meta.include as="article"}
    |\{article.content}
{/fetch}`, "fetch.html");

let badTemplate = template("{% wow %}");
let simpleTemplate = template("page content: {post.content}");
let partial = template("partial", "partial.html");
let partialIncluder = template("cool {>\"partial.html\" /}, bro");
let postsCountTemplate = template("{@postsCount /}");
let customFilter = template("{post.content|catify}");
let customHelper = template("{@meow /}");
let siteTemplate = template("site msg: {site.msg}");

let badJSON = post("bad.md", null, `\{nope00----\} wow`);

let simpleContent = post("simple.md", {
    template: "simple.html",
}, "wow");

let includerContent = post("lots.md", {
    template: "fetch.html",
    include: ["simple.md", "simple.md"]
}, "neat");


function streamToPromise(s: Stream): Promise<File[]> {
    return new Promise((resolve, reject) => {
        // catch squick errors
        s.on("error", (err) => reject(err));

        // catch individual file errors
        let buffered = s.pipe(buffer());
        buffered.on("error", (err) => reject(err));

        buffered.pipe(concat((files: File[]) => resolve(files)));
    });
}

function squickToFiles(posts: File[], templates: File[], opts: any={}): Promise<File[]> {
    opts = opts || {};
    opts.views = new Src(templates);

    let result = new Src(posts)
        .pipe(new Squick(opts));
    return streamToPromise(result);
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
                contents: new Buffer("page content: wow")
            });
        }
    ));

    it("can take the content stream as an option", () =>
        streamToPromise(new Squick({
            content: new Src([simpleContent]),
            views: new Src([simpleTemplate])
        })).then((files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: new Buffer("page content: wow")
            });
        })
    );

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
                contents: "neat|wow|wow"
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
                contents: "meow wow meow"
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

    it("adds a all_posts Promise to the context options", () =>
        squickToFiles([simpleContent], [postsCountTemplate], {
            helpers: {
                "postsCount": function(chunk, context) {
                    return context.options.all_posts.then((posts) => posts.length);
                }
            }
        }).then((files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: "1"
            });
        })
    );

    describe("can determine the title of a post through:", () => {
        let hasMeta = post("cool-title.md", {
            title: "wow",
            template: "simple.html",
        }, "# NEAT STUFF");

        let hasH1HashTitle = post("cool-title.md", {
            template: "simple.html",
        }, "# NEAT STUFF");

        let hasH2HashTitle = post("cool-title.md", {
            template: "simple.html",
        }, "# NEAT STUFF");

        let hasEqualsTitle = post("cool-title.md", {
            template: "simple.html",
        }, "NEAT STUFF\n=======");

        let hasDashesTitle = post("cool-title.md", {
            template: "simple.html",
        }, "NEAT STUFF\n----------");

        let hasNoTitle = post("cool-title.md", {
            template: "simple.html",
        }, "oh dang");

        let titleTemplate = template("{post.title}");

        it("post.meta.title", () =>
            squickToFiles([hasMeta], [titleTemplate]).then((files) => {
                files[0].contents.toString().should.eql("wow");
            })
        );

        it("a # header", () =>
            squickToFiles([hasH1HashTitle], [titleTemplate]).then((files) => {
                files[0].contents.toString().should.eql("NEAT STUFF");
            })
        );

        it("a ## header", () =>
            squickToFiles([hasH2HashTitle], [titleTemplate]).then((files) => {
                files[0].contents.toString().should.eql("NEAT STUFF");
            })
        );

        it("a ==== header", () =>
            squickToFiles([hasEqualsTitle], [titleTemplate]).then((files) => {
                files[0].contents.toString().should.eql("NEAT STUFF");
            })
        );

        it("a ----- header", () =>
            squickToFiles([hasEqualsTitle], [titleTemplate]).then((files) => {
                files[0].contents.toString().should.eql("NEAT STUFF");
            })
        );

        it("the filename", () =>
            squickToFiles([hasNoTitle], [titleTemplate]).then((files) => {
                files[0].contents.toString().should.eql("cool title");
            })
        );
    });
});
