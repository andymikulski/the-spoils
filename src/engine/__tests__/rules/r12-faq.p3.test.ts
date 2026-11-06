// Batch r12-faq (docs/TESTING.md), part 3: Rules FAQ 2.0 rulings 13-20.
// Each ruling is reproduced with synthetic cards; expectations come from the
// FAQ's question and answer text, not from the engine.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, GameEvent, SpoilsEngine } from "../../../engine.js";
import {
  autoResolveBattle,
  buildGame,
  character,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import { refused, rule, ruleExempt } from "./_rule.js";

const ACTIVATED = (effects: unknown[], extra: Record<string, unknown> = {}) =>
  ({ abilities: [{ id: "go", type: "activated", effects, ...extra }] }) as CardDefinition["behavior"];

const blank = (name: string) => tactic({ name });
const zone = (engine: SpoilsEngine, cardId: string) => engine.state.cards[cardId]!.zone;
const gain = (amount: number) => ({ type: "modifyInfluence" as const, player: "controller" as const, amount });
const events = (engine: SpoilsEngine, type: GameEvent["type"]) => engine.getLog().flatMap(entry => (entry.event?.type === type ? [entry.event] : []));

/** A tactic: "Pick a <selector>. Gain 1 influence" — the pick is a play-time target `t`. */
const picker = (name: string, selector: Record<string, unknown>) =>
  tactic({ name, behavior: ACTIVATED([gain(1)], { targets: [{ id: "t", selector, count: 1 }] }) });

describe("FAQ 13 — two cards that must be picked", () => {
  /** "Anything that can pick this card must pick it. When this card is picked, put a token on it." */
  const ferret = (name: string) =>
    character({
      name,
      behavior: {
        abilities: [
          { id: "must", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "mustBePicked" }] },
          { id: "grow", type: "triggered", event: "cardPicked", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }
        ]
      }
    });
  const board = (withFerrets = true) =>
    buildGame({
      cards: [
        { key: "pick", def: picker("Pick A Character", { zone: "play", type: "character" }), owner: P1, zone: "hand" },
        ...(withFerrets
          ? [
              { key: "f1", def: ferret("Ferret One"), owner: P2 },
              { key: "f2", def: ferret("Ferret Two"), owner: P2 }
            ]
          : []),
        { key: "plain", def: character({ name: "Plain" }), owner: P2 }
      ]
    });
  const pickFor = (g: ReturnType<typeof board>, key: string) =>
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("pick"), selected: { t: [g.id(key)] } });
  const tokens = (g: ReturnType<typeof board>, key: string) => g.engine.state.cards[g.id(key)]!.counters.token ?? 0;

  rule("FAQ 13", "control: with no forcing card in play, any character may be picked", () => {
    const g = board(false);
    pickFor(g, "plain");
    resolvePendingResponses(g.engine);
    assert.equal(zone(g.engine, g.id("pick")), "discard", "the tactic resolved with the plain character picked");
  });

  rule("FAQ 13", "with two forcing cards you pick one of them: either is a legal pick", () => {
    for (const key of ["f1", "f2"]) {
      const g = board();
      pickFor(g, key);
      resolvePendingResponses(g.engine);
      assert.equal(zone(g.engine, g.id("pick")), "discard", `${key} was accepted as the pick`);
    }
  });

  rule("FAQ 13", "a character that is not forcing cannot be picked while a forcing card is available", () => {
    const g = board();
    refused(() => pickFor(g, "plain"), "picking a plain character around the forcing cards", /pick|must|target|legal/i);
    assert.equal(zone(g.engine, g.id("pick")), "hand", "the tactic was not played");
    pickFor(g, "f1");
    assert.ok(zone(g.engine, g.id("pick")) !== "hand", "control: picking a forcing card works");
  });

  rule("FAQ 13", "you are not forced into picking both: a single pick is the whole pick", () => {
    const g = board();
    pickFor(g, "f1");
    resolvePendingResponses(g.engine);
    assert.equal(zone(g.engine, g.id("pick")), "discard", "one pick was enough");
  });

  rule("FAQ 13", "only the card you choose counts as 'being picked': the other forcing card's 'when picked' trigger does not fire", () => {
    const g = board();
    pickFor(g, "f1");
    resolvePendingResponses(g.engine);
    assert.equal(tokens(g, "f1"), 1, "the picked Ferret got its token");
    assert.equal(tokens(g, "f2"), 0, "the other Ferret was not 'picked'");
    const picked = events(g.engine, "cardPicked");
    assert.deepEqual(picked.map(e => (e.type === "cardPicked" ? e.cardId : "")), [g.id("f1")], "exactly one card was reported as picked");
  });

  rule("FAQ 13", "the same holds with the other Ferret picked", () => {
    const g = board();
    pickFor(g, "f2");
    resolvePendingResponses(g.engine);
    assert.equal(tokens(g, "f2"), 1);
    assert.equal(tokens(g, "f1"), 0);
  });
});

describe("FAQ 14 — entering play and being deployed", () => {
  /** Triggers "when a card enters play" on whatever card it sits on. */
  const enterWatcher = () =>
    character({
      name: "Entry Watcher",
      behavior: { abilities: [{ id: "seen", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [gain(7)] }] }
    });

  rule("FAQ 14", "a card is 'being deployed' after its costs are paid and before it hits the table: the opponent can respond, and it is not yet in play", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "newcomer", def: enterWatcher(), owner: P1, zone: "hand" },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    assert.equal(zone(engine, id("newcomer")), "deploying", "being deployed: not in play, not in hand");
    assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent has the chance to respond");
    assert.equal(engine.state.players[P1].influence, 25, "its 'enters play' trigger has not happened");
    engine.perform({ type: "playCard", playerId: P2, cardId: id("reply") });
    assert.equal(zone(engine, id("newcomer")), "deploying", "still being deployed after a response is added");
  });

  rule("FAQ 14", "once all responses have been taken the card enters play, and only then do its 'enters play' triggers occur", () => {
    const { engine, id } = buildGame({ cards: [{ key: "newcomer", def: enterWatcher(), owner: P1, zone: "hand" }] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("newcomer")), "play", "resolved and entered play");
    assert.equal(engine.state.players[P1].influence, 32, "the enters-play trigger fired");
    assert.equal(events(engine, "cardEnteredPlay").length, 1);
  });

  rule("FAQ 14", "when a card is 'entering play' there are no more opportunities to respond to the card: the enters-play trigger resolves without a response window", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "newcomer", def: enterWatcher(), owner: P1, zone: "hand" },
        { key: "reply", def: blank("Reply"), owner: P2, zone: "hand" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("newcomer") });
    engine.perform({ type: "passPriority", playerId: P2 });
    engine.perform({ type: "advanceFlow" });
    assert.equal(zone(engine, id("newcomer")), "play");
    assert.equal(engine.state.responseWindow, undefined, "no window is open for the card that has entered play");
    assert.equal(engine.state.players[P1].influence, 32, "its trigger resolved at once");
  });

  rule("FAQ 14", "a card 'put into play' by another card's effect was never 'being played': it enters play with no deployment and no card-played event", () => {
    const putter = tactic({
      name: "Put In",
      behavior: ACTIVATED([{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }], {
        targets: [{ id: "t", selector: { zone: "deck", type: "character" }, count: 1 }]
      })
    });
    const { engine, id } = buildGame({
      cards: [
        { key: "putter", def: putter, owner: P1, zone: "hand" },
        { key: "guest", def: enterWatcher(), owner: P1, zone: "deck" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("putter"), selected: { t: [id("guest")] } });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("guest")), "play", "the card entered play");
    assert.equal(engine.state.players[P1].influence, 32, "and its enters-play trigger fired");
    const played = events(engine, "cardPlayed").map(e => (e.type === "cardPlayed" ? e.cardId : ""));
    assert.deepEqual(played, [id("putter")], "only the Put In tactic was ever 'played', not the guest");
    const entered = events(engine, "cardEnteredPlay").find(e => e.type === "cardEnteredPlay" && e.cardId === id("guest"));
    assert.ok(entered && entered.type === "cardEnteredPlay" && entered.from === "deck", "it entered play from the deck");
  });

  rule("FAQ 14", "flipping a card up from the resource row enters play (the card was played, the trigger fires on entering)", () => {
    const flippable = character({ name: "Flip Entry", flipUp: { cost: 0, threshold: 0 }, behavior: { abilities: [{ id: "seen", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [gain(7)] }] } });
    const { engine, id } = buildGame({ cards: [{ key: "down", def: flippable, owner: P1, faceDown: true }] });
    engine.perform({ type: "flipUp", playerId: P1, cardId: id("down") });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("down")]!.faceDown, false);
    assert.equal(engine.state.players[P1].influence, 32, "it entered play and triggered");
  });

  rule("FAQ 14", "playing a card from the discard pile also enters play", () => {
    const comeback = character({
      name: "Comeback",
      behavior: {
        abilities: [
          { id: "seen", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [gain(7)] },
          { id: "return", type: "activated", activationZone: "discard", effects: [{ type: "putIntoPlay", target: "source", controller: "controller" }] }
        ]
      }
    });
    const { engine, id } = buildGame({ cards: [{ key: "back", def: comeback, owner: P1, zone: "discard" }] });
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("back"), abilityId: "return" });
    resolvePendingResponses(engine);
    assert.equal(zone(engine, id("back")), "play", "returned from the discard pile");
    assert.equal(engine.state.players[P1].influence, 32, "entering play from the discard pile triggered it");
    const entered = events(engine, "cardEnteredPlay").find(e => e.type === "cardEnteredPlay" && e.cardId === id("back"));
    assert.ok(entered && entered.type === "cardEnteredPlay" && entered.from === "discard", "it entered from the discard pile");
  });
});

describe("FAQ 15 — picking a faction", () => {
  const board = (selector: Record<string, unknown>) =>
    buildGame({
      cards: [
        { key: "pick", def: picker("Pick", selector), owner: P1, zone: "hand" },
        { key: "target", def: character({ name: "Target" }), owner: P2 }
      ]
    });
  const playPick = (g: ReturnType<typeof board>, targetId: string) =>
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("pick"), selected: { t: [targetId] } });

  rule("FAQ 15", "a faction cannot be picked by 'pick a character' (Quotidian Assassination): the opponent's faction is refused, a character is fine", () => {
    const g = board({ zone: "play", type: "character" });
    refused(() => playPick(g, g.engine.state.players[P2].factionId!), "picking the opponent's faction with a character-only pick", /pick|target|legal|valid/i);
    assert.equal(zone(g.engine, g.id("pick")), "hand", "the tactic was not played");
    playPick(g, g.id("target"));
    assert.ok(zone(g.engine, g.id("pick")) !== "hand", "control: the character pick works");
  });

  rule("FAQ 15", "a faction cannot be picked by a bare 'pick a card' either: such cards only refer to the cards in play, not the faction", () => {
    const g = board({ zone: "play" });
    refused(() => playPick(g, g.engine.state.players[P2].factionId!), "picking a faction with 'pick a card'", /pick|target|legal|valid/i);
    playPick(g, g.id("target"));
    assert.ok(zone(g.engine, g.id("pick")) !== "hand", "control: a card in play can be picked");
  });

  rule("FAQ 15", "a faction can be picked only by a card that specifically says it can (Bask Bile: 'a character or faction')", () => {
    const bile = tactic({
      name: "Bile",
      behavior: ACTIVATED([{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }], {
        targets: [
          {
            id: "t",
            selector: {
              conditions: [
                {
                  type: "or",
                  conditions: [
                    { type: "cardTypeIs", cardType: "character", target: { type: "selected", id: "__candidate" } },
                    { type: "cardTypeIs", cardType: "faction", target: { type: "selected", id: "__candidate" } }
                  ]
                }
              ]
            },
            count: 1
          }
        ]
      })
    });
    const g = buildGame({ cards: [{ key: "bile", def: bile, owner: P1, zone: "hand" }] });
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("bile"), selected: { t: [g.engine.state.players[P2].factionId!] } });
    resolvePendingResponses(g.engine);
    assert.equal(g.engine.state.players[P2].influence, 20, "the faction was picked and took 5 damage");
  });

  rule("FAQ 15", "'pick a card' only refers to cards in play: a card in a hand, discard pile or deck cannot be picked", () => {
    const g = buildGame({
      cards: [
        { key: "pick", def: picker("Pick", { zone: "play" }), owner: P1, zone: "hand" },
        { key: "inplay", def: character({ name: "In Play" }), owner: P2 },
        { key: "inhand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" },
        { key: "indiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" },
        { key: "indeck", def: character({ name: "In Deck" }), owner: P2, zone: "deck" }
      ]
    });
    for (const key of ["inhand", "indiscard", "indeck"]) {
      refused(
        () => g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("pick"), selected: { t: [g.id(key)] } }),
        `picking the card in ${key}`,
        /pick|target|legal|valid/i
      );
    }
    g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("pick"), selected: { t: [g.id("inplay")] } });
    assert.ok(zone(g.engine, g.id("pick")) !== "hand", "control: the card in play can be picked");
  });
});

ruleExempt(
  "FAQ 16",
  "Which physical object represents a token (coins, dice, beads) is a table-top convention. The engine represents tokens as per-card counters (CR 409.3 tokens are tested in other batches); there is no engine behavior in the choice of marker."
);

describe("FAQ 17 — battle damage", () => {
  /** "When this card is dealt battle damage ..." style watcher: gains 1 influence on battle damage only. */
  const battleWatcher = () =>
    character({
      name: "Battle Watcher",
      behavior: {
        abilities: [{ id: "bd", type: "triggered", event: "damageDealt", condition: { type: "damageIsBattle" }, effects: [gain(1)] }]
      }
    });
  const poke = () =>
    tactic({
      name: "Poke",
      behavior: ACTIVATED([{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }], {
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }]
      })
    });
  const abilityPoke = () =>
    character({
      name: "Poker",
      behavior: ACTIVATED([{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }], {
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }]
      })
    });
  const damageEvents = (engine: SpoilsEngine) => events(engine, "damageDealt").flatMap(e => (e.type === "damageDealt" ? [e] : []));

  function battle(mid: "none" | "tactic" | "ability") {
    const g = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 2, life: 5 }), owner: P1 },
        { key: "blocker", def: character({ name: "Blocker", strength: 1, life: 5 }), owner: P2 },
        { key: "watch", def: battleWatcher(), owner: P1 },
        { key: "poke", def: poke(), owner: P1, zone: "hand" },
        { key: "poker", def: abilityPoke(), owner: P1 }
      ]
    });
    g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("attacker")], target: { type: "faction", playerId: P2 } });
    if (mid === "tactic") g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("poke"), selected: { t: [g.id("blocker")] } });
    if (mid === "ability") g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("poker"), abilityId: "go", selected: { t: [g.id("blocker")] } });
    resolvePendingResponses(g.engine);
    g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("blocker")] });
    autoResolveBattle(g.engine);
    return g;
  }

  rule("FAQ 17", "damage inflicted in the damage steps of resolving a battle is battle damage", () => {
    const g = battle("none");
    const mine = damageEvents(g.engine).filter(e => e.targetId === g.id("blocker"));
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.battle, true, "the attacker's damage to the blocker is flagged as battle damage");
    const back = damageEvents(g.engine).filter(e => e.targetId === g.id("attacker"));
    assert.equal(back[0]!.battle, true, "and so is the blocker's damage to the attacker");
  });

  rule("FAQ 17", "damage dealt by a tactic during the battle is not battle damage", () => {
    const g = battle("tactic");
    const tacticHit = damageEvents(g.engine).find(e => e.sourceId === g.id("poke"));
    assert.ok(tacticHit, "the tactic's damage was dealt");
    assert.ok(!tacticHit!.battle, "it is not flagged as battle damage");
    const battleHit = damageEvents(g.engine).find(e => e.sourceId === g.id("attacker"));
    assert.equal(battleHit?.battle, true, "control: the attacker's damage in the same battle is");
  });

  rule("FAQ 17", "damage dealt by an ability during the battle is not battle damage", () => {
    const g = battle("ability");
    const abilityHit = damageEvents(g.engine).find(e => e.sourceId === g.id("poker"));
    assert.ok(abilityHit, "the ability's damage was dealt");
    assert.ok(!abilityHit!.battle, "not battle damage");
  });

  rule("FAQ 17", "'battle damage' triggers react to the battle's damage only: with a tactic's damage added, the watcher still fires just twice (attacker's and blocker's battle damage)", () => {
    const plain = battle("none");
    const withTactic = battle("tactic");
    // Each side deals battle damage once: two battle-damage events either way.
    assert.equal(plain.engine.state.players[P1].influence, 27, "two battle-damage events: +2");
    assert.equal(withTactic.engine.state.players[P1].influence, 27, "the tactic's extra damage added nothing");
  });

  rule("FAQ 17", "damage from a triggered ability during a battle is not battle damage", () => {
    const retaliate = character({
      name: "Retaliator",
      behavior: {
        abilities: [
          {
            id: "retort",
            type: "triggered",
            event: "battleStarted",
            effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 1 }]
          }
        ]
      }
    });
    const g = buildGame({
      cards: [
        { key: "attacker", def: character({ name: "Attacker", strength: 2, life: 5 }), owner: P1 },
        { key: "retaliator", def: retaliate, owner: P1 }
      ]
    });
    g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("attacker")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(g.engine);
    g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
    autoResolveBattle(g.engine);
    const bySource = damageEvents(g.engine);
    const trigger = bySource.find(e => e.sourceId === g.id("retaliator"));
    assert.ok(trigger, "the trigger's damage happened");
    assert.ok(!trigger!.battle, "not battle damage");
    assert.equal(bySource.find(e => e.sourceId === g.id("attacker"))?.battle, true, "control: the attacker's is");
  });
});

describe("FAQ 18 — no floating resources", () => {
  const costly = (cost: number) => character({ name: `Costly ${cost}`, cost });
  const bank = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `res${i}`, def: resourceCard({ name: `Res ${i}` }), owner: P1 }));

  rule("FAQ 18", "you must pay for a card all at once: with one resource short the play is refused and nothing is spent", () => {
    const { engine, id } = buildGame({ cards: [{ key: "big", def: costly(2), owner: P1, zone: "hand" }, ...bank(1)] });
    const before = engine.getAvailableResourceCount(P1);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("big") }), "paying 2 with 1 resource", /deployed right now|cannot|afford|resource/i);
    assert.equal(engine.getAvailableResourceCount(P1), before, "no resource was committed: nothing floats");
    assert.equal(zone(engine, id("big")), "hand");
  });

  rule("FAQ 18", "with exactly enough resources the whole cost is paid when the card is played", () => {
    const { engine, id } = buildGame({ cards: [{ key: "big", def: costly(2), owner: P1, zone: "hand" }, ...bank(2)] });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("big") });
    assert.equal(engine.getAvailableResourceCount(P1), 0, "both resources were used immediately");
    assert.equal(zone(engine, id("big")), "deploying");
  });

  rule("FAQ 18", "a resource already used to pay stays used: after playing, the same resources cannot pay for a second card", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "first", def: costly(1), owner: P1, zone: "hand" },
        { key: "second", def: costly(1), owner: P1, zone: "hand" },
        ...bank(1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("first") });
    resolvePendingResponses(engine);
    refused(() => engine.perform({ type: "playCard", playerId: P1, cardId: id("second") }), "paying again with the already-used resource", /deployed right now|cannot|afford|resource/i);
    assert.equal(zone(engine, id("second")), "hand");
  });

  rule("FAQ 18", "there is no window to detach a resource that is paying for the card: the player cannot use an ability between paying and the card resolving", () => {
    const freer = character({ name: "Freer", behavior: ACTIVATED([{ type: "detach", target: { type: "selected", id: "r" } }], { targets: [{ id: "r", selector: { type: "resource", controller: "self" }, count: 1 }] }) });
    const { engine, id } = buildGame({
      cards: [
        { key: "big", def: costly(2), owner: P1, zone: "hand" },
        { key: "freer", def: freer, owner: P1 },
        ...bank(2)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("big") });
    const paying = Object.values(engine.state.cards).filter(c => c.attachedTo === engine.state.players[P1].factionId && c.zone === "play");
    assert.equal(paying.length, 2, "two resources are spent on the card");
    refused(
      () => engine.perform({ type: "activateAbility", playerId: P1, cardId: id("freer"), abilityId: "go", selected: { r: [paying[0]!.id] } }),
      "detaching a resource that paid for the card, before the card resolves",
      /priority|timing|cannot/i
    );
    assert.equal(engine.getAvailableResourceCount(P1), 0, "the spent resources stayed spent");
  });

  rule("FAQ 18", "control: when nothing is being played the same detach ability works, freeing the resource afterwards", () => {
    const freer = character({ name: "Freer", behavior: ACTIVATED([{ type: "detach", target: { type: "selected", id: "r" } }], { targets: [{ id: "r", selector: { type: "resource", controller: "self" }, count: 1 }] }) });
    const { engine, id } = buildGame({
      cards: [
        { key: "big", def: costly(1), owner: P1, zone: "hand" },
        { key: "freer", def: freer, owner: P1 },
        ...bank(1)
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("big") });
    resolvePendingResponses(engine);
    const paid = Object.values(engine.state.cards).find(c => c.attachedTo === engine.state.players[P1].factionId && c.zone === "play")!;
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("freer"), abilityId: "go", selected: { r: [paid.id] } });
    resolvePendingResponses(engine);
    assert.equal(engine.getAvailableResourceCount(P1), 1, "the resource was detached once the card had resolved");
  });
});

describe("FAQ 19 — characters with 0 speed", () => {
  const speedy = (name: string, speed: number, strength: number, life: number) => character({ name, speed, strength, life });
  const fight = (attacker: CardDefinition, blocker: CardDefinition | undefined) => {
    const g = buildGame({
      cards: [
        { key: "attacker", def: attacker, owner: P1 },
        ...(blocker ? [{ key: "blocker", def: blocker, owner: P2 }] : [])
      ]
    });
    g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("attacker")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(g.engine);
    g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: blocker ? [g.id("blocker")] : [] });
    autoResolveBattle(g.engine);
    return g;
  };

  rule("FAQ 19", "a 0-speed attacker that is not blocked assigns its damage to the faction", () => {
    const g = fight(speedy("Slowpoke", 0, 3, 3), undefined);
    assert.equal(g.engine.state.players[P2].influence, 22, "3 damage to the faction");
  });

  rule("FAQ 19", "a 0-speed character assigns its damage like any other, last: it hits after a faster blocker has hit it (and survives to do so)", () => {
    const g = fight(speedy("Slowpoke", 0, 2, 3), speedy("Quick", 1, 1, 2));
    assert.equal(g.engine.state.cards[g.id("attacker")]!.damage, 1, "the faster blocker hit first");
    assert.equal(zone(g.engine, g.id("blocker")), "discard", "then the 0-speed attacker's 2 damage destroyed the blocker");
  });

  rule("FAQ 19", "0 speed is the lowest speed: a faster blocker that destroys the 0-speed attacker first prevents its damage", () => {
    const g = fight(speedy("Slowpoke", 0, 2, 1), speedy("Quick", 1, 1, 2));
    assert.equal(zone(g.engine, g.id("attacker")), "discard", "destroyed by the faster blocker");
    assert.equal(g.engine.state.cards[g.id("blocker")]!.damage, 0, "it never got to assign its damage");
  });

  rule("FAQ 19", "a 0-speed blocker assigns damage too, after the faster attacker", () => {
    const g = buildGame({
      cards: [
        { key: "attacker", def: speedy("Quick", 1, 1, 3), owner: P1 },
        { key: "blocker", def: speedy("Slowpoke", 0, 2, 3), owner: P2 }
      ]
    });
    g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("attacker")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(g.engine);
    g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("blocker")] });
    autoResolveBattle(g.engine);
    assert.equal(g.engine.state.cards[g.id("attacker")]!.damage, 2, "the 0-speed blocker dealt 2 damage");
    assert.equal(g.engine.state.cards[g.id("blocker")]!.damage, 1, "after receiving 1");
  });
});

describe("FAQ 20 — conflicting attack requirements", () => {
  const hangdog = () =>
    location({
      name: "Solo Alley",
      behavior: { abilities: [{ id: "solo", type: "continuous", modifiers: [], partyRestriction: { role: "attacking", minMembers: 1, maxMembers: 1, scope: "allParties" } }] }
    });
  const arcana = () =>
    location({
      name: "Even Department",
      behavior: { abilities: [{ id: "even", type: "continuous", modifiers: [], partyRestriction: { role: "any", parity: "even", scope: "allParties" } }] }
    });
  const board = (cards: Array<"hangdog" | "arcana">) =>
    buildGame({
      cards: [
        ...(["a", "b", "c"] as const).map(key => ({ key, def: character({ name: `Attacker ${key}` }), owner: P1 })),
        ...(cards.includes("hangdog") ? [{ key: "hangdog", def: hangdog(), owner: P2 }] : []),
        ...(cards.includes("arcana") ? [{ key: "arcana", def: arcana(), owner: P2 }] : [])
      ]
    });
  const attack = (g: ReturnType<typeof board>, keys: string[]) =>
    g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: keys.map(k => g.id(k)), target: { type: "faction", playerId: P2 } });

  rule("FAQ 20", "each requirement on its own is binding: with only the 1-member requirement 2 attackers are refused and 1 is fine", () => {
    const g = board(["hangdog"]);
    refused(() => attack(g, ["a", "b"]), "two attackers under the 1-member requirement", /at most 1/);
    attack(g, ["a"]);
    assert.ok(g.engine.state.battle, "one attacker is fine");
  });

  rule("FAQ 20", "each requirement on its own is binding: with only the even-size requirement 1 attacker is refused and 2 are fine", () => {
    const g = board(["arcana"]);
    refused(() => attack(g, ["a"]), "one attacker under the even-size requirement", /even number/);
    attack(g, ["a", "b"]);
    assert.ok(g.engine.state.battle, "two attackers are fine");
  });

  rule("FAQ 20", "with both contradictory requirements in play it is still possible to attack: a 1-member party (satisfying one of the two) is legal", () => {
    const g = board(["hangdog", "arcana"]);
    attack(g, ["a"]);
    assert.ok(g.engine.state.battle, "the attack was declared with a party that satisfies as many requirements as possible");
  });

  rule("FAQ 20", "with both in play a 2-member party (satisfying the other requirement) is equally legal", () => {
    const g = board(["hangdog", "arcana"]);
    attack(g, ["a", "b"]);
    assert.ok(g.engine.state.battle, "the attack was declared with the other maximal party");
  });

  rule("FAQ 20", "with both in play a 3-member party satisfies neither requirement, so it is not a best effort and is refused", () => {
    const g = board(["hangdog", "arcana"]);
    refused(() => attack(g, ["a", "b", "c"]), "a party that breaks both requirements when better ones exist", /at most 1|even number|must/i);
    assert.equal(g.engine.state.battle, undefined, "no battle started");
  });
});
