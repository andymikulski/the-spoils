// Batch r03-costs-effects, part 3 (docs/TESTING.md): CR 402 Effects. (CR 404 "Rule Not Found" is an empty section.)
// Written from the wording of the Comprehensive Rules, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { developPlay, settleTurnStart } from "../support/develop.js";

type AnyDef = CardDefinition;

const sel = (id: string) => ({ type: "selected", id });
const pickCharacter = [{ id: "t", selector: { type: "character" }, count: 1 }];

const playCard = (engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "playCard", playerId: player, cardId, ...extra } as never);
const activate = (engine: SpoilsEngine, player: string, cardId: string, abilityId = "go", extra: Record<string, unknown> = {}) =>
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, ...extra } as never);
const answer = (engine: SpoilsEngine, playerId: string, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);
const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;
const influence = (engine: SpoilsEngine, player = P1) => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player = P1) => engine.state.players[player].hand.length;
const pendingKind = (engine: SpoilsEngine) => engine.state.pendingChoice?.kind;
const pendingPlayer = (engine: SpoilsEngine) => engine.state.pendingChoice?.playerId;
const tokens = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.counters.token ?? 0;

/** `n` unattached resources owned by `owner`. */
const ready = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `r${owner}${i}`, def: resourceCard({ name: `R${owner}${i}` }), owner }));

/** `n` deck cards owned by `owner`. */
const deck = (n: number, owner = P1): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `d${owner}${i}`, def: character({ name: `D${owner}${i}` }), owner, zone: "deck" as const }));

/** A tactic whose play source (its first activated ability) has the given fields. */
function spell(name: string, ability: Record<string, unknown>, over: Partial<AnyDef> = {}): AnyDef {
  return tactic({ name, ...over, behavior: { abilities: [{ id: "go", type: "activated", effects: [], ...ability }] } as never });
}

/** A character with one activated ability `go`. */
function withAbility(name: string, ability: Record<string, unknown>, over: Partial<AnyDef> = {}): AnyDef {
  return character({
    name,
    strength: 2,
    life: 3,
    ...over,
    behavior: { abilities: [{ id: "go", type: "activated", effects: [], ...ability }] } as never
  });
}

/** A tactic that destroys the card picked for `t`. */
const destroyer = (name: string): AnyDef => spell(name, { targets: pickCharacter, effects: [{ type: "destroy", target: sel("t") }] });

/** A cost-less tactic with no effect: all that matters is that it is played. */
const blank = (name: string): AnyDef => tactic({ name });

function castAndResolve(engine: SpoilsEngine, player: string, cardId: string, extra: Record<string, unknown> = {}): void {
  playCard(engine, player, cardId, extra);
  resolvePendingResponses(engine);
}

/** P1 plays `opener`, then P2 plays `reply` into the response window; everything then resolves. */
function respond(engine: SpoilsEngine, opener: string, reply: string, openerExtra: Record<string, unknown> = {}, replyExtra: Record<string, unknown> = {}): void {
  playCard(engine, P1, opener, openerExtra);
  playCard(engine, P2, reply, replyExtra);
  resolvePendingResponses(engine);
}

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.1 — what an effect is", () => {
  rule("CR 402.1", "an effect is generated when a player follows an instruction in a card's rules text: playing the card does what the text says", () => {
    const ping = spell("Ping", { effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 3 }] });
    const { engine, id } = buildGame({ cards: [{ key: "ping", def: ping, owner: P1, zone: "hand" }] });
    const before = influence(engine, P2);
    playCard(engine, P1, id("ping"));
    assert.equal(influence(engine, P2), before, "nothing has happened before the instruction is followed");
    resolvePendingResponses(engine);
    assert.equal(influence(engine, P2), before - 3, "following the instruction generated the effect");
  });

  rule("CR 402.1", "a card with no instruction in its rules text generates no effect", () => {
    const { engine, id } = buildGame({ cards: [{ key: "blank", def: blank("Blank"), owner: P1, zone: "hand" }] });
    const before = [influence(engine, P1), influence(engine, P2)];
    castAndResolve(engine, P1, id("blank"));
    assert.deepEqual([influence(engine, P1), influence(engine, P2)], before, "no influence changed");
    assert.deepEqual([handOf(engine, P1), handOf(engine, P2)], [0, 0], "no card was drawn or discarded from a hand");
    assert.equal(zone(engine, id("blank")), "discard", "the tactic simply resolved");
  });

  rule("CR 402.1a", "the rules don't generate effects, only cards do: what the Develop Rule offers is the faction card's own text", () => {
    const drawOnly = buildGame({ cards: [{ key: "gem", def: resourceCard({ name: "Gem" }), owner: P1, zone: "hand" }] });
    const playGem = (engine: SpoilsEngine, gem: string) =>
      developPlay(engine, P1, gem);
    refused(() => playGem(drawOnly.engine, drawOnly.id("gem")), "a resource play its faction card's Develop Rule doesn't offer");
    const offers = buildGame({
      playerA: {
        faction: factionCard({
          faction: defaultFactionDefinition({
            turn: {
              restore: { detachResources: true, restoreNonResources: true },
              develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
            }
          })
        })
      },
      cards: [{ key: "gem", def: resourceCard({ name: "Gem" }), owner: P1, zone: "hand" }]
    });
    playGem(offers.engine, offers.id("gem"));
    assert.equal(zone(offers.engine, offers.id("gem")), "play", "the same play is made when the faction card's text offers it");
  });

  rule("CR 402.1a", "the rules don't generate effects, only cards do: what the Restore Rule restores is the faction card's own text", () => {
    const board = (restoreNonResources: boolean) => {
      const faction = factionCard({
        faction: defaultFactionDefinition({
          turn: { restore: { detachResources: true, restoreNonResources }, develop: { choices: [{ type: "draw", count: 1 }] } }
        })
      });
      const built = buildGame({ playerB: { faction }, cards: [{ key: "tired", def: character({ name: "Tired" }), owner: P2, depleted: true }] });
      built.engine.perform({ type: "endTurn", playerId: P1 } as never);
      resolvePendingResponses(built.engine);
      settleTurnStart(built.engine);
      assert.equal(built.engine.state.activePlayerId, P2, "control: P2's turn has started");
      return built.engine.state.cards[built.id("tired")]!.depleted;
    };
    assert.equal(board(true), false, "a faction card whose Restore Rule restores non-resources restores the character");
    assert.equal(board(false), true, "one whose Restore Rule doesn't leaves it depleted");
  });

  rule("CR 402.1b", "a cost can generate effects: a cost step that draws a card draws it when the card is played, before any response", () => {
    const src = withAbility("Src", { costs: [{ type: "effects", effects: [{ type: "draw", player: "controller", amount: 1 }] }] });
    const { engine, id } = buildGame({ cards: [{ key: "src", def: src, owner: P1 }, ...deck(2)] });
    activate(engine, P1, id("src"));
    assert.equal(handOf(engine), 1, "the effect of the cost happened at once");
    assert.ok(engine.state.responseWindow, "while the opponent may still respond");
  });

  rule("CR 402.1b", "an effect can generate a cost: a pay instruction inside an effect takes resources when it is followed", () => {
    const offer = withAbility("Offer", { effects: [{ type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 2 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] });
    const { engine, id } = buildGame({ cards: [{ key: "offer", def: offer, owner: P1 }, ...deck(2), ...ready(3)] });
    activate(engine, P1, id("offer"));
    resolvePendingResponses(engine);
    assert.equal(engine.getAvailableResourceCount(P1), 3, "nothing paid until the instruction is followed");
    answer(engine, P1, { kind: "mayPay", pay: true });
    resolvePendingResponses(engine);
    assert.equal(engine.getAvailableResourceCount(P1), 1, "two resources paid by the effect");
    assert.equal(handOf(engine), 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.2 — effects that instruct several players", () => {
  const chooseOne = { type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Ok", effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] }] };
  const everyone = (name: string) => spell(name, { effects: [{ type: "forEachPlayer", effects: [chooseOne] }] });

  rule("CR 402.2", "the active player acts first, then the other player: P1 active, P1 casts", () => {
    const { engine, id } = buildGame({ cards: [{ key: "all", def: everyone("All"), owner: P1, zone: "hand" }] });
    playCard(engine, P1, id("all"));
    resolvePendingResponses(engine);
    assert.equal(pendingKind(engine), "chooserSelectsOption");
    assert.equal(pendingPlayer(engine), P1, "the active player decides first");
    answer(engine, P1, { kind: "chooserSelectsOption", index: 0 });
    assert.equal(pendingKind(engine), "chooserSelectsOption", "then the other player");
    assert.equal(pendingPlayer(engine), P2);
    answer(engine, P2, { kind: "chooserSelectsOption", index: 0 });
    assert.equal(engine.state.pendingChoice, undefined, "both have acted");
    assert.equal(influence(engine, P1), 26, "the active player's instruction was followed");
    assert.equal(influence(engine, P2), 26, "and the other player's");
  });

  rule("CR 402.2", "the active player goes first even when the OTHER player cast the card: P2 responds, P1 is active, P1 still acts first", () => {
    const { engine, id } = buildGame({ cards: [{ key: "opener", def: blank("Opener"), owner: P1, zone: "hand" }, { key: "all", def: everyone("All"), owner: P2, zone: "hand" }] });
    playCard(engine, P1, id("opener"));
    playCard(engine, P2, id("all"));
    resolvePendingResponses(engine);
    assert.equal(pendingKind(engine), "chooserSelectsOption");
    assert.equal(pendingPlayer(engine), P1, "the caster is P2 but the active player P1 acts first");
    answer(engine, P1, { kind: "chooserSelectsOption", index: 0 });
    assert.equal(pendingPlayer(engine), P2, "then P2");
  });

  rule("CR 402.2", "when the other player is the active player the order flips: P2 active, P1 casts in response, P2 acts first", () => {
    const { engine, id } = buildGame({
      turn: 2,
      activePlayerId: P2,
      cards: [{ key: "opener", def: blank("Opener"), owner: P2, zone: "hand" }, { key: "all", def: everyone("All"), owner: P1, zone: "hand" }]
    });
    playCard(engine, P2, id("opener"));
    playCard(engine, P1, id("all"));
    resolvePendingResponses(engine);
    assert.equal(pendingPlayer(engine), P2, "P2 is the active player and goes first");
    answer(engine, P2, { kind: "chooserSelectsOption", index: 0 });
    assert.equal(pendingPlayer(engine), P1, "then P1");
  });

  rule("CR 402.2", "an offer made to every player is made to the active player first", () => {
    const offer = spell("Offer", { effects: [{ type: "anyPlayerMayPay", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] });
    const { engine, id } = buildGame({
      cards: [{ key: "opener", def: blank("Opener"), owner: P1, zone: "hand" }, { key: "offer", def: offer, owner: P2, zone: "hand" }, ...ready(2, P1), ...ready(2, P2), ...deck(2, P1), ...deck(2, P2)]
    });
    playCard(engine, P1, id("opener"));
    playCard(engine, P2, id("offer"));
    resolvePendingResponses(engine);
    assert.equal(pendingKind(engine), "anyPlayerMayPay");
    assert.equal(pendingPlayer(engine), P1, "the active player is asked first, though P2 cast the card");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.3 — the default game area is in play", () => {
  const damageTactic = spell("Damage", { targets: pickCharacter, effects: [{ type: "dealDamage", target: sel("t"), amount: 1 }] });

  rule(["CR 402.3", "CR 402.3a"], "'pick a character' with no area named can pick a character in play but not one in hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "dmg", def: damageTactic, owner: P1, zone: "hand" },
        { key: "inPlay", def: character({ name: "In Play", life: 5 }), owner: P2 },
        { key: "inHand", def: character({ name: "In Hand", life: 5 }), owner: P2, zone: "hand" }
      ]
    });
    refused(() => playCard(engine, P1, id("dmg"), { selected: { t: [id("inHand")] } }), "picking a character in a hand with no area named", /Illegal target/);
    assert.equal(zone(engine, id("dmg")), "hand", "the refused play changed nothing");
    castAndResolve(engine, P1, id("dmg"), { selected: { t: [id("inPlay")] } });
    assert.equal(engine.state.cards[id("inPlay")]!.damage, 1, "control: the character in play was picked");
  });

  rule(["CR 402.3", "CR 402.3a"], "a character in the discard pile, in the deck or in the void cannot be picked either", () => {
    for (const where of ["discard", "deck", "void"] as const) {
      const { engine, id } = buildGame({
        cards: [
          { key: "dmg", def: damageTactic, owner: P1, zone: "hand" },
          { key: "away", def: character({ name: "Away", life: 5 }), owner: P2, zone: where }
        ]
      });
      refused(() => playCard(engine, P1, id("dmg"), { selected: { t: [id("away")] } }), `picking a character in the ${where} pile with no area named`, /Illegal target/);
    }
  });

  rule(["CR 402.3", "CR 402.3a"], "the candidates the engine offers for an unspecified area are the cards in play only", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "dmg", def: damageTactic, owner: P1, zone: "hand" },
        { key: "a", def: character({ name: "A" }), owner: P2 },
        { key: "b", def: character({ name: "B" }), owner: P1 },
        { key: "hand", def: character({ name: "Hand" }), owner: P2, zone: "hand" },
        { key: "pile", def: character({ name: "Pile" }), owner: P2, zone: "discard" }
      ]
    });
    const offered = engine.getPickCandidates({ type: "playCard", playerId: P1, cardId: id("dmg") } as never, "t");
    assert.deepEqual([...offered].sort(), [id("a"), id("b")].sort(), "only the two characters in play");
  });

  rule("CR 402.3", "an effect that affects 'all characters' with no area named affects only those in play", () => {
    const mark = spell("Mark", { effects: [{ type: "forEach", selector: { type: "character" }, effects: [{ type: "addCounter", target: sel("__candidate"), counter: "token", amount: 1 }] }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "mark", def: mark, owner: P1, zone: "hand" },
        { key: "play", def: character({ name: "Play" }), owner: P2 },
        { key: "hand", def: character({ name: "Hand" }), owner: P2, zone: "hand" },
        { key: "pile", def: character({ name: "Pile" }), owner: P1, zone: "discard" },
        { key: "deck", def: character({ name: "Deck" }), owner: P1, zone: "deck" }
      ]
    });
    castAndResolve(engine, P1, id("mark"));
    assert.equal(tokens(engine, id("play")), 1, "the character in play was marked");
    assert.equal(tokens(engine, id("hand")), 0, "not the one in hand");
    assert.equal(tokens(engine, id("pile")), 0, "not the one in the discard pile");
    assert.equal(tokens(engine, id("deck")), 0, "not the one in the deck");
  });

  rule("CR 402.3", "a card that does name its area affects that area (control: zone hand reaches a hand card)", () => {
    const mark = spell("Mark", { effects: [{ type: "forEach", selector: { type: "character", zone: "hand", owner: "opponent" }, effects: [{ type: "moveCard", target: sel("__candidate"), to: "discard" }] }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "mark", def: mark, owner: P1, zone: "hand" },
        { key: "play", def: character({ name: "Play" }), owner: P2 },
        { key: "hand", def: character({ name: "Hand" }), owner: P2, zone: "hand" }
      ]
    });
    castAndResolve(engine, P1, id("mark"));
    assert.equal(zone(engine, id("hand")), "discard", "the named area was affected");
    assert.equal(zone(engine, id("play")), "play", "and only it");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.4 — an effect loses track of a card that changes area", () => {
  const bounce = spell("Bounce", { targets: pickCharacter, effects: [{ type: "moveCard", target: sel("t"), to: "hand" }] });

  rule("CR 402.4", "Example: an effect would put a character into your hand from play, it is destroyed in response, and it does not go to the hand from the discard pile", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "bounce", def: bounce, owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" },
        { key: "hero", def: character({ name: "Hero" }), owner: P1 }
      ]
    });
    respond(engine, id("bounce"), id("kill"), { selected: { t: [id("hero")] } }, { selected: { t: [id("hero")] } });
    assert.equal(zone(engine, id("hero")), "discard", "destroyed in response, and it stays in the discard pile");
    assert.ok(!engine.state.players[P1].hand.includes(id("hero")), "the bounce did not follow it into the pile and fetch it");
  });

  rule("CR 402.4", "control for the Example: with no response the same effect does put the character into the hand", () => {
    const { engine, id } = buildGame({ cards: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }, { key: "hero", def: character({ name: "Hero" }), owner: P1 }] });
    castAndResolve(engine, P1, id("bounce"), { selected: { t: [id("hero")] } });
    assert.equal(zone(engine, id("hero")), "hand");
  });

  rule("CR 402.4", "a card that left play and came back is not the card the effect was going to affect: damage aimed at it does not land", () => {
    // P1 aims 2 damage at P2's hero; P2 returns it to hand in response (bounce), so the pending damage cannot reach it.
    const hit = spell("Hit", { targets: pickCharacter, effects: [{ type: "dealDamage", target: sel("t"), amount: 2 }] });
    const save = spell("Save", { targets: pickCharacter, effects: [{ type: "moveCard", target: sel("t"), to: "hand" }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "hit", def: hit, owner: P1, zone: "hand" },
        { key: "save", def: save, owner: P2, zone: "hand" },
        { key: "hero", def: character({ name: "Hero", life: 5 }), owner: P2 }
      ]
    });
    respond(engine, id("hit"), id("save"), { selected: { t: [id("hero")] } }, { selected: { t: [id("hero")] } });
    assert.equal(zone(engine, id("hero")), "hand", "saved to its owner's hand");
    assert.equal(engine.state.cards[id("hero")]!.damage, 0, "the pending damage did not follow it");
  });

  rule("CR 402.4", "a card that moves to another area is also lost by an effect that was going to destroy it", () => {
    // P1 destroys the hero; P2 puts the hero into its hand in response; the destroy does not pull it back out of the hand.
    const save = spell("Save", { targets: pickCharacter, effects: [{ type: "moveCard", target: sel("t"), to: "hand" }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" },
        { key: "save", def: save, owner: P2, zone: "hand" },
        { key: "hero", def: character({ name: "Hero" }), owner: P2 }
      ]
    });
    respond(engine, id("kill"), id("save"), { selected: { t: [id("hero")] } }, { selected: { t: [id("hero")] } });
    assert.equal(zone(engine, id("hero")), "hand", "still in the hand, not destroyed");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.5 — doing as much as you can", () => {
  rule("CR 402.5", "an instruction that cannot be followed is ignored and the rest is done: damage to a target that left, then a draw", () => {
    const strike = spell("Strike", {
      targets: pickCharacter,
      effects: [{ type: "dealDamage", target: sel("t"), amount: 2 }, { type: "draw", player: "controller", amount: 1 }]
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "strike", def: strike, owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" },
        { key: "hero", def: character({ name: "Hero", life: 5 }), owner: P2 },
        ...deck(2)
      ]
    });
    respond(engine, id("strike"), id("kill"), { selected: { t: [id("hero")] } }, { selected: { t: [id("hero")] } });
    assert.equal(zone(engine, id("hero")), "discard");
    assert.equal(handOf(engine), 1, "the draw was still followed");
  });

  rule("CR 402.5", "with two picked cards and one gone, the instruction is followed for the one that remains", () => {
    const sweep = spell("Sweep", {
      targets: [{ id: "t", selector: { type: "character", owner: "opponent" }, count: 2 }],
      effects: [{ type: "forEach", selected: "t", effects: [{ type: "dealDamage", target: sel("__candidate"), amount: 2 }] }]
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "sweep", def: sweep, owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" },
        { key: "a", def: character({ name: "A", life: 5 }), owner: P2 },
        { key: "b", def: character({ name: "B", life: 5 }), owner: P2 }
      ]
    });
    respond(engine, id("sweep"), id("kill"), { selected: { t: [id("a"), id("b")] } }, { selected: { t: [id("a")] } });
    assert.equal(zone(engine, id("a")), "discard", "A was destroyed in response");
    assert.equal(engine.state.cards[id("b")]!.damage, 2, "B was still dealt the damage");
  });

  rule("CR 402.5", "drawing more cards than the deck has draws what is there", () => {
    const draw3 = spell("Draw Three", { effects: [{ type: "draw", player: "controller", amount: 3 }] });
    const { engine, id } = buildGame({ cards: [{ key: "d3", def: draw3, owner: P1, zone: "hand" }, ...deck(2)] });
    castAndResolve(engine, P1, id("d3"));
    assert.equal(handOf(engine), 2, "both available cards were drawn");
  });

  rule("CR 402.5", "an influence loss larger than the faction has takes what it can and ignores the rest", () => {
    const drain = spell("Drain", { effects: [{ type: "modifyInfluence", player: "opponent", amount: -9 }, { type: "draw", player: "controller", amount: 1 }] });
    const { engine, id } = buildGame({ playerB: { influence: 4 }, cards: [{ key: "drain", def: drain, owner: P1, zone: "hand" }, ...deck(1)] });
    castAndResolve(engine, P1, id("drain"));
    assert.equal(influence(engine, P2), 0, "all 4 influence lost, not -5");
    assert.equal(handOf(engine), 1, "and the next instruction was followed");
  });

  rule("CR 402.5a", "effects never fizzle: a tactic whose only picked target left play still resolves its other instructions", () => {
    const strike = spell("Strike", {
      targets: pickCharacter,
      effects: [{ type: "dealDamage", target: sel("t"), amount: 2 }, { type: "modifyInfluence", player: "controller", amount: 5 }]
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "strike", def: strike, owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" },
        { key: "hero", def: character({ name: "Hero", life: 5 }), owner: P2 }
      ]
    });
    const before = influence(engine);
    respond(engine, id("strike"), id("kill"), { selected: { t: [id("hero")] } }, { selected: { t: [id("hero")] } });
    assert.equal(influence(engine), before + 5, "the effect was not countered because its target left play");
    assert.equal(zone(engine, id("strike")), "discard", "and the tactic resolved normally");
  });

  rule("CR 402.5a", "an ability whose target left play before it resolves also still resolves", () => {
    const src = withAbility("Src", {
      targets: pickCharacter,
      effects: [{ type: "dealDamage", target: sel("t"), amount: 2 }, { type: "modifyInfluence", player: "controller", amount: 3 }]
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "src", def: src, owner: P1 },
        { key: "kill", def: destroyer("Kill"), owner: P2, zone: "hand" },
        { key: "hero", def: character({ name: "Hero", life: 5 }), owner: P2 }
      ]
    });
    const before = influence(engine);
    activate(engine, P1, id("src"), "go", { selected: { t: [id("hero")] } });
    playCard(engine, P2, id("kill"), { selected: { t: [id("hero")] } });
    resolvePendingResponses(engine);
    assert.equal(influence(engine), before + 3);
  });

  const askAndDraw = (declined: boolean) => {
    const mayDraw = spell("May Draw", {
      effects: [
        { type: "mayPay", player: "controller", costs: [{ type: "payResources", amount: 1 }], effects: [{ type: "draw", player: "controller", amount: 1 }] },
        { type: "modifyInfluence", player: "controller", amount: 2 }
      ]
    });
    const { engine, id } = buildGame({ cards: [{ key: "may", def: mayDraw, owner: P1, zone: "hand" }, ...deck(2), ...ready(2)] });
    const before = influence(engine);
    castAndResolve(engine, P1, id("may"));
    answer(engine, P1, { kind: "mayPay", pay: !declined });
    resolvePendingResponses(engine);
    return { engine, gained: influence(engine) - before };
  };

  rule("CR 402.5b", "an instruction that depends on a skipped one cannot be followed: a declined 'you may pay, if you do draw' draws nothing", () => {
    const declined = askAndDraw(true);
    assert.equal(handOf(declined.engine), 0, "no draw: the pay it depends on was not made");
    assert.equal(declined.engine.getAvailableResourceCount(P1), 2, "nothing was paid");
  });

  rule("CR 402.5b", "an instruction that does not depend on the skipped one is still followed", () => {
    const declined = askAndDraw(true);
    assert.equal(declined.gained, 2, "the independent instruction after it still happened");
  });

  rule("CR 402.5b", "the dependent instruction is followed when the earlier one was (control)", () => {
    const accepted = askAndDraw(false);
    assert.equal(handOf(accepted.engine), 1, "paid, so the draw happened");
    assert.equal(accepted.engine.getAvailableResourceCount(P1), 1);
    assert.equal(accepted.gained, 2);
  });

  rule("CR 402.5b", "an instruction that depends on a pick that could not be made is not followed (no legal pick, so nothing to act on)", () => {
    const pickThenAct = spell("Pick Then Act", {
      effects: [
        {
          type: "chooserSelectsTarget",
          chooser: "controller",
          declaration: { id: "p", selector: { type: "character", owner: "opponent" }, count: 1 },
          effects: [{ type: "modifyInfluence", player: "controller", amount: 7 }]
        }
      ]
    });
    const { engine, id } = buildGame({ cards: [{ key: "pa", def: pickThenAct, owner: P1, zone: "hand" }] });
    const before = influence(engine);
    castAndResolve(engine, P1, id("pa"));
    assert.equal(engine.state.pendingChoice, undefined, "no prompt for a pick with no candidate");
    assert.equal(influence(engine), before, "the instruction that depends on the pick was not followed");
  });

  rule("CR 402.5b", "an instruction that depends on a replaced one is not followed: 'destroy it, if you do ...' when the destruction is prevented does nothing more", () => {
    // The destroy effect is a no-op while destruction is restricted; the check that it was destroyed then fails.
    const lock = spell("Lock", { effects: [{ type: "restrictDestruction", duration: { type: "untilEndOfTurn" } }] });
    const kill = spell("Kill And Draw", {
      targets: pickCharacter,
      effects: [
        { type: "destroy", target: sel("t") },
        { type: "if", condition: { type: "targetInZone", target: sel("t"), zone: "discard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    });
    const run = (locked: boolean) => {
      const { engine, id } = buildGame({
        cards: [
          { key: "lock", def: lock, owner: P1, zone: "hand" },
          { key: "kill", def: kill, owner: P1, zone: "hand" },
          { key: "hero", def: character({ name: "Hero" }), owner: P2 },
          ...deck(2)
        ]
      });
      if (locked) castAndResolve(engine, P1, id("lock"));
      const handBefore = handOf(engine) - 1; // the Kill And Draw card itself leaves the hand when played
      castAndResolve(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
      return { drawn: handOf(engine) - handBefore, hero: zone(engine, id("hero")) };
    };
    const open = run(false);
    assert.deepEqual(open, { drawn: 1, hero: "discard" }, "control: destroyed, so the dependent draw happened");
    const closed = run(true);
    assert.equal(closed.hero, "play", "destruction was prevented");
    assert.equal(closed.drawn, 0, "so the instruction that depends on it was not followed");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.6 — lose beats gain", () => {
  const grant = (keyword: string) =>
    spell(`Grant ${keyword}`, { targets: pickCharacter, effects: [{ type: "grantKeyword", target: sel("t"), keyword, duration: { type: "untilEndOfTurn" } }] });
  const suppress = (keyword: string) =>
    spell(`Suppress ${keyword}`, { targets: pickCharacter, effects: [{ type: "suppressKeyword", target: sel("t"), keyword, duration: { type: "untilEndOfTurn" } }] });
  const board = (extra: CardPlacement[] = [], hero: AnyDef = character({ name: "Hero" })) =>
    buildGame({
      cards: [
        { key: "hero", def: hero, owner: P1 },
        { key: "grant", def: grant("covert"), owner: P1, zone: "hand" },
        { key: "lose", def: suppress("covert"), owner: P1, zone: "hand" },
        ...extra
      ]
    });

  rule("CR 402.6", "control: a card that is granted covert has it", () => {
    const { engine, id } = board();
    castAndResolve(engine, P1, id("grant"), { selected: { t: [id("hero")] } });
    assert.equal(engine.hasKeyword(id("hero"), "covert"), true);
  });

  rule("CR 402.6", "a card that gains covert from one effect and loses it from another does not have it: gain applied first", () => {
    const { engine, id } = board();
    castAndResolve(engine, P1, id("grant"), { selected: { t: [id("hero")] } });
    castAndResolve(engine, P1, id("lose"), { selected: { t: [id("hero")] } });
    assert.equal(engine.hasKeyword(id("hero"), "covert"), false, "the lose effect takes precedence");
  });

  rule("CR 402.6", "a card that gains covert from one effect and loses it from another does not have it: lose applied first", () => {
    const { engine, id } = board();
    castAndResolve(engine, P1, id("lose"), { selected: { t: [id("hero")] } });
    castAndResolve(engine, P1, id("grant"), { selected: { t: [id("hero")] } });
    assert.equal(engine.hasKeyword(id("hero"), "covert"), false, "the order does not matter: the lose effect takes precedence");
  });

  rule("CR 402.6", "a keyword the card printed is lost to a later 'loses' effect too", () => {
    const { engine, id } = board([], character({ name: "Hero", behavior: { keywords: ["covert"] } as never }));
    assert.equal(engine.hasKeyword(id("hero"), "covert"), true, "control: printed covert");
    castAndResolve(engine, P1, id("lose"), { selected: { t: [id("hero")] } });
    assert.equal(engine.hasKeyword(id("hero"), "covert"), false);
  });

  rule("CR 402.6", "an ongoing gain from another card in play is overridden by a lose effect, in either order", () => {
    const lord = character({
      name: "Lord",
      behavior: { abilities: [{ id: "aura", type: "continuous", modifiers: [], keywords: [{ selector: { type: "character", controller: "self" }, keyword: "covert" }] }] } as never
    });
    const { engine, id } = board([{ key: "lord", def: lord, owner: P1 }]);
    assert.equal(engine.hasKeyword(id("hero"), "covert"), true, "control: the ongoing effect grants covert");
    castAndResolve(engine, P1, id("lose"), { selected: { t: [id("hero")] } });
    assert.equal(engine.hasKeyword(id("hero"), "covert"), false, "the lose effect takes precedence");
  });

  rule("CR 402.6", "only the card that loses the keyword loses it: another card granted the same keyword keeps it", () => {
    const { engine, id } = board([{ key: "other", def: character({ name: "Other" }), owner: P1 }]);
    castAndResolve(engine, P1, id("grant"), { selected: { t: [id("hero")] } });
    castAndResolve(engine, P1, id("lose"), { selected: { t: [id("hero")] } });
    const second = buildGame({
      cards: [
        { key: "other", def: character({ name: "Other" }), owner: P1 },
        { key: "grant", def: grant("covert"), owner: P1, zone: "hand" }
      ]
    });
    castAndResolve(second.engine, P1, second.id("grant"), { selected: { t: [second.id("other")] } });
    assert.equal(second.engine.hasKeyword(second.id("other"), "covert"), true, "an unaffected card keeps what it gained");
    assert.equal(engine.hasKeyword(id("other"), "covert"), false, "and a card never granted it does not have it");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.7 — cannot beats can", () => {
  const grantAggro = spell("Grant Aggro", { targets: pickCharacter, effects: [{ type: "grantKeyword", target: sel("t"), keyword: "aggro", duration: { type: "untilEndOfTurn" } }] });
  const forbid = spell("Forbid", { targets: pickCharacter, effects: [{ type: "grantRestriction", target: sel("t"), restriction: "cannotAttack", duration: { type: "untilEndOfTurn" } }] });
  const board = () =>
    buildGame({
      cards: [
        { key: "hero", def: character({ name: "Hero" }), owner: P1, attackEligible: false },
        { key: "aggro", def: grantAggro, owner: P1, zone: "hand" },
        { key: "forbid", def: forbid, owner: P1, zone: "hand" }
      ]
    });
  const attack = (engine: SpoilsEngine, heroId: string) =>
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [heroId], target: { type: "faction" } } as never);

  rule("CR 402.7", "control: a character that did not start the turn in play cannot attack, and one granted aggro can", () => {
    const plain = board();
    refused(() => attack(plain.engine, plain.id("hero")), "a character that entered this turn attacking", /attack|turn|eligible|cannot/i);
    const granted = board();
    castAndResolve(granted.engine, P1, granted.id("aggro"), { selected: { t: [granted.id("hero")] } });
    attack(granted.engine, granted.id("hero"));
    assert.ok(granted.engine.state.battle, "a battle began");
  });

  rule("CR 402.7", "an effect that says it can attack (aggro) loses to one that says it cannot: forbid applied after", () => {
    const { engine, id } = board();
    castAndResolve(engine, P1, id("aggro"), { selected: { t: [id("hero")] } });
    castAndResolve(engine, P1, id("forbid"), { selected: { t: [id("hero")] } });
    refused(() => attack(engine, id("hero")), "attacking while one effect lets it and another forbids it", /attack|cannot|restrict/i);
    assert.equal(engine.state.battle, undefined);
  });

  rule("CR 402.7", "an effect that says it can attack (aggro) loses to one that says it cannot: forbid applied first", () => {
    const { engine, id } = board();
    castAndResolve(engine, P1, id("forbid"), { selected: { t: [id("hero")] } });
    castAndResolve(engine, P1, id("aggro"), { selected: { t: [id("hero")] } });
    refused(() => attack(engine, id("hero")), "attacking while one effect lets it and another forbids it", /attack|cannot|restrict/i);
    assert.equal(engine.state.battle, undefined);
  });

  rule("CR 402.7", "'cannot' also beats a 'can' that lets a card be played: a tactical character cannot be deployed in a response while characters cannot be played", () => {
    const noChars = spell("No Characters", { effects: [{ type: "restrictPlay", player: "controller", kind: "cardType", cardType: "character", duration: { type: "untilEndOfTurn" } }] });
    const quick = character({ name: "Quick", behavior: { keywords: ["tactical"] } as never });
    const game = () =>
      buildGame({
        turn: 2,
        activePlayerId: P2,
        cards: [
          { key: "ban", def: noChars, owner: P1, zone: "hand" },
          { key: "quick", def: quick, owner: P1, zone: "hand" },
          { key: "opener", def: blank("Opener"), owner: P2, zone: "hand" }
        ]
      });
    const control = game();
    playCard(control.engine, P2, control.id("opener"));
    playCard(control.engine, P1, control.id("quick"));
    assert.ok(control.engine.state.responseStack.some(item => item.sourceId === control.id("quick")), "control: tactical lets it be deployed in a response");
    const { engine, id } = game();
    playCard(engine, P2, id("opener"));
    playCard(engine, P1, id("ban"));
    engine.perform({ type: "passPriority", playerId: P2 } as never);
    engine.perform({ type: "advanceFlow" } as never);
    assert.equal(zone(engine, id("ban")), "discard", "setup: the ban resolved");
    refused(() => playCard(engine, P1, id("quick")), "deploying a character in a response while characters cannot be played", /deploy|play|character|cannot|right now/i);
    assert.equal(zone(engine, id("quick")), "hand");
  });

  rule("CR 402.7a", "being able to destroy is not being told to: with 'cannot be destroyed' in effect a destroy effect is ignored", () => {
    const lock = spell("Lock", { effects: [{ type: "restrictDestruction", duration: { type: "untilEndOfTurn" } }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "lock", def: lock, owner: P1, zone: "hand" },
        { key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" },
        { key: "hero", def: character({ name: "Hero" }), owner: P2 }
      ]
    });
    castAndResolve(engine, P1, id("lock"));
    castAndResolve(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
    assert.equal(zone(engine, id("hero")), "play", "the destroy effect was ignored");
    assert.equal(zone(engine, id("kill")), "discard", "and the tactic still resolved (it is not refused)");
  });

  rule("CR 402.7a", "the same destroy effect works when nothing forbids it (control)", () => {
    const { engine, id } = buildGame({ cards: [{ key: "kill", def: destroyer("Kill"), owner: P1, zone: "hand" }, { key: "hero", def: character({ name: "Hero" }), owner: P2 }] });
    castAndResolve(engine, P1, id("kill"), { selected: { t: [id("hero")] } });
    assert.equal(zone(engine, id("hero")), "discard");
  });

  rule("CR 402.7a", "'cannot be destroyed' stops only the destroy instruction: other instructions of the same card still happen", () => {
    const lock = spell("Lock", { effects: [{ type: "restrictDestruction", duration: { type: "untilEndOfTurn" } }] });
    const both = spell("Both", { targets: pickCharacter, effects: [{ type: "destroy", target: sel("t") }, { type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "lock", def: lock, owner: P1, zone: "hand" },
        { key: "both", def: both, owner: P1, zone: "hand" },
        { key: "hero", def: character({ name: "Hero" }), owner: P2 }
      ]
    });
    const before = influence(engine, P2);
    castAndResolve(engine, P1, id("lock"));
    castAndResolve(engine, P1, id("both"), { selected: { t: [id("hero")] } });
    assert.equal(zone(engine, id("hero")), "play");
    assert.equal(influence(engine, P2), before - 2, "the damage instruction was still followed");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.8 — putting a card into play is not deploying it", () => {
  /** A watcher that counts, on itself, each character that is deployed ("cardPlayed") or enters play ("cardEnteredPlay"). */
  const watcher = (event: "cardPlayed" | "cardEnteredPlay") =>
    character({
      name: `Watcher ${event}`,
      behavior: {
        abilities: [
          {
            id: "w",
            type: "triggered",
            event,
            condition: { type: "cardTypeIs", target: "eventCard", cardType: "character" },
            effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }]
          }
        ]
      } as never
    });
  const revive = spell("Revive", {
    targets: [{ id: "t", selector: { type: "character", zone: "discard", owner: "self" }, count: 1 }],
    effects: [{ type: "putIntoPlay", target: sel("t"), controller: "controller" }]
  });
  const board = () =>
    buildGame({
      cards: [
        { key: "deployed", def: watcher("cardPlayed"), owner: P1 },
        { key: "entered", def: watcher("cardEnteredPlay"), owner: P1 },
        { key: "revive", def: revive, owner: P1, zone: "hand" },
        { key: "walker", def: character({ name: "Walker" }), owner: P1, zone: "hand" },
        { key: "dead", def: character({ name: "Dead" }), owner: P1, zone: "discard" }
      ]
    });

  rule("CR 402.8", "control: deploying a character from hand fires both the 'deployed' trigger and the 'enters play' trigger", () => {
    const { engine, id } = board();
    castAndResolve(engine, P1, id("walker"));
    assert.equal(zone(engine, id("walker")), "play");
    assert.equal(tokens(engine, id("deployed")), 1, "deploy trigger fired");
    assert.equal(tokens(engine, id("entered")), 1, "enters-play trigger fired");
  });

  rule(["CR 402.8", "CR 402.8a"], "an effect that puts a card into play is not deploying it: the character enters play but the 'deployed' trigger does not fire", () => {
    const { engine, id } = board();
    castAndResolve(engine, P1, id("revive"), { selected: { t: [id("dead")] } });
    assert.equal(zone(engine, id("dead")), "play", "put into play");
    assert.equal(tokens(engine, id("deployed")), 0, "anything that triggers when a card is deployed did not trigger");
    assert.equal(tokens(engine, id("entered")), 1, "while the enters-play trigger did");
  });

  rule("CR 402.8a", "the deployed-count of the turn is not raised by putting a card into play", () => {
    const { engine, id } = board();
    castAndResolve(engine, P1, id("walker"));
    castAndResolve(engine, P1, id("revive"), { selected: { t: [id("dead")] } });
    const playedEvents = (key: string) => engine.getLog().filter(entry => entry.event?.type === "cardPlayed" && (entry.event as { cardId?: string }).cardId === id(key));
    assert.equal(playedEvents("walker").length, 1, "control: a deployed card is recorded as played");
    assert.equal(playedEvents("dead").length, 0, "no 'card played' event was recorded for the card that was put into play");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("CR 402.9 — factions are not affected by effects unless they say so", () => {
  const forEachCard = (selector: Record<string, unknown>, effect: Record<string, unknown>) =>
    spell("Sweep", { effects: [{ type: "forEach", selector, effects: [effect] }] });
  const deplete = { type: "deplete", target: sel("__candidate") };

  rule("CR 402.9", "an effect on 'every card in play' does not touch a faction, but does touch the other cards in play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sweep", def: forEachCard({}, deplete), owner: P1, zone: "hand" },
        { key: "mine", def: character({ name: "Mine" }), owner: P1 },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 }
      ]
    });
    castAndResolve(engine, P1, id("sweep"));
    assert.equal(engine.state.cards[id("mine")]!.depleted, true, "my character was depleted");
    assert.equal(engine.state.cards[id("theirs")]!.depleted, true, "their character was depleted");
    for (const player of [P1, P2]) {
      assert.equal(engine.state.cards[engine.state.players[player].factionId!]!.depleted, false, `${player}'s faction was not affected`);
    }
  });

  rule("CR 402.9", "an effect that specifically says it applies to factions does affect them", () => {
    const { engine, id } = buildGame({ cards: [{ key: "sweep", def: forEachCard({ type: "faction" }, deplete), owner: P1, zone: "hand" }] });
    castAndResolve(engine, P1, id("sweep"));
    for (const player of [P1, P2]) {
      assert.equal(engine.state.cards[engine.state.players[player].factionId!]!.depleted, true, `${player}'s faction was depleted by the effect that names factions`);
    }
  });

  rule("CR 402.9", "a pick that does not name factions cannot pick one, a pick that names them can", () => {
    const pickAnything = spell("Pick Anything", { targets: [{ id: "t", selector: {}, count: 1 }], effects: [{ type: "deplete", target: sel("t") }] });
    const pickFaction = spell("Pick Faction", { targets: [{ id: "t", selector: { type: "faction" }, count: 1 }], effects: [{ type: "deplete", target: sel("t") }] });
    const { engine, id } = buildGame({
      cards: [
        { key: "any", def: pickAnything, owner: P1, zone: "hand" },
        { key: "fac", def: pickFaction, owner: P1, zone: "hand" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 }
      ]
    });
    const theirFaction = engine.state.players[P2].factionId!;
    refused(() => playCard(engine, P1, id("any"), { selected: { t: [theirFaction] } }), "picking a faction with a selector that matches any card", /Illegal target/);
    castAndResolve(engine, P1, id("any"), { selected: { t: [id("theirs")] } });
    assert.equal(engine.state.cards[id("theirs")]!.depleted, true, "control: the same selector picks an ordinary card");
    castAndResolve(engine, P1, id("fac"), { selected: { t: [theirFaction] } });
    assert.equal(engine.state.cards[theirFaction]!.depleted, true, "a selector that names factions picks the faction");
  });

  rule("CR 402.9", "an effect on all cards owned by the opponent does not reach their faction card", () => {
    const addToken = { type: "addCounter", target: sel("__candidate"), counter: "token", amount: 1 };
    const { engine, id } = buildGame({
      cards: [
        { key: "sweep", def: forEachCard({ owner: "opponent" }, addToken), owner: P1, zone: "hand" },
        { key: "theirs", def: character({ name: "Theirs" }), owner: P2 }
      ]
    });
    castAndResolve(engine, P1, id("sweep"));
    assert.equal(tokens(engine, id("theirs")), 1, "their character was affected");
    assert.equal(tokens(engine, engine.state.players[P2].factionId!), 0, "their faction was not");
  });
});
