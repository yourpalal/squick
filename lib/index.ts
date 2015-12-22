/// <reference path="../typings/tsd.d.ts"/>
/// <reference path="../typings/others.d.ts"/>

import bl = require("bl");
import dust = require("dustjs-helpers");
import {EventEmitter} from "events";
import * as glob from "glob";
import gutil = require("gulp-util");
import * as marked from "marked";
import * as path from "path";
import {Readable, Transform, Writable} from "stream";
import File = require("vinyl");


class DustStream extends Readable {
    constructor(template: string, context: dust.Context, name: string) {
        super();

        dust.stream(template, context)
            .on("data", (d) => {
                this.push(d);
            })
            .on("end", () => { this.push(null); })
            .on("error", (err) => {
                this.emit("error", new gutil.PluginError({
                    plugin: "squick",
                    showProperties: false,
                    message: `Error while rendering ${name} with ${template}:\n\t${err}`
                }));
            });
    }

    _read() { /* nothing to do but wait */ }
}

class Post {
    meta: any;
    content: string;

    constructor(public file: File) {
        this.parseContents(file.contents.toString());
    }

    name(): string {
        return this.file.relative;
    }

    title(): string {
        if (this.meta.title) {
            return this.meta.title;
        }

        // match # THIS IS THE TITLE
        let match = this.content.match(/\s*#+([^\n]*)/);
        if (match) {
            return match[1].trim();
        }

        // match
        // THIS IS THE TITLE
        // =================
        match = this.content.match(/s*([^\n]*)\n=+/);
        if (match) {
            return match[1].trim();
        }

        // match
        // THIS IS THE TITLE
        // -----------------
        match = this.content.match(/s*([^\n]*)\n-+/);
        if (match) {
            return match[1].trim();
        }

        let ext = path.extname(this.file.relative);
        return path.basename(this.file.relative, ext).replace(/-+/, " ");
    }

    parseContents(source: string) {
        if (source[0] != "{") {
            this.meta = {};
            this.content = source;
            console.log("no front matter found in", this.file.path);
            return;
        }

        let nested = 0;
        for (let i = 0; i < source.length; i++) {
            if (source[i] == "{") {
                nested += 1;
            } else if (source[i] == "}") {
                nested -= 1;
            }

            if (nested == 0) {
                this.content = source.substr(i + 1);
                this.meta = JSON.parse(source.substr(0, i + 1));
                break;
            }
        }
    }
}

interface SquickOptions {
    views: Readable;
    content?: Readable;
    site?: any;
    filters?: { [key: string]: (value: string) => string };
    helpers?: { [key: string]: (chk: dust.Chunk, ctx: dust.Context, bodies?: any, params?: any) => any };
    marked?: any;
}

export = class Squick extends Transform {
    private allPosts: Promise<Post[]>;
    private posts: Post[] = [];

    private allTemplatesAvailable = false;
    private baseContext: dust.Context;

    constructor(private options: SquickOptions) {
        super({ objectMode: true });
        this.setMaxListeners(100);

        if (this.options.marked) {
            marked.setOptions(this.options.marked);
        }

        this.allPosts = new Promise<Post[]>((resolve, reject) => {
            this.once("error", reject);
            this.once("finish", () => resolve(this.posts));
        });

        this.setupDust();

        options.views
            .on("data", (f: File) => {
                if (f.isBuffer()) {
                    return this.addTemplate(f);
                }

                (f.contents as Readable).pipe(new bl((err, data: Buffer) => {
                    if (err) {
                        return this.emit("error", err);
                    }

                    f.contents = data;
                    this.addTemplate(f);
                }));
            })
            .on("end", () => {
                this.allTemplatesAvailable = true;
                this.emit("templates-ended");
            });

        if ("content" in options) {
            options.content.pipe(this);
        }

    }

    _transform(f: File, ignored, cb) {
        if (f.isBuffer()) {
            return cb(null, this.addPost(f));
        }

        (f.contents as Readable).pipe(new bl((err, data: Buffer) => {
            if (err) {
                return cb(err, null);
            }

            f = f.clone();
            f.contents = data;
            cb(null, this.addPost(f));
        }));
    }

    setupDust() {
        let globals = {
            site: this.options.site || {},
        } as any;
        let options = {
            all_posts: this.allPosts
        };

        this.baseContext = dust.makeBase(globals, options);
        dust.onLoad = (templateName: string, options, callback: Function) => {
            return this.getTemplate(templateName)
                .then((template) => callback(null, template),
                    (err) => callback(err, null));
        };

        // add custom filters
        for (var key in this.options.filters) {
            if (this.options.filters.hasOwnProperty(key)) {
                dust.filters[key] = this.options.filters[key];
            }
        }

        // add custom helpers
        for (var key in this.options.helpers) {
            if (this.options.helpers.hasOwnProperty(key)) {
                dust.helpers[key] = this.options.helpers[key];
            }
        }

        dust.helpers["markdown"] = (chunk: dust.Chunk, context: dust.Context, bodies, params) => {
            let fallback = (typeof context.current() == "string") ? context.current() : "";
            return chunk.write(marked(params.content || fallback));
        };

        dust.helpers["fetch"] = (chunk: dust.Chunk, context: dust.Context, bodies, params) => {
            let key = params["as"] || "post";
            let paths = params["paths"] || [];

            return chunk.map((chunk) => {
                // get all posts
                Promise.all(paths.map((path) =>
                    this.getPost(path).then((post) => {
                        let data = {};
                        data[key] = post;
                        return data;
                    })
                )).then((posts) => {
                    // render body once per post
                    for (var post of posts) {
                        chunk = bodies.block(chunk, context.clone().push(post));
                    }
                    chunk.end();
                }).catch((err) => {
                    // propagate any errors in fetching the posts
                    chunk.setError(err);
                });

                return chunk;
            });
        };
    }

    getPost(name: string): Promise<Post> {
        for (var post of this.posts) {
            if (post.name() == name) {
                return Promise.resolve(post);
            }
        }

        let error = `cannot find post ${name}`;

        return new Promise((resolve, reject) => {
            let available = (post) => {
                if (post.name() == name) {
                    resolve(post);
                    this.removeListener("post-available", available);
                }
            };

            this.on("post-available", available);
            this.allPosts.then(() => {
                this.removeListener("post-available", available);
                reject(error);
            });
        });
    }

    addPost(file: File): File {
        try {
            var post = new Post(file);
        } catch(e) {
            this.emit("error", new gutil.PluginError({
                plugin: "Squick",
                message: `JSON Syntax error in ${file.path}:\n\t${e.toString()}`
            }));
            return;
        }
        this.posts.push(post);
        this.emit("post-available", post);

        return this.renderPostForFile(post);
    }

    addTemplate(file: File) {
        try {
            dust.compileFn(file.contents.toString(), file.relative);
            this.emit("template-available", file.relative);
        } catch (err) {
            this.emit("error", new gutil.PluginError({
                plugin: "squick",
                message: `compilation of template (${file.relative}) failed with error:\n\t${err.toString()}`
            }));
        }
    }

    getTemplate(name: string): Promise<dust.Template> {
        if (name in dust.cache) {
            return Promise.resolve(dust.cache[name]);
        }

        let errorMessage = `template ${name} not found`;
        if (this.allTemplatesAvailable) {
            return Promise.reject(errorMessage);
        }

        return new Promise((resolve, reject) => {
            var onAvailable: Function;
            let onFinished = () => {
                this.removeListener("template-available", onAvailable);
                reject(errorMessage);
            };
            onAvailable = (templateName) => {
                if (templateName == name) {
                    resolve();
                    this.removeListener("template-available", onAvailable);
                    this.removeListener("templates-ended", onFinished);
                }
            };
            this.on("template-available", onAvailable);
            this.once("templates-ended", onFinished);
        });
    }

    renderPostForFile(post: Post): File {
        let result = new File({
            base: post.file.base,
            path: post.file.path,
            contents: this.startRender(post)
        });

        result.extname = ".html";
        return result;
    }

    startRender(post: Post, template: string = null): Readable {
        template = template || post.meta.template;
        let context = this.baseContext.clone().push({post: post});
        let stream = new DustStream(template, context, post.name());
        stream.on("error", (err) => {this.emit("error", err);});
        return stream;
    }
}
