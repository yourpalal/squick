/// <reference path="../typings/tsd.d.ts"/>
/// <reference path="./custom_assertions.d.ts"/>

import Squick = require("../lib/index");

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

function getEvent<T>(emitter, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
        emitter.once(event, (arg) => {
            resolve(arg);
        });
    });
}


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

let simpleContent = new File({
  base: "/b/c/",
  path: "/b/c/simple.md",
  contents: new Buffer(`\{"template": "simple.html"\} wow`)
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

function checkSquicked(posts: File[], templates: File[], test: (f: File[]) => any) {
    new Squick(new Src(posts), new Src(templates))
        .pipe(buffer())
        .pipe(concat((files: File[]) => test(files)));
}

describe("squick", () => {
    beforeEach(() => {
        dust.cache = {}; // this kind of sucks, but it works
    });

    it("renders files via templates", (done) => {
        checkSquicked([simpleContent], [simpleTemplate], (files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: new Buffer("page content:  wow")
            });
            done();
        });
    });

    it("can include partials", (done) => {
        checkSquicked([simpleContent], [partial, partialIncluder], (files) => {
            files.should.have.length(1);
            files[0].should.be.vinylFile({
                base: "/b/c/",
                path: "/b/c/simple.html",
                contents: new Buffer("cool partial, bro")
            });
            done();
        });
    });

    it("raises an error when a template is missing", () => {
        let files = new Squick(new Src([simpleContent]), new Src([]))
            .pipe(buffer());

        return getEvent<string>(files, "error")
            .then((err: string) => {
                err.indexOf("simple.html").should.be.greaterThanOrEqual(0);
            });
    });
});
