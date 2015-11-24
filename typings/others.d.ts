/// <reference path="./node/node.d.ts" />


declare module "concat-stream" {
  import {Writable} from "stream";

  interface ConcatOpts {
      encoding: string;
  }

  function concat<T>(opts: ConcatOpts, r: (t:T) => any): Writable;
  function concat<T>(r: (t:T) => any): Writable;

  export = concat;
}
