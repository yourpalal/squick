# Squick

![travis-ci build status](https://travis-ci.org/yourpalal/squick.svg)

Squick is designed to make it easy to build static sites with [gulp](http://gulpjs.com/) and [dustjs](http://www.dustjs.com/), and [markdown](https://help.github.com/articles/markdown-basics/) via [marked](https://www.npmjs.com/package/marked).

Squick aims to do one thing well: turn markdown files and dust templates into a stream
of rendered HTML files. This lets users leverage any gulp plugin they want for
whatever additional features they desire.

Here is the simplest possible gulpfile to build a site using Squick:

```
var gulp = require("gulp");
var squick = require("squick");


gulp.task("default", function() {
  return new squick({
    content: gulp.src(["content/**/*.md"]),
    views: gulp.src(["views/**/*.html"]),
  })
    .pipe(gulp.dest("output/"));
});
```

This will pick up some .md files, extract their JSON front-matter, render each file via the appropriate template, and then write the results to the output folder.

## configuration

The following configuration keys are recognized by Squick:

* `content` a stream of markdown files, probably from gulp.src
* `views` a stream of dustjs templates, probably from gulp.src
* `site` (optional) an arbitrary object which will be passed to all templates as `site`
* `filters` (optional) an object containing dust filters to be added to the dust environment.
* `helpers` (optional) an object containing dust helpers to be added to the dust environment.
* `marked` (optional) configuration for [marked](https://www.npmjs.com/package/marked).

## front-matter

Each markdown file can have a JSON-formatted object at the start of the file which will be extracted and passed to templates as `post.meta`. The following keys have special significance. No whitespace is allowed ahead of the JSON object.

* `template` specifies the template to be used when rendering this post
* `title` specifies the title of the post

### Template Environment

The templates are rendered via [dustjs](http://www.dustjs.com/docs/api/). In addition to the standard dust filters, Squick includes the [dustjs-helpers](http://www.dustjs.com/guides/dust-helpers/) and a few helpers and filters, listed below. You can also add custom filters and helpers via the `filters`
and `helpers` configuration key.

#### variables

The following variables are available to your templates:

 * `post` a post object (see below) for the current post
 * `site` whatever data was passed in as `site` in squick's configuration.

#### post objects

A Post object provides access to the content and front-matter for a given markdown file. It has the following properties:

 * `meta` example: `{post.meta.tags}` the contents of the given post's front matter.
 * `title` example `{post.title}` the title of the post. The title of the post is either:
   1. the value of `title` in the front-matter
   2. the value of the first header in the markdown content
   3. the filename of the .md file, with '.md' removed, and with dashes replaced with spaces. (eg. "This-Cool-Post.md" would become "This Cool Post")

#### helpers

* `@markdown` takes a string and converts it from markdown to HTML. The following uses of the markdown helper are roughly equivalent.

        {@markdown content=post.content /}
        {@markdown:post.content /}
        {#post.content}<div class="wrapper">
          {@markdown /}
        </div>{/post.content}

* `@fetch` takes a list of filenames and renders a block for each file. Useful for making an index page.

        {@fetch paths=post.meta.include as="article"}
          <h1>{article.title}</h1>
          {article.content}
        {/fetch}
