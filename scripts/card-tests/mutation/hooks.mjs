// Node module hook for `npm run card-tests -- mutate` (docs/TESTING.md):
// rewrites the per-set catalog modules (src/data/sets/<set id>.js) IN MEMORY
// before the tests import them. The JavaScript in $MUT runs once, against the
// whole parsed catalog (`cards`, plus a `card(name, set?)` lookup), and each
// set module is then served the mutated printings whose `set` is that set.
// Nothing on disk changes. From the seed-2-02 pilot.
//
// If the mutation itself throws (a wrong JSON path, an unknown card), every
// set module is replaced with one that throws `MUTATION_ERROR: …`, so the CLI
// can report "the mutation didn't apply" instead of mistaking the crash for a
// detected behavior change.

import { createRequire } from "node:module";

const { loadCatalog } = createRequire(import.meta.url)("../../lib/catalog.cjs");
const SET_MODULE = /\/src\/data\/sets\/([^/]+)\.js$/;

let mutated;

function mutate() {
  const { sets, cards } = loadCatalog();
  const card = (name, set) => {
    const found = cards.find((c) => c.name === name && (set === undefined || c.set === set));
    if (!found) throw new Error(`no card ${name}${set ? ` (${set})` : ""}`);
    return found;
  };
  try {
    new Function("cards", "card", process.env.MUT)(cards, card);
  } catch (error) {
    return { error: String(error instanceof Error ? error.message : error).replace(/[`\\$]/g, "") };
  }
  return { names: new Map(sets.map((set) => [set.id, set.name])), cards };
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  const match = process.env.MUT ? url.match(SET_MODULE) : null;
  if (!match) return result;
  mutated ??= mutate();
  // The default export lets importers link, so the throw is what they see.
  if (mutated.error) return { ...result, source: `throw new Error(\`MUTATION_ERROR: ${mutated.error}\`);\nexport default [];` };
  const name = mutated.names.get(match[1]);
  return { ...result, source: "export default " + JSON.stringify(mutated.cards.filter((c) => c.set === name)) + ";" };
}
