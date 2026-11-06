// Registers ./hooks.mjs (see there). Loaded with `node --import <this file>`.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
