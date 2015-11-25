/// <reference path="../typings/tsd.d.ts"/>
/// <reference path="../typings/others.d.ts"/>

import concat = require("concat-stream");
import * as dust from "dustjs-linkedin";
import {EventEmitter} from "events";
import * as glob from "glob";
import {Readable, Transform, Writable} from "stream";
import File = require("vinyl");
import * as marked from "marked";

class DustStream extends Readable {
  constructor(template: string, context: any) {
    super();

    dust.stream(template, context)
      .on("data", (d) => { this.push(d); })
      .on("end", () => { this.push(null); })
      .on("error", (err) => { this.emit("error", err); });
  }

  _read() { /* nothing to do but wait */ }
}

function concatFile(f: File, cb: (f: File, s: string) => any) {
    f.pipe(concat({encoding: "string"}, (content: string) => {
      cb(f, content);
    }));
}


class Post {
  meta: any;
  content: string;

  constructor(public file: File, contents: string) {
    this.parseContents(contents);
  }

  name(): string {
    return this.file.relative;
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

export = class Squick extends Readable {
  private posts: Post[] = [];

  private postsRemaining = 0;
  private allPostsAvailable = false;
  private allTemplatesAvailable = false;

  constructor(content: Readable, views: Readable) {
      super({objectMode: true});
      this.setupDust();

      content.on("data", (f: File) => {
          this.postsRemaining++;
          concatFile(f, (f, c) => this.addPost(f, c));
      }).on("end", () => {
        this.allPostsAvailable = true;
        this.emit("posts-ended");
        this.endIfFinished();
      });

      views.on("data", (f: File) => {
          concatFile(f, (f, c) => this.addTemplate(f, c));
      }).on("end", () => {
          this.allTemplatesAvailable = true;
          this.emit("templates-ended");
      });
  }

  setupDust() {
    dust.onLoad = (templateName: string, options, callback: Function) => {
        return this.getTemplate(templateName)
          .then((template) => callback(null, template),
                (err) => callback(err, null));
    };

    dust.helpers["markdown"] = (chunk: dust.Chunk, context, bodies, params) => {
      return chunk.write(marked(params.content));
    };
  }

  _read() { /* nothing to do but wait */ }

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

      this.push(this.renderPostForFile(post));
      this.postsRemaining--;
      this.endIfFinished();
  }

  endIfFinished() {
      if (this.postsRemaining == 0 && this.allPostsAvailable) {
          this.push(null);
      }
  }

  addTemplate(file: File, contents: string) {
      dust.compileFn(contents, file.relative);
      this.emit("template-available", file.relative);
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
          let onFinished = () => reject(`template ${name} not found`);
          let onAvailable = (templateName) => {
              if (templateName == name) {
                resolve();
                this.removeListener("template-available", onAvailable);
              }
          };
          this.on("template-available", onAvailable);
          this.on("templates-ended", onFinished);
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
      return new DustStream(template, {post: post});
  }
}
