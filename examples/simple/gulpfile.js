var gulp = require('gulp');
var squick = require('../../lib/');
var debug = require('gulp-debug');


gulp.task("default", function() {
  return new squick({
    content: gulp.src(["content/**/*.md"]),
    views: gulp.src(["views/**/*.html"]),
    site: {name: "simple example"}
  })
    .pipe(debug())
    .pipe(gulp.dest("output/"));
});
