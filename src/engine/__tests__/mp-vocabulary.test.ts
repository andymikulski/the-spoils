// Gate for the multiplayer player vocabulary (docs/TESTING.md, "Multiplayer vocabulary gate"):
// keeps the card data's player words honest against the multiplayer spec
// (data/card-tests/mp-spec/<set>.json) and the work queue (data/card-tests/mp-worklist.json).
//
// The data is the live catalog; the spec records, per clause and behavior path, what each player
// word means and whether the stored value has to change. Phase 4 edits make the queue shrink; any
// edit that skips the spec, the queue or a valid target form fails here.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CardDefinition } from "../../engine.js";
import { CATALOG } from "./clauses/_manifest.js";
import { buildMpInventory, type MpGroup } from "./clauses/_mpInventory.js";
import { evaluate, loadSpecSites, readWorklist, renderWorklist, specGaps, WORKLIST_FILE, type Site } from "./clauses/_mpWorklist.js";

const read = (file: string): string => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const INVENTORY_FILE = fileURLToPath(new URL("../../../data/card-tests/mp-inventory.json", import.meta.url));

const inventory = buildMpInventory();
const sites = loadSpecSites();
const committed = readWorklist();
const found = evaluate(sites);

const list = (lines: string[]): string => `\n  ${lines.join("\n  ")}\n`;

describe("multiplayer vocabulary: card data against the spec", () => {
  test("data/card-tests/mp-inventory.json equals a fresh build (run `npm run card-tests -- mp-inventory`)", () => {
    assert.ok(JSON.stringify(inventory, null, 2) + "\n" === read(INVENTORY_FILE), "mp-inventory.json is stale: run `npm run card-tests -- mp-inventory`");
  });

  test("every relevant behavior site holds a spec dataChanges entry for its clause, at the same path", () => {
    const gaps = specGaps(inventory, sites);
    assert.deepEqual(gaps, [], `add these sites to data/card-tests/mp-spec/<set>.json (dataChanges):${list(gaps)}`);
  });

  test("every spec entry names a printing in the catalog", () => {
    assert.deepEqual(found.unknown, []);
  });

  test("edit:false sites still hold their recorded value", () => {
    assert.deepEqual(found.moved, [], `an edit:false site changed: revert the data, or update the spec (edit, now, path):${list(found.moved)}`);
  });

  test("an edit:true site that left its recorded value now holds a valid target form for its meaning", () => {
    assert.deepEqual(found.invalid, [], `see MEANING_FORMS in clauses/_mpWorklist.ts and docs/MULTIPLAYER-PLAN.md (Player vocabulary):${list(found.invalid)}`);
  });

  test("data/card-tests/mp-worklist.json lists exactly the pending edit:true sites (run `npm run card-tests -- mp-worklist`)", () => {
    assert.ok(committed, "data/card-tests/mp-worklist.json is missing: run `npm run card-tests -- mp-worklist`");
    assert.ok(renderWorklist(found.worklist) === read(WORKLIST_FILE), "mp-worklist.json is stale: the data or the spec changed. Run `npm run card-tests -- mp-worklist`");
  });

  test("every printing of a rules group holds the representative printing's behavior, faction and flip-up data", () => {
    const canonical = (value: unknown): string =>
      JSON.stringify(value, (_key, child) => (child && typeof child === "object" && !Array.isArray(child) ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, (child as Record<string, unknown>)[key]])) : child));
    const parts = (card: CardDefinition) => canonical([card.behavior, card.faction, card.flipUp]);
    const byId = new Map(CATALOG.map((card) => [card.id, card]));
    const differing: string[] = [];
    for (const group of inventory) {
      const representative = parts(byId.get(group.id)!);
      for (const id of group.printings) {
        const printing = byId.get(id)!;
        if (parts(printing) !== representative) differing.push(`${group.name} (${printing.set}, ${id}) differs from the representative printing ${group.id}`);
      }
    }
    assert.deepEqual(differing, [], `patch every printing of a rules group alike:${list(differing)}`);
  });
});

// The checks above run on the real catalog; these run them on small synthetic cards, so a gate that
// stopped catching a violation would be noticed.
describe("multiplayer vocabulary: the gate catches violations", () => {
  const card = (behavior: unknown): CardDefinition => ({ id: "x", name: "X", set: "S", behavior }) as unknown as CardDefinition;
  const site = (path: string, now: unknown, meaning: string, edit: boolean, clause = "0:rule"): Site => ({ set: "s", id: "x", card: "X", clause, path, now, meaning, edit });
  const run = (behavior: unknown, entries: Site[]) => evaluate(entries, [card(behavior)]);
  const pendingPaths = (result: ReturnType<typeof run>) => result.worklist.sets.s!.pending.map((entry) => entry.path);

  test("a site holding its recorded value is pending; a changed one is not", () => {
    const entries = [site("behavior.a.player", "opponent", "anyOneOpponent", true)];
    assert.deepEqual(pendingPaths(run({ a: { player: "opponent" } }, entries)), ["behavior.a.player"]);
    assert.deepEqual(pendingPaths(run({ a: { player: "opponents" } }, entries)), []);
  });

  test("a changed anyOneOpponent site must hold a pick-derived ref, a chosenPlayer ref or \"opponents\"", () => {
    const entries = [site("behavior.a.player", "opponent", "anyOneOpponent", true)];
    for (const ok of ["opponents", { type: "chosenPlayer", id: "p" }, { type: "controllerOf", target: "source" }, { type: "ownerOf", target: "source" }])
      assert.deepEqual(run({ a: { player: ok } }, entries).invalid, [], JSON.stringify(ok));
    for (const bad of ["controller", "self", "any", "chosenPlayer"]) assert.equal(run({ a: { player: bad } }, entries).invalid.length, 1, JSON.stringify(bad));
    assert.equal(run({ a: {} }, entries).invalid.length, 1, "a site that vanished without a wrapping iteration");
  });

  test("eachOpponent: the site moved under forEachPlayer { players: \"opponents\" }, or \"opponents\" where the engine reads it", () => {
    const entries = [site("behavior.a.effects[0].chooser", "opponent", "eachOpponent", true)];
    assert.deepEqual(run({ a: { effects: [{ type: "forEachPlayer", players: "opponents", effects: [{ chooser: "self" }] }] } }, entries).invalid, []);
    assert.equal(run({ a: { effects: [{ type: "forEachPlayer", effects: [{ chooser: "self" }] }] } }, entries).invalid.length, 1, "no players");
    assert.equal(run({ a: { effects: [{ type: "forEachPlayer", players: "all", effects: [{ chooser: "self" }] }] } }, entries).invalid.length, 1, "wrong players");
    assert.equal(run({ a: { effects: [{ chooser: "controller" }] } }, entries).invalid.length, 1);
    assert.equal(run({ a: { effects: [{ chooser: "opponents" }] } }, entries).invalid.length, 1, "the engine refuses chooser: opponents");
    const effect = [site("behavior.a.effects[0].player", "opponent", "eachOpponent", true)];
    assert.deepEqual(run({ a: { effects: [{ player: "opponents" }] } }, effect).invalid, [], "an effect's player is expanded per opponent");
    const selector = [site("behavior.a.effects[0].declaration.selector.controller", "opponent", "eachOpponent", true)];
    assert.deepEqual(run({ a: { effects: [{ declaration: { selector: { controller: "opponents" } } }] } }, selector).invalid, [], "a selector scope reads any opponent");
    const target = [site("behavior.a.effects[0].target.player", "opponent", "eachOpponent", true)];
    assert.equal(run({ a: { effects: [{ target: { type: "factionOf", player: "opponents" } }] } }, target).invalid.length, 1, "factionOf with opponents is refused");
    const condition = [site("behavior.a.condition.player", "opponent", "eachOpponent", true)];
    assert.equal(run({ a: { condition: { type: "x", player: "opponents" } } }, condition).invalid.length, 1, "in a condition opponents means some opponent, not each");
  });

  test("anyOneOpponent reads \"opponents\" in a condition or selector, never as an effect's player", () => {
    const condition = [site("behavior.a.condition.player", "opponent", "anyOneOpponent", true)];
    assert.deepEqual(run({ a: { condition: { type: "x", player: "opponents" } } }, condition).invalid, []);
    const effect = [site("behavior.a.effects[0].player", "opponent", "anyOneOpponent", true)];
    assert.equal(run({ a: { effects: [{ player: "opponents" }] } }, effect).invalid.length, 1, "it would act on every opponent");
    assert.deepEqual(run({ a: { effects: [{ player: { type: "chosenPlayer", id: "p" } }] } }, effect).invalid, []);
  });

  test("refersBack reads \"acting\" only in an opponentFrom \"acting\" ability, and never in a selector", () => {
    const chooser = [site("behavior.abilities[0].effects[0].chooser", "opponent", "refersBack", true)];
    const ability = (extra: object, effect: object) => ({ abilities: [{ id: "a", ...extra, effects: [effect] }] });
    assert.deepEqual(run(ability({ opponentFrom: "acting" }, { chooser: "acting" }), chooser).invalid, []);
    assert.equal(run(ability({}, { chooser: "acting" }), chooser).invalid.length, 1, "no opponentFrom");
    assert.equal(run(ability({ opponentFrom: "choose" }, { chooser: "acting" }), chooser).invalid.length, 1, "wrong opponentFrom");
    const selector = [site("behavior.abilities[0].effects[0].declaration.selector.controller", "opponent", "refersBack", true)];
    const withSelector = (selectorValue: object) => ability({ opponentFrom: "acting" }, { declaration: { selector: selectorValue } });
    assert.equal(run(withSelector({ controller: "acting" }), selector).invalid.length, 1, "a selector does not read acting");
    assert.equal(run(withSelector({ controller: "any" }), selector).invalid.length, 1, "any without the acting condition");
    assert.deepEqual(run(withSelector({ controller: "any", conditions: [{ type: "targetOwnedBy", player: "acting" }] }), selector).invalid, []);
  });

  test("an opponentFrom site must hold \"acting\"", () => {
    const entries = [site("behavior.abilities[0].opponentFrom", null, "chosenOpponent", true)];
    const first = run({ abilities: [{ id: "a" }] }, entries);
    assert.deepEqual(pendingPaths(first), ["behavior.abilities[0].opponentFrom"]);
    assert.deepEqual(pendingPaths(run({ abilities: [{ id: "a", opponentFrom: "acting" }] }, entries)), []);
    assert.deepEqual(run({ abilities: [{ id: "a", opponentFrom: "acting" }] }, entries).invalid, []);
    assert.deepEqual(pendingPaths(run({ abilities: [{ id: "a", opponentFrom: "choose" }] }, entries)), ["behavior.abilities[0].opponentFrom"], "a new node holding another value is not done");
  });

  test("chosenOpponent: the block's opponent word, or a chosenPlayer read-back", () => {
    const entries = [site("behavior.a.effects[0].chooser", "controller", "chosenOpponent", true)];
    assert.deepEqual(run({ a: { effects: [{ chooser: "opponent" }] } }, entries).invalid, []);
    assert.deepEqual(run({ a: { effects: [{ chooser: { type: "chosenPlayer", id: "p" } }] } }, entries).invalid, []);
    assert.equal(run({ a: { effects: [{ chooser: "acting" }] } }, entries).invalid.length, 1);
    assert.equal(run({ a: { effects: [{ chooser: "opponents" }] } }, entries).invalid.length, 1);
  });

  test("a forEachPlayer site stays pending until it gains the players its meaning needs", () => {
    const pair = [site("behavior.a.effects[0]", "forEachPlayer", "chosenPair", true)];
    const first = run({ a: { effects: [{ type: "forEachPlayer", effects: [] }] } }, pair);
    assert.deepEqual(pendingPaths(first), ["behavior.a.effects[0]"]);
    // An edit deeper in the iteration is not an edit of the iteration.
    assert.deepEqual(pendingPaths(run({ a: { effects: [{ type: "forEachPlayer", effects: [{ type: "draw" }] }] } }, pair)), ["behavior.a.effects[0]"]);
    const done = run({ a: { effects: [{ type: "forEachPlayer", players: "pair", effects: [] }] } }, pair);
    assert.deepEqual([pendingPaths(done), done.invalid], [[], []]);
    assert.equal(run({ a: { effects: [{ type: "forEachPlayer", players: "all", effects: [] }] } }, pair).invalid.length, 1);
    const gideon = [site("behavior.a.effects[0]", "forEachPlayer", "other", true)];
    assert.equal(run({ a: { effects: [{ type: "forEachPlayer", players: "others", effects: [] }] } }, gideon).invalid.length, 1, "needs except");
    assert.deepEqual(run({ a: { effects: [{ type: "forEachPlayer", players: "others", except: { type: "chosenPlayer", id: "p" }, effects: [] }] } }, gideon).invalid, []);
    const single = [site("behavior.a.effects[0]", "forEachPlayer", "chosenOpponent", true)];
    assert.equal(run({ a: { effects: [{ type: "forEachPlayer", players: "all", effects: [] }] } }, single).invalid.length, 1, "still iterates");
    assert.deepEqual(run({ a: { effects: [{ type: "draw", player: "opponent" }] } }, single).invalid, []);
  });

  test("a flag site counts as done once it differs from its recorded value, whatever it became", () => {
    const entries = [site("behavior.noResponse", true, "chosenOpponent", true)];
    assert.deepEqual(pendingPaths(run({ noResponse: true }, entries)), ["behavior.noResponse"]);
    assert.deepEqual(pendingPaths(run({ noResponse: "opponent" }, entries)), []);
    assert.deepEqual(run({ noResponse: "opponent" }, entries).invalid, []);
  });

  test("an edit:false site that changes is reported, except a shared copy of an edit:true site", () => {
    const keep = [site("behavior.a.player", "opponent", "chosenOpponent", false)];
    assert.deepEqual(run({ a: { player: "opponent" } }, keep).moved, []);
    assert.equal(run({ a: { player: "opponents" } }, keep).moved.length, 1);
    assert.equal(run({ a: {} }, keep).moved.length, 1);
    const shared = [site("behavior.a.player", "opponent", "anyOneOpponent", true, "0:rule"), site("behavior.a.player", "opponent", "anyOneOpponent", false, "1:rule")];
    assert.deepEqual(run({ a: { player: "opponents" } }, shared).moved, []);
  });

  test("a spec entry for an unknown printing is reported", () => {
    assert.equal(evaluate([{ ...site("behavior.a", "opponent", "chosenOpponent", false), id: "nope" }], [card({})]).unknown.length, 1);
  });

  test("a relevant inventory site missing from the spec is reported with card, clause and path", () => {
    const word = (path: string, value: string) => ({ path, value, unit: "u", link: "ref" as const });
    const group = { id: "x", name: "X", printings: ["x"], batch: "b", clauses: [{ key: "0:rule", mp: true, phrases: [], behavior: [word("behavior.a.player", "opponent"), word("behavior.a.chooser", "controller"), word("behavior.a.target", "ownerOf")] }] } as MpGroup;
    assert.deepEqual(specGaps([group], []), ["X 0:rule behavior.a.player (opponent): no spec dataChanges entry"]);
    assert.deepEqual(specGaps([group], [site("behavior.a.player", "opponent", "chosenOpponent", false)]), []);
    assert.equal(specGaps([group], [site("behavior.a.player", "opponent", "chosenOpponent", false, "7:rule")]).length, 2, "the entry is on another clause");
  });
});

// A data edit that moves a site (`movedTo`) or adds a node (`now: null`) is judged from the data alone.
describe("multiplayer vocabulary: moved sites and new nodes", () => {
  const card = (behavior: unknown): CardDefinition => ({ id: "x", name: "X", set: "S", behavior }) as unknown as CardDefinition;
  const site = (path: string, now: unknown, meaning: string, edit: boolean, movedTo?: string, clause = "0:rule"): Site => ({ set: "s", id: "x", card: "X", clause, path, now, meaning, edit, ...(movedTo !== undefined ? { movedTo } : {}) });
  const run = (behavior: unknown, entries: Site[]) => evaluate(entries, [card(behavior)]);
  const pendingPaths = (result: ReturnType<typeof run>) => result.worklist.sets.s!.pending.map((entry) => entry.path);
  const wrapped = (inner: object, players = "opponents") => ({ a: { effects: [{ type: "forEachPlayer", players, effects: [inner] }] } });

  test("a moved site is judged at movedTo, whatever its old path holds or lacks", () => {
    const entries = [site("behavior.a.effects[0].player", "opponent", "eachOpponent", true, "behavior.a.effects[0].effects[0].player")];
    // The original path now holds the wrapper (no `player`): fine. The value inside sits under forEachPlayer { players: "opponents" }.
    const done = run(wrapped({ player: "opponent" }), entries);
    assert.deepEqual([pendingPaths(done), done.invalid, done.moved], [[], [], []], "a moved site is not pending even when it still reads \"opponent\"");
    assert.deepEqual(run(wrapped({ player: "opponents" }), entries).invalid, []);
    // Another path that exists and holds something else.
    assert.deepEqual(run({ a: { effects: [{ player: "self", effects: [{ player: "opponents" }] }] } }, entries).invalid, []);
  });

  test("a moved site holding an invalid form is reported", () => {
    const entries = [site("behavior.a.effects[0].player", "opponent", "anyOneOpponent", true, "behavior.a.effects[1].player")];
    for (const bad of ["controller", "opponent", "any"]) {
      const result = run({ a: { effects: [{ player: "opponent" }, { player: bad }] } }, entries);
      assert.equal(result.invalid.length, 1, bad);
      assert.match(result.invalid[0]!, /moved to behavior\.a\.effects\[1\]\.player/);
    }
    // eachOpponent outside a wrapper, with "opponent" left at the new path.
    const unwrapped = [site("behavior.a.effects[0].player", "opponent", "eachOpponent", true, "behavior.a.effects[1].player")];
    assert.equal(run({ a: { effects: [{}, { player: "opponent" }] } }, unwrapped).invalid.length, 1);
    assert.equal(run(wrapped({ player: "opponent" }, "all"), [site("behavior.a.effects[0].player", "opponent", "eachOpponent", true, "behavior.a.effects[0].effects[0].player")]).invalid.length, 1, "wrong players");
    assert.deepEqual(run({ a: { effects: [{ player: "opponent" }, { player: { type: "chosenPlayer", id: "p" } }] } }, entries).invalid, []);
  });

  test("a movedTo path that does not exist is a failure, edit true or false", () => {
    const edit = run({ a: { effects: [{ player: "opponents" }] } }, [site("behavior.a.effects[0].player", "opponent", "anyOneOpponent", true, "behavior.a.effects[4].player")]);
    assert.equal(edit.invalid.length, 1);
    assert.match(edit.invalid[0]!, /movedTo behavior\.a\.effects\[4\]\.player does not exist/);
    assert.deepEqual(pendingPaths(edit), []);
    const keep = run({ a: { effects: [{ player: "opponent" }] } }, [site("behavior.a.effects[0].player", "opponent", "chosenOpponent", false, "behavior.a.effects[4].player")]);
    assert.equal(keep.moved.length, 1);
    assert.match(keep.moved[0]!, /movedTo behavior\.a\.effects\[4\]\.player does not exist/);
  });

  test("an edit:false site with movedTo must hold its now at movedTo", () => {
    const entries = [site("behavior.a.effects[0].player", "opponent", "chosenOpponent", false, "behavior.a.effects[1].player")];
    assert.deepEqual(run({ a: { effects: [{ type: "pick" }, { player: "opponent" }] } }, entries).moved, [], "the old path may hold anything");
    assert.equal(run({ a: { effects: [{ player: "opponent" }, { player: "opponents" }] } }, entries).moved.length, 1, "the old path holding it does not help");
  });

  test("a new node (now: null) is pending until its path holds a valid form, then done", () => {
    const wrapper = [site("behavior.a.effects[0]", null, "eachOpponent", true)];
    for (const absent of [{ a: { effects: [] } }, { a: { effects: [{ type: "draw" }] } }, { a: { effects: [{ type: "forEachPlayer", effects: [] }] } }, { a: { effects: [{ type: "forEachPlayer", players: "all", effects: [] }] } }])
      assert.deepEqual(pendingPaths(run(absent, wrapper)), ["behavior.a.effects[0]"], JSON.stringify(absent));
    const done = run({ a: { effects: [{ type: "forEachPlayer", players: "opponents", effects: [] }] } }, wrapper);
    assert.deepEqual([pendingPaths(done), done.invalid], [[], []]);
    // A new field holding its value.
    const field = [site("behavior.abilities[0].opponentFrom", null, "chosenOpponent", true)];
    assert.deepEqual(pendingPaths(run({ abilities: [{ id: "a" }] }, field)), ["behavior.abilities[0].opponentFrom"]);
    assert.deepEqual(pendingPaths(run({ abilities: [{ id: "a", opponentFrom: "acting" }] }, field)), []);
    // A new node of a meaning the gate does not constrain is done once it exists.
    const unconstrained = [site("behavior.a.extra", null, "anyPlayer", true)];
    assert.deepEqual(pendingPaths(run({ a: {} }, unconstrained)), ["behavior.a.extra"]);
    assert.deepEqual(pendingPaths(run({ a: { extra: 1 } }, unconstrained)), []);
    // A new step whose meaning is read through player references needs one.
    const step = [site("behavior.a.costs[1]", null, "anyOneOpponent", true)];
    const withCost = (extra: object) => ({ a: { costs: [{ type: "pay" }, { type: "otherPlayerChooses", effects: [], ...extra }] } });
    assert.deepEqual(pendingPaths(run({ a: { costs: [{ type: "pay" }] } }, step)), ["behavior.a.costs[1]"], "missing");
    assert.deepEqual(pendingPaths(run(withCost({ chooser: "opponent" }), step)), ["behavior.a.costs[1]"], "no reference converted");
    assert.deepEqual(pendingPaths(run(withCost({ chooser: { type: "chosenPlayer", id: "p" } }), step)), []);
  });

  test("a cost step cannot ask: a playerChoices entry read back with chosenPlayer satisfies anyOneOpponent, chosenOpponent and refersBack", () => {
    const ability = (extra: object) => ({ abilities: [{ id: "a", ...extra }] });
    const choice = { id: "p", from: "opponents" };
    const read = { costs: [{ type: "otherPlayerChooses", chooser: { type: "chosenPlayer", id: "p" }, effects: [] }] };
    const moved = (meaning: string) => [site("behavior.abilities[0].costs[0].chooser", "opponent", meaning, true, "behavior.abilities[0].playerChoices[0]")];
    for (const meaning of ["anyOneOpponent", "chosenOpponent", "refersBack"]) {
      const ok = run(ability({ playerChoices: [choice], ...read }), moved(meaning));
      assert.deepEqual([ok.invalid, pendingPaths(ok)], [[], []], meaning);
    }
    const text = (result: ReturnType<typeof run>) => result.invalid.join("\n");
    assert.match(text(run(ability({ playerChoices: [choice], costs: [{ type: "pay" }] }), moved("anyOneOpponent"))), /no \{ type: "chosenPlayer", id: "p" \} reads the playerChoices entry back/);
    assert.match(text(run(ability({ playerChoices: [{ id: "p", from: "players" }], ...read }), moved("anyOneOpponent"))), /needs a player choice from: "opponents"/);
    assert.equal(run(ability({ playerChoices: [{ from: "opponents" }], ...read }), moved("anyOneOpponent")).invalid.length, 1, "no id");
    // refersBack takes either source; a meaning that chosenPlayer does not satisfy refuses the entry.
    assert.deepEqual(run(ability({ playerChoices: [{ id: "p", from: "players" }], ...read }), moved("refersBack")).invalid, []);
    assert.equal(run(ability({ playerChoices: [choice], ...read }), moved("cardRelative")).invalid.length, 1);
    // A new playerChoices entry named by its real path (now: null).
    const created = [site("behavior.abilities[0].playerChoices[0]", null, "anyOneOpponent", true)];
    assert.deepEqual(pendingPaths(run(ability({ costs: [] }), created)), ["behavior.abilities[0].playerChoices[0]"]);
    assert.equal(run(ability({ playerChoices: [choice], ...read }), created).worklist.total.sites, 0);
  });

  test("a movedTo that names a converted child node is judged by the player references inside it", () => {
    const entries = [site("behavior.abilities[0].costs[0].chooser", "opponent", "anyOneOpponent", true, "behavior.abilities[0].costs[0]")];
    const cost = (extra: object) => ({ abilities: [{ id: "a", costs: [{ type: "otherPlayerChooses", effects: [], ...extra }] }] });
    for (const ok of [{ chooser: { type: "chosenPlayer", id: "p" } }, { chooser: "self", declaration: { selector: { controller: "opponents" } } }, { chooser: { type: "controllerOf", target: "source" } }]) {
      const result = run(cost(ok), entries);
      assert.deepEqual([result.invalid, pendingPaths(result)], [[], []], JSON.stringify(ok));
    }
    assert.equal(run(cost({ chooser: "opponent" }), entries).invalid.length, 1, "still the raw opponent");
    assert.equal(run(cost({ chooser: "self" }), entries).invalid.length, 1, "nothing converted");
    assert.equal(run(cost({ chooser: { type: "chosenPlayer", id: "p" }, declaration: { selector: { controller: "opponent" } } }), entries).invalid.length, 1, "one child converted, another still raw");
  });

  test("the spec-gap check accepts a new node by its real path, a moved site by movedTo, and a word inside a movedTo node", () => {
    const word = (path: string, value: string) => ({ path, value, unit: "u", link: "ref" as const });
    const group = (...words: Array<[string, string]>) => ({ id: "x", name: "X", printings: ["x"], batch: "b", clauses: [{ key: "0:rule", mp: true, phrases: [], behavior: words.map(([path, value]) => word(path, value)) }] }) as MpGroup;
    const inventory = group(["behavior.a.effects[0]", "forEachPlayer"], ["behavior.a.effects[0].effects[0].player", "opponent"], ["behavior.a.costs[0].declaration.selector.controller", "any"]);
    assert.equal(specGaps([inventory], []).length, 3);
    const entries = [
      site("behavior.a.effects[0]", null, "eachOpponent", true),
      site("behavior.a.effects[0].player", "opponent", "eachOpponent", true, "behavior.a.effects[0].effects[0].player"),
      site("behavior.a.costs[0].chooser", "opponent", "anyOneOpponent", true, "behavior.a.costs[0]")
    ];
    assert.deepEqual(specGaps([inventory], entries), []);
    assert.equal(specGaps([inventory], entries.slice(1)).length, 1, "the new wrapper is unlisted");
    assert.equal(specGaps([inventory], [{ ...entries[2]!, movedTo: "behavior.a.costs[1]" }, ...entries.slice(0, 2)]).length, 1, "a word outside the moved node");
  });

  test("regenerating the worklist is idempotent: a done new node, a done moved site and an edited object site stay done", () => {
    const entries = [
      site("behavior.a.effects[0]", null, "eachOpponent", true),
      site("behavior.a.effects[0].player", "opponent", "eachOpponent", true, "behavior.a.effects[0].effects[0].player"),
      site("behavior.a.target", { type: "faction" }, "chosenOpponent", true),
      site("behavior.a.later", { type: "faction", controller: "any", conditions: [{ type: "x" }] }, "chosenOpponent", true),
      site("behavior.a.pick", null, "anyOneOpponent", true)
    ];
    const data = {
      a: {
        effects: [{ type: "forEachPlayer", players: "opponents", effects: [{ player: "opponent" }] }],
        target: { type: "faction", controller: "opponents" },
        later: { type: "faction", controller: "any", conditions: [{ type: "x", deeper: 1 }] }
      }
    };
    const once = run(data, entries);
    const twice = run(data, entries);
    assert.equal(renderWorklist(once.worklist), renderWorklist(twice.worklist));
    // The wrapper and the moved site are done; `target` changed its own keys (done); `later` only changed deeper (pending); `pick` is missing (pending).
    assert.deepEqual(pendingPaths(once), ["behavior.a.later", "behavior.a.pick"]);
    assert.deepEqual(once.invalid, []);
    assert.equal(once.worklist.sets.s!.pending.some((entry) => "snapshot" in entry), false, "no baseline fingerprints");
  });
});
