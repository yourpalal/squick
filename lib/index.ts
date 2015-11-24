/// <reference path="../typings/tsd.d.ts"/>
/// <reference path="../typings/others.d.ts"/>

import concat = require("concat-stream");
import * as dust from "dustjs-linkedin";
import {EventEmitter} from "events";
import * as glob from "glob";
import {Readable, Transform, Writable} from "stream";
import File = require("vinyl");

class DustStream extends Readable {
  constructor(template: string, context: any) {
    super();

    dust.stream(template, context)
      .on("data", (d) => { this.push(d); })
      .on("end", () => { this.push(null); })
      .on("error", (err) => { this.emit("error", err); });
  }

  _read() {
      // nothing to do but wait
  }
}

function concatFile(f: File, cb: (f: File, s: string) => any) {
    f.pipe(concat({encoding: "string"}, (content: string) => {
      cb(f, content);
    }));
}


class Post {
  meta: any;
  contents: string;

  constructor(public file: File, contents: string) {
    this.parseContents(contents);
  }

  name(): string {
    return this.file.relative;
  }

  parseContents(source: string) {
    if (source[0] != "{") {
      this.meta = {};
      this.contents = source;
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
        this.contents = source.substr(i + 1);
        this.meta = JSON.parse(source.substr(0, i + 1));
        break;
      }
    }
  }
}

export = class Squick extends Readable {
  private posts: Post[] = [];
  private templates: {[name: string]: boolean} = {};

  private postsRendered = 0;
  private allPostsAvailable = false;

  constructor(content: Readable, views: Readable) {
      super({objectMode: true});

      content.on("data", (f: File) => {
          concatFile(f, (f, c) => this.addPost(f, c));
      }).on("end", () => {
        this.allPostsAvailable = true;
        this.emit("posts-ended");
        this.endIfFinished();
      });

      views.on("data", (f: File) => {
          concatFile(f, (f, c) => this.addTemplate(f, c));
      }).on("end", () => this.emit("templates-ended"));
  }

  _read() {
    // cannot do anything really :(
  }

  getPost(name: string): Promise<Post> {
      for (var post of this.posts) {
        if (post.name() == name) {
          return Promise.resolve(post);
        }
      }

      return new Promise((resolve, reject) => {
          let postAvailableListener = (post) => {
            if (post.name() == name) {
              resolve(post);
              this.removeListener("post-available", postAvailableListener);
            }
          };

          this.on("post-available", postAvailableListener);
      });
  }

  addPost(file: File, contents: string) {
      let post = new Post(file, contents);
      this.posts.push(post);
      this.emit("post-available", post);

      this.renderPostForFile(post)
        .then((f: File) => {
          this.push(f);
          this.postsRendered++;
          this.endIfFinished();
        });
  }

  endIfFinished() {
      if (this.postsRendered == this.posts.length && this.allPostsAvailable) {
          this.push(null);
      }
  }

  addTemplate(file: File, contents: string) {
      dust.compileFn(contents, file.relative);
      this.templates[file.relative] = true;
      this.emit("template-available", file.relative);
  }

  getTemplate(name: string): Promise<any> {
      if (name in this.templates) {
          console.log("found template", name);
          return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
          let onAvailable = (templateName) => {
              if (templateName == name) {
                resolve();
                this.removeListener("template-available", onAvailable);
              }
          };
          this.on("template-available", onAvailable);
      });
  }

  renderPostForFile(post: Post): Promise<File> {
      return this.startRender(post)
        .then((content) => {
            let result = new File({
                base: post.file.base,
                path: post.file.path,
                contents: content
            });

            result.extname = ".html";
            return result;
        });
  }

  startRender(post: Post, template: string = null): Promise<Readable> {
      template = template || post.meta.template;

      return this.getTemplate(template)
        .then(() => new DustStream(template, post.meta));
  }
}
