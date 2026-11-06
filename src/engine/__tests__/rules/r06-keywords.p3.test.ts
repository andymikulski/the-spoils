// Batch r06-keywords (docs/TESTING.md): CR 507.3 Covert.
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { buildGame, character, item, P1, P2, resolvePendingResponses, tactic } from "../support/fixtures.js";
import type { BuildGameOptions } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";

type Placement = NonNullable<BuildGameOptions["cards"]>[number];





/** Plays `cardId` for `playerId` and settles every response window. */
function playAndSettle(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, selected?: Record<string, CardInstanceId[]>): void {
  engine.perform({ type: "playCard", playerId, cardId, ...(selected ? { selected } : {}) });
  resolvePendingResponses(engine);
}

/** The attacker declares an attack on the other faction and the response windows settle, so blockers are next. */
function attackFaction(engine: SpoilsEngine, attacker: PlayerId, attackerIds: CardInstanceId[]): void {
  engine.perform({
    type: "declareAttack",
    playerId: attacker,
    attackerIds,
    target: { type: "faction", playerId: attacker === P1 ? P2 : P1 }
  });
  resolvePendingResponses(engine);
}

const COVERT = { keywords: ["covert" as const] };

describe("CR 507.3 — covert", () => {
  const twoSides = (attackerDefs: CardDefinition[], blockerDefs: CardDefinition[], attackerOwner: PlayerId = P1): { cards: Placement[] } => {
    const defender: PlayerId = attackerOwner === P1 ? P2 : P1;
    return {
      cards: [
        ...attackerDefs.map((def, i) => ({ key: `a${i}`, def, owner: attackerOwner })),
        ...blockerDefs.map((def, i) => ({ key: `b${i}`, def, owner: defender }))
      ]
    };
  };
  const covertDef = (name: string) => character({ name, behavior: COVERT });
  const plainDef = (name: string) => character({ name });

  const tryBlock = (engine: SpoilsEngine, blocker: PlayerId, ids: CardInstanceId[]) =>
    engine.perform({ type: "declareBlockers", playerId: blocker, blockerIds: ids });

  rule("CR 507.3a", "an attacking party of one covert character is a covert party: a non-covert character cannot block it", () => {
    const { engine, id } = buildGame(twoSides([covertDef("Sneak")], [plainDef("Guard"), covertDef("Shadow")]));
    attackFaction(engine, P1, [id("a0")]);
    refused(() => tryBlock(engine, P2, [id("b0")]), "non-covert blocker against a covert party", /covert/i);
    tryBlock(engine, P2, [id("b1")]);
    assert.ok(engine.state.battle?.blockingParty?.includes(id("b1")), "control: the covert character blocks it");
  });

  rule("CR 507.3a", "an attacking party in which every member has covert is a covert party (two members)", () => {
    const { engine, id } = buildGame(twoSides([covertDef("Sneak 1"), covertDef("Sneak 2")], [plainDef("Guard"), covertDef("Shadow")]));
    attackFaction(engine, P1, [id("a0"), id("a1")]);
    refused(() => tryBlock(engine, P2, [id("b0")]), "non-covert blocker against an all-covert party", /covert/i);
    tryBlock(engine, P2, [id("b1")]);
    assert.ok(engine.state.battle?.blockingParty?.includes(id("b1")), "control: the covert character blocks it");
  });

  rule("CR 507.3a", "a party with one non-covert member is not a covert party: any non-covert character may block it", () => {
    const { engine, id } = buildGame(twoSides([covertDef("Sneak"), plainDef("Brute")], [plainDef("Guard")]));
    attackFaction(engine, P1, [id("a0"), id("a1")]);
    tryBlock(engine, P2, [id("b0")]);
    assert.ok(engine.state.battle?.blockingParty?.includes(id("b0")), "the non-covert character blocked the mixed party");
  });

  rule("CR 507.3a", "the same holds with the players swapped: the second player's covert party can only be blocked by the first player's covert characters", () => {
    const { engine, id } = buildGame({
      activePlayerId: P2,
      ...twoSides([covertDef("Sneak")], [plainDef("Guard"), covertDef("Shadow")], P2)
    });
    attackFaction(engine, P2, [id("a0")]);
    refused(() => tryBlock(engine, P1, [id("b0")]), "player one's non-covert blocker", /covert/i);
    tryBlock(engine, P1, [id("b1")]);
    assert.ok(engine.state.battle?.blockingParty?.includes(id("b1")), "control: player one's covert character blocks");
  });

  rule("CR 507.3b", "only covert characters can block a covert party: a mixed blocking party is refused, an all-covert one is accepted", () => {
    const { engine, id } = buildGame(twoSides([covertDef("Sneak")], [covertDef("Shadow 1"), covertDef("Shadow 2"), plainDef("Guard")]));
    attackFaction(engine, P1, [id("a0")]);
    refused(() => tryBlock(engine, P2, [id("b0"), id("b2")]), "covert plus non-covert blockers against a covert party", /covert/i);
    tryBlock(engine, P2, [id("b0"), id("b1")]);
    assert.equal(engine.state.battle?.blockingParty?.length, 2, "control: two covert blockers are accepted");
  });

  rule("CR 507.3b", "a covert party may go unblocked: declaring no blockers is fine", () => {
    const { engine, id } = buildGame(twoSides([covertDef("Sneak")], [plainDef("Guard")]));
    attackFaction(engine, P1, [id("a0")]);
    tryBlock(engine, P2, []);
    assert.equal(engine.state.battle?.blockingParty?.length ?? 0, 0, "no blockers");
  });

  rule("CR 507.3c", "covert characters can only block covert parties: a covert character cannot block a non-covert party", () => {
    const { engine, id } = buildGame(twoSides([plainDef("Brute")], [covertDef("Shadow"), plainDef("Guard")]));
    attackFaction(engine, P1, [id("a0")]);
    refused(() => tryBlock(engine, P2, [id("b0")]), "covert blocker against a non-covert party", /covert/i);
    tryBlock(engine, P2, [id("b1")]);
    assert.ok(engine.state.battle?.blockingParty?.includes(id("b1")), "control: a non-covert character blocks it");
  });

  rule("CR 507.3c", "a covert character cannot block a mixed party (not a covert party)", () => {
    const { engine, id } = buildGame(twoSides([covertDef("Sneak"), plainDef("Brute")], [covertDef("Shadow")]));
    attackFaction(engine, P1, [id("a0"), id("a1")]);
    refused(() => tryBlock(engine, P2, [id("b0")]), "covert blocker against a mixed party", /covert/i);
  });

  rule("CR 507.3c", "a blocking party that includes a covert character is refused against a non-covert party even with non-covert company", () => {
    const { engine, id } = buildGame(twoSides([plainDef("Brute")], [covertDef("Shadow"), plainDef("Guard")]));
    attackFaction(engine, P1, [id("a0")]);
    refused(() => tryBlock(engine, P2, [id("b0"), id("b1")]), "covert and non-covert blockers against a non-covert party", /covert/i);
    tryBlock(engine, P2, [id("b1")]);
    assert.ok(engine.state.battle?.blockingParty?.includes(id("b1")), "control: the non-covert character alone blocks");
  });

  rule("CR 507.3d", "a character that gains covert is considered to have the covert keyword: as an attacker it makes a covert party", () => {
    const granter = tactic({
      name: "Shroud",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self" }, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "a0", def: plainDef("Brute"), owner: P1 },
        { key: "shroud", def: granter, owner: P1, zone: "hand" },
        { key: "b0", def: plainDef("Guard"), owner: P2 }
      ]
    });
    playAndSettle(engine, P1, id("shroud"), { t: [id("a0")] });
    assert.equal(engine.hasKeyword(id("a0"), "covert"), true, "it now has the keyword");
    attackFaction(engine, P1, [id("a0")]);
    refused(() => tryBlock(engine, P2, [id("b0")]), "non-covert blocker against a party that gained covert", /covert/i);
  });

  rule("CR 507.3d", "a character that gains covert counts as covert as a blocker too: it can then block a covert party and not a plain one", () => {
    const granter = tactic({
      name: "Shroud",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self" }, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const covertAttack = buildGame({
      activePlayerId: P2,
      cards: [
        { key: "a0", def: covertDef("Sneak"), owner: P2 },
        { key: "b0", def: plainDef("Guard"), owner: P1 },
        { key: "shroud", def: granter, owner: P1, zone: "hand" }
      ]
    });
    // The opponent attacks; the defender responds to the attack by giving the blocker covert, then blocks.
    covertAttack.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [covertAttack.id("a0")], target: { type: "faction", playerId: P1 } });
    covertAttack.engine.perform({ type: "passPriority", playerId: P2 });
    covertAttack.engine.perform({ type: "playCard", playerId: P1, cardId: covertAttack.id("shroud"), selected: { t: [covertAttack.id("b0")] } });
    resolvePendingResponses(covertAttack.engine);
    assert.equal(covertAttack.engine.hasKeyword(covertAttack.id("b0"), "covert"), true, "the blocker gained covert");
    covertAttack.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [covertAttack.id("b0")] });
    assert.ok(covertAttack.engine.state.battle?.blockingParty?.includes(covertAttack.id("b0")), "it blocks the covert party");
  });

  rule("CR 507.3d", "gaining covert through an attached card's rules text makes the host a covert attacker", () => {
    const cloak = item({
      name: "Cloak",
      attachTo: "character",
      behavior: { abilities: [{ id: "grant", type: "continuous", modifiers: [], keywords: [{ target: "attachedTo", keyword: "covert" }] }] }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "a0", def: plainDef("Brute"), owner: P1 },
        { key: "cloak", def: cloak, owner: P1, attachedToKey: "a0" },
        { key: "b0", def: plainDef("Guard"), owner: P2 },
        { key: "b1", def: covertDef("Shadow"), owner: P2 }
      ]
    });
    attackFaction(engine, P1, [id("a0")]);
    refused(() => tryBlock(engine, P2, [id("b0")]), "non-covert blocker against the cloaked attacker", /covert/i);
    tryBlock(engine, P2, [id("b1")]);
    assert.ok(engine.state.battle?.blockingParty?.includes(id("b1")), "control: a covert blocker is accepted");
  });

  rule("CR 507.3e", "a covert character that gains covert still has the keyword once: it is listed one time", () => {
    const granter = tactic({
      name: "Shroud",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self" }, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "a0", def: covertDef("Sneak"), owner: P1 },
        { key: "shroud", def: granter, owner: P1, zone: "hand" }
      ]
    });
    playAndSettle(engine, P1, id("shroud"), { t: [id("a0")] });
    assert.equal(engine.getKeywords(id("a0")).filter(k => k === "covert").length, 1, "exactly one instance of covert");
    assert.equal(engine.hasKeyword(id("a0"), "covert"), true);
  });

  rule("CR 507.3e", "the extra instance disappears: when the temporary grant ends the printed covert keyword remains", () => {
    const granter = tactic({
      name: "Shroud",
      behavior: {
        abilities: [
          {
            id: "a",
            type: "activated",
            targets: [{ id: "t", selector: { controller: "self" }, count: 1 }],
            effects: [{ type: "grantKeyword", target: { type: "selected", id: "t" }, keyword: "covert", duration: { type: "untilEndOfTurn" } }]
          }
        ]
      }
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "a0", def: covertDef("Sneak"), owner: P1 },
        { key: "shroud", def: granter, owner: P1, zone: "hand" }
      ]
    });
    playAndSettle(engine, P1, id("shroud"), { t: [id("a0")] });
    engine.perform({ type: "endTurn", playerId: P1 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.activePlayerId, P2, "the turn has passed");
    assert.equal(engine.hasKeyword(id("a0"), "covert"), true, "still covert through its printed keyword");
    assert.equal(engine.getKeywords(id("a0")).filter(k => k === "covert").length, 1, "still a single instance");
  });

  rule("CR 507.3e", "gaining covert from two sources at once leaves a single instance, and one covert blocker rule applies", () => {
    const lord = (name: string) =>
      character({ name, behavior: { abilities: [{ id: "aura", type: "continuous", modifiers: [], keywords: [{ selector: { controller: "self", type: "character", name: "Sneak" }, keyword: "covert" }] }] } });
    const { engine, id } = buildGame({
      cards: [
        { key: "lord1", def: lord("Lord 1"), owner: P1 },
        { key: "lord2", def: lord("Lord 2"), owner: P1 },
        { key: "a0", def: covertDef("Sneak"), owner: P1 },
        { key: "b0", def: plainDef("Guard"), owner: P2 }
      ]
    });
    assert.equal(engine.getKeywords(id("a0")).filter(k => k === "covert").length, 1, "one instance despite three sources");
    attackFaction(engine, P1, [id("a0")]);
    refused(() => tryBlock(engine, P2, [id("b0")]), "non-covert blocker against the covert attacker", /covert/i);
  });
});
