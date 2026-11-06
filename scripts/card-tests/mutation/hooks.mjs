// Node module hook for `npm run card-tests -- mutate` (docs/TESTING.md):
// rewrites src/data/cards.js IN MEMORY before the tests import it, running
// the JavaScript in $MUT against the parsed catalog (`cards`, plus a
// `card(name, set?)` lookup). Nothing on disk changes. From the seed-2-02 pilot.
//
// If the mutation itself throws (a wrong JSON path, an unknown card), the
// module is replaced with one that throws `MUTATION_ERROR: …`, so the CLI can
// report "the mutation didn't apply" instead of mistaking the crash for a
// detected behavior change.

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith("/src/data/cards.js") && process.env.MUT) {
    const source = result.source.toString();
    const body = source.replace(/^\s*export default\s*/, "").replace(/;\s*$/, "");
    const cards = JSON.parse(body);
    const card = (name, set) => {
      const found = cards.find((c) => c.name === name && (set === undefined || c.set === set));
      if (!found) throw new Error(`no card ${name}${set ? ` (${set})` : ""}`);
      return found;
    };
    try {
      new Function("cards", "card", process.env.MUT)(cards, card);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).replace(/[`\\$]/g, "");
      return { ...result, source: `throw new Error(\`MUTATION_ERROR: ${message}\`);` };
    }
    return { ...result, source: "export default " + JSON.stringify(cards) + ";" };
  }
  return result;
}
