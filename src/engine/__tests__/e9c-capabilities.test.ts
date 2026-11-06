import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { activate, play, bank, buildGame, character, developFaction, item, location, P1, P2, resourceCard, tactic } from "./per-card/_harness.js";
import { fightThrough } from "./clauses/_battle.js";
import { declineAll } from "./clauses/_clause.js";
import type { ActivatedAbility, CardDefinition, Effect } from "../../engine.js";

/** A character with one free activated ability `go` that runs `effects` (picks declared in `targets`). */
const doer = (name: string, effects: Effect[], targets: unknown[] = []): CardDefinition =>
  character({
    name,
    life: 9,
    behavior: { abilities: [{ id: "go", type: "activated", targets, effects } as unknown as ActivatedAbility] }
  });

const dmg = (target: unknown, amount: number): Effect => ({ type: "dealDamage", target, amount }) as never;
const sel = (id: string) => ({ type: "selected", id });
const zoneOf = (engine: { state: { cards: Record<string, { zone: string }> } }, id: string) => engine.state.cards[id].zone;

describe("E9c engine capabilities", () => {
  test("preventAllDamage { battleOnly } reduces battle damage only; an ability's damage still lands", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "shield", def: doer("Shield", [{ type: "preventAllDamage", battleOnly: true, duration: { type: "untilEndOfTurn" } } as never]), owner: P1 },
        { key: "hit", def: doer("Hit", [dmg(sel("t"), 3)], [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }]), owner: P1 },
        { key: "atk", def: character({ name: "Atk", strength: 4, life: 9 }), owner: P1 },
        { key: "foe", def: character({ name: "Foe", strength: 1, life: 9 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("shield"), "go");
    activate(engine, P1, id("hit"), "go", { selected: { t: [id("foe")] } });
    assert.equal(engine.state.cards[id("foe")].damage, 3, "the ability's damage is not battle damage");
    fightThrough(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [id("foe")]);
    assert.equal(engine.state.cards[id("foe")].damage, 3, "battle damage (4) was reduced to 0");
  });

  test("modifyOutgoingDamage { toFaction } only reduces damage to that player's faction", () => {
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        {
          key: "cp",
          def: doer("Pot", [{ type: "modifyOutgoingDamage", source: sel("c"), delta: -99, toFaction: "controller", duration: { type: "untilEndOfTurn" } } as never], [
            { id: "c", selector: { type: "character", controller: "opponent" }, count: 1 }
          ]),
          owner: P1
        },
        { key: "foe", def: doer("Foe", [dmg(sel("m"), 2)], [{ id: "m", selector: { type: "character", controller: "opponent" }, count: 1 }]), owner: P2 },
        { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1 }
      ]
    });
    activate(engine, P1, id("cp"), "go", { selected: { c: [id("foe")] } });
    const factionB = engine.state.players[P1].factionId!;
    const before = engine.state.players[P1].influence;
    engine.state.activePlayerId = P2;
    engine.state.priorityPlayerId = P2;
    activate(engine, P2, id("foe"), "go", { selected: { m: [id("mine")] } });
    assert.equal(engine.state.cards[id("mine")].damage, 2, "damage to a character is untouched");
    assert.equal(engine.state.players[P1].influence, before);
    assert.ok(factionB);
  });

  test("damageDealt.battle + damageIsBattle tell battle damage from ability damage", () => {
    const watcher = {
      id: "w",
      type: "triggered",
      event: "damageDealt",
      condition: { type: "and", conditions: [{ type: "sourceIsDamageSource" }, { type: "damageIsBattle" }] },
      effects: [{ type: "addCounter", target: "source", counter: "n", amount: 1 }]
    };
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        {
          key: "w",
          def: character({
            name: "W",
            strength: 2,
            life: 9,
            behavior: { abilities: [watcher, { id: "go", type: "activated", targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }], effects: [dmg(sel("t"), 1)] }] } as never
          }),
          owner: P1
        },
        { key: "foe", def: character({ name: "Foe", life: 9 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("w"), "go", { selected: { t: [id("foe")] } });
    assert.equal(engine.state.cards[id("w")].counters.n ?? 0, 0, "ability damage: no battle flag");
    fightThrough(engine, P1, [id("w")], { type: "faction", playerId: P2 }, [id("foe")], undefined, declineAll);
    assert.equal(engine.state.cards[id("w")].counters.n, 1, "battle damage: flagged");
  });

  test("a destroy COST skips the card's own replacement but not an attached card's (CR 506.2 / 506.2a)", () => {
    const flip = (name: string) =>
      ({ id: "r", type: "replacement", replaces: { event: "destroy" }, effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "hand" }] }) as never;
    const sac = character({
      name: "Sac",
      behavior: { abilities: [{ id: "go", type: "activated", costs: [{ type: "destroy", target: "source" }], effects: [] }] } as never
    });
    // own replacement on the sacrificed card: ignored when destroyed as a cost
    const own = buildGame({ cards: [{ key: "s", def: { ...sac, behavior: { abilities: [...sac.behavior!.abilities!, flip("own")] } } as never, owner: P1 }] });
    activate(own.engine, P1, own.id("s"), "go");
    assert.equal(zoneOf(own.engine, own.id("s")), "discard", "own replacement does not apply to a cost");
    // an attached item's replacement still applies
    const att = buildGame({
      cards: [
        { key: "s", def: sac, owner: P1 },
        { key: "a", def: item({ name: "Guard", behavior: { abilities: [{ id: "r", type: "replacement", replaces: { event: "destroy" }, effects: [{ type: "destroy", target: "source" }] }] } as never }), owner: P1, attachedToKey: "s" }
      ]
    });
    activate(att.engine, P1, att.id("s"), "go");
    assert.equal(zoneOf(att.engine, att.id("s")), "play", "the attached card's replacement applied");
    assert.equal(zoneOf(att.engine, att.id("a")), "discard", "the attached card was destroyed instead");
  });

  test("ReplacementAbility 'damage' replaces damage with its effects; battleOnly limits it to battle", () => {
    const absorber = (battleOnly: boolean) =>
      character({
        name: "Abs",
        life: 9,
        behavior: {
          abilities: [
            {
              id: "absorb",
              type: "replacement",
              replaces: { event: "damage", battleOnly },
              condition: { type: "isCard", target: { type: "selected", id: "__candidate" }, other: "source" },
              effects: [{ type: "addCounter", target: "source", counter: "token", amount: { type: "eventDamageAmount" } }]
            }
          ]
        } as never
      });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "abs", def: absorber(true), owner: P1 },
        { key: "hit", def: doer("Hit", [dmg(sel("t"), 3)], [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }]), owner: P2 }
      ]
    });
    engine.state.activePlayerId = P2;
    engine.state.priorityPlayerId = P2;
    activate(engine, P2, id("hit"), "go", { selected: { t: [id("abs")] } });
    assert.equal(engine.state.cards[id("abs")].damage, 3, "battleOnly: ability damage lands");
    const b = buildGame({
      cards: [
        { key: "abs", def: absorber(false), owner: P1 },
        { key: "hit", def: doer("Hit", [dmg(sel("t"), 3)], [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }]), owner: P2 }
      ]
    });
    b.engine.state.activePlayerId = P2;
    b.engine.state.priorityPlayerId = P2;
    activate(b.engine, P2, b.id("hit"), "go", { selected: { t: [b.id("abs")] } });
    assert.equal(b.engine.state.cards[b.id("abs")].damage, 0, "replaced: no damage");
    assert.equal(b.engine.state.cards[b.id("abs")].counters.token, 3, "the effects ran with the damage amount");
  });

  test("putIntoPlay of an ATTACH TO card: the new controller picks a host (CR 507.2b); no host -> owner's discard (507.2c); attachToController limits hosts", () => {
    const gear = (over: Partial<CardDefinition> = {}) => item({ name: "Gear", attachTo: "character", ...over } as never);
    const putter = tactic({
      name: "Putter",
      cost: 0,
      behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }], effects: [{ type: "putIntoPlay", target: sel("t"), controller: "controller" }] }] } as never
    });
    const board = (g: CardDefinition, hosts: Array<[string, typeof P1]>) =>
      buildGame({
        playerA: { faction: developFaction() },
        cards: [
          { key: "put", def: putter, owner: P1, zone: "hand" },
          { key: "g", def: g, owner: P1, zone: "discard" },
          ...hosts.map(([key, owner]) => ({ key, def: character({ name: key }), owner, zone: "play" as const }))
        ]
      });
    const run = (b: ReturnType<typeof board>) => play(b.engine, P1, b.id("put"), { selected: { t: [b.id("g")] } });
    // picks
    const a = board(gear(), [["h1", P1], ["h2", P2]]);
    play(a.engine, P1, a.id("put"), { selected: { t: [a.id("g")] } });
    const pc = a.engine.state.pendingChoice as unknown as { kind: string; playerId: string };
    assert.equal(pc.kind, "chooserSelectsTarget", "the controller is asked for a host");
    a.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [a.id("h2")] } } as never);
    assert.equal(a.engine.state.cards[a.id("g")].zone, "play");
    assert.equal(a.engine.state.cards[a.id("g")].attachedTo, a.id("h2"));
    // no host at all: stays in the discard pile
    const n = board(gear(), []);
    run(n);
    assert.equal(zoneOf(n.engine, n.id("g")), "discard");
    // "ATTACH TO CHARACTER YOU CONTROL": only my own characters are legal hosts
    const y = board(gear({ attachToController: "self" } as never), [["h2", P2]]);
    run(y);
    assert.equal(zoneOf(y.engine, y.id("g")), "discard", "the only character is the opponent's: no legal host");
  });

  test("putIntoPlay { attachTo } names the host itself (no pick), also for a card without ATTACH TO", () => {
    const putter = character({
      name: "Putter",
      behavior: { abilities: [{ id: "go", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }, { id: "h", selector: { type: "character", controller: "opponent" }, count: 1 }], effects: [{ type: "putIntoPlay", target: sel("t"), controller: "controller", attachTo: sel("h") }] }] } as never
    });
    for (const attachTo of ["character", undefined] as const) {
      const { engine, id } = buildGame({
        cards: [
          { key: "p", def: putter, owner: P1 },
          { key: "g", def: item({ name: "Gear", ...(attachTo ? { attachTo } : {}) } as never), owner: P1, zone: "discard" },
          { key: "foe", def: character({ name: "Foe" }), owner: P2 }
        ]
      });
      activate(engine, P1, id("p"), "go", { selected: { t: [id("g")], h: [id("foe")] } });
      assert.equal(engine.state.pendingChoice, undefined);
      assert.equal(engine.state.cards[id("g")].attachedTo, id("foe"));
      assert.equal(engine.state.cards[id("g")].controllerId, P1);
    }
  });

  test("respondingTo { respondsTo: 'ability', cardType } checks the type of the card the ability belongs to", () => {
    const answer = tactic({
      name: "Answer",
      cost: 0,
      behavior: { abilities: [{ id: "a", type: "activated", condition: { type: "respondingTo", respondsTo: "ability", cardType: "character" }, effects: [] }] } as never
    });
    const mk = (src: CardDefinition) =>
      buildGame({
        playerA: { faction: developFaction() },
        playerB: { faction: developFaction() },
        cards: [
          { key: "src", def: src, owner: P1 },
          { key: "ans", def: answer, owner: P2, zone: "hand" }
        ]
      });
    const ability = [{ id: "go", type: "activated", effects: [] }];
    for (const [def, ok] of [
      [character({ name: "C", behavior: { abilities: ability } as never }), true],
      [item({ name: "I", behavior: { abilities: ability } as never }), false]
    ] as const) {
      const b = mk(def);
      b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("src"), abilityId: "go", selected: {}, variables: {} } as never);
      const run = () => b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("ans"), selected: {}, variables: {} } as never);
      if (ok) run();
      else assert.throws(run, /./, "an item's ability is not a character's ability");
    }
  });

  test("cardPicked fires for a played card's, an activated ability's and a triggered ability's picks", () => {
    const ferret = character({
      name: "Ferret",
      life: 9,
      behavior: { abilities: [{ id: "f", type: "triggered", event: "cardPicked", condition: { type: "sourceIsEventCard" }, effects: [{ type: "addCounter", target: "source", counter: "token", amount: 1 }] }] } as never
    });
    const pick = [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }];
    const zap = tactic({ name: "Zap", cost: 0, behavior: { abilities: [{ id: "z", type: "activated", targets: pick, effects: [] }] } as never });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      cards: [
        { key: "f", def: ferret, owner: P2 },
        { key: "zap", def: zap, owner: P1, zone: "hand" },
        { key: "d", def: doer("Doer", [], pick), owner: P1 }
      ]
    });
    activate(engine, P1, id("d"), "go", { selected: { t: [id("f")] } });
    assert.equal(engine.state.cards[id("f")].counters.token, 1, "activated ability pick");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("zap"), selected: { t: [id("f")] }, variables: {} } as never);
    assert.equal(engine.state.cards[id("f")].counters.token, 2, "played tactic pick");
  });

  test("lookAndReorder: answering never loses or duplicates deck cards, even if the deck changed meanwhile (SYS-43)", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
        { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
        { key: "d3", def: character({ name: "D3" }), owner: P1, zone: "deck" },
        { key: "d4", def: character({ name: "D4" }), owner: P1, zone: "deck" }
      ]
    });
    const deck = engine.state.players[P1].deck;
    const top2 = deck.slice(0, 2);
    engine.state.pendingChoice = { kind: "reorderDeck", id: "c1", playerId: P1, deckOwnerId: P1, cardIds: top2, to: "top" } as never;
    // the top card moved to hand before the answer
    engine.state.players[P1].deck = deck.filter(c => c !== top2[0]);
    engine.state.players[P1].hand.push(top2[0]);
    engine.state.cards[top2[0]].zone = "hand";
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "reorderDeck", order: [top2[1], top2[0]] } } as never);
    const all = [...engine.state.players[P1].deck, ...engine.state.players[P1].hand];
    assert.equal(new Set(all).size, all.length, "no duplicates");
    assert.equal(all.length, 4, "nothing vanished");
    assert.equal(engine.state.players[P1].deck[0], top2[1]);
    assert.ok(id("d1"));
  });

  test("FactionDefinition.setup.startsFlipped starts the game on the flipsTo side", async () => {
    const { createTwoPlayerFactionGame } = await import("../../engine.js");
    const side = (id: string, name: string, flipsTo: string, startsFlipped?: boolean) =>
      developFaction({ id, name, faction: { ...developFaction().faction!, flipsTo, setup: { ...developFaction().faction!.setup, ...(startsFlipped ? { startsFlipped } : {}) } } } as never);
    const a = side("fa", "Front", "fb", true);
    const b = side("fb", "Back", "fa");
    const plain = developFaction({ id: "fp", name: "Plain" } as never);
    const engine = createTwoPlayerFactionGame(
      [a, b, plain],
      { id: P1, name: "A", deckDefinitionIds: ["fa"] },
      { id: P2, name: "B", deckDefinitionIds: ["fp"] },
      { firstPlayerId: P1, seed: 1 }
    );
    assert.equal(engine.state.cards[engine.state.players[P1].factionId!].definitionId, "fb");
    assert.equal(engine.state.cards[engine.state.players[P2].factionId!].definitionId, "fp");
  });

  test("respondingTo { viaFlipUp } tells a FLIP UP deploy from a normal one", () => {
    const answer = tactic({
      name: "Answer",
      cost: 0,
      behavior: { abilities: [{ id: "a", type: "activated", condition: { type: "respondingTo", respondsTo: "card", viaFlipUp: true }, effects: [] }] } as never
    });
    const flippable = character({ name: "X", cost: 1, flipUp: { cost: 0, threshold: "" } } as never);
    const mk = (faceDown: boolean) =>
      buildGame({
        playerA: { faction: developFaction() },
        playerB: { faction: developFaction() },
        activePlayerId: P2,
        cards: [
          { key: "ans", def: answer, owner: P1, zone: "hand" },
          faceDown ? { key: "x", def: flippable, owner: P2, zone: "play", faceDown: true } : { key: "x", def: flippable, owner: P2, zone: "hand" },
          ...bank("rage", 2, P2)
        ]
      });
    const run = (b: ReturnType<typeof mk>) => b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("ans"), selected: {}, variables: {} } as never);
    const normal = mk(false);
    normal.engine.perform({ type: "playCard", playerId: P2, cardId: normal.id("x"), selected: {}, variables: {} } as never);
    assert.throws(() => run(normal), /./, "a normal deploy is not a FLIP UP deploy");
    const flipped = mk(true);
    flipped.engine.perform({ type: "flipUp", playerId: P2, cardId: flipped.id("x"), selected: {}, variables: {} } as never);
    run(flipped);
    assert.equal(zoneOf(flipped.engine, flipped.id("ans")), "deploying");
  });

  test("a resolving tactic's move to the discard pile consults runtime replacements (Ignatious)", () => {
    const spent = tactic({ name: "Spent", cost: 0, behavior: { abilities: [{ id: "s", type: "activated", effects: [] }] } as never });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "t", def: spent, owner: P1, zone: "hand" },
        { key: "i", def: doer("Inst", [{ type: "installReplacement", duration: { type: "untilEndOfTurn" }, once: true, replaces: { event: "moveToZone", zone: "discard" }, condition: { type: "targetInZone", target: sel("__candidate"), zone: "deploying" }, effects: [{ type: "removeFromGame", target: sel("__candidate") }] } as never]), owner: P1 }
      ]
    });
    activate(engine, P1, id("i"), "go");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("t"), selected: {}, variables: {} } as never);
    for (let i = 0; i < 6 && engine.state.responseWindow; i++) {
      engine.perform(engine.state.responseWindow.phase === "acceptingResponses" ? ({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId } as never) : ({ type: "advanceFlow" } as never));
    }
    assert.equal(zoneOf(engine, id("t")), "removed", "removed from the game instead of the discard pile");
  });

  test("CardSelector.nameNotControlledBy and voidedBySource", () => {
    const finder = doer("Finder", [], [
      { id: "n", selector: { zone: "deck", owner: "self", nameNotControlledBy: "self" }, count: 1 },
      { id: "v", selector: { zone: "void", voidedBySource: true }, count: 1, optional: true }
    ]);
    const { engine, id } = buildGame({
      cards: [
        { key: "f", def: finder, owner: P1 },
        { key: "same", def: resourceCard({ name: "Greed" }), owner: P1, zone: "deck" },
        { key: "other", def: resourceCard({ name: "Rage" }), owner: P1, zone: "deck" },
        { key: "ctrl", def: resourceCard({ name: "Greed" }), owner: P1, zone: "play" },
        { key: "mine", def: character({ name: "Mine" }), owner: P2, zone: "void" }
      ]
    });
    const sourceCtx = { sourceId: id("f"), controllerId: P1, selected: {} };
    const names = engine.queryCards({ zone: "deck", owner: "self", nameNotControlledBy: "self" } as never, sourceCtx as never).map(c => c.id);
    assert.deepEqual(names, [id("other")], "a name I control is excluded");
    assert.equal(engine.queryCards({ zone: "void", voidedBySource: true } as never, sourceCtx as never).length, 0, "nothing voided by Finder yet");
    engine.state.cards[id("mine")].voidedBy = id("f");
    assert.deepEqual(engine.queryCards({ zone: "void", voidedBySource: true } as never, sourceCtx as never).map(c => c.id), [id("mine")]);
  });

  test("moveCard { faceDown } and voidedBy: a card voided face-down by an effect", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "v", def: doer("Voider", [{ type: "moveCard", target: sel("t"), to: "void", faceDown: true } as never], [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }]), owner: P1 },
        { key: "c", def: character({ name: "C" }), owner: P1, zone: "discard" }
      ]
    });
    activate(engine, P1, id("v"), "go", { selected: { t: [id("c")] } });
    assert.equal(zoneOf(engine, id("c")), "void");
    assert.equal(engine.state.cards[id("c")].faceDown, true, "face-down in the void");
    assert.equal(engine.state.cards[id("c")].voidedBy, id("v"), "remembers what voided it");
    (engine as any).moveCard(id("c"), "discard");
    assert.equal(engine.state.cards[id("c")].voidedBy, undefined, "cleared when it leaves the void");
  });

  test("distributeAmong { among, maxShare } divides over a selector with a per-card cap", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: doer("Divider", [{ type: "distributeAmong", chooser: "controller", among: { type: "character", controller: "opponent" }, amount: 3, maxShare: 2, effects: [dmg(sel("__candidate"), 1)] } as never]), owner: P1 },
        { key: "a", def: character({ name: "A", life: 9 }), owner: P2 },
        { key: "b", def: character({ name: "B", life: 9 }), owner: P2 }
      ]
    });
    activate(engine, P1, id("d"), "go");
    const pc = engine.state.pendingChoice as unknown as { kind: string; targets: string[]; caps: Record<string, number> };
    assert.equal(pc.kind, "distributeAmong");
    assert.deepEqual([...pc.targets].sort(), [id("a"), id("b")].sort(), "no pick: all matching cards");
    assert.deepEqual(pc.caps, { [id("a")]: 2, [id("b")]: 2 });
    assert.throws(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [id("a")]: 3 } } } as never), /./, "a share above the cap is refused");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "distributeAmong", shares: { [id("a")]: 2, [id("b")]: 1 } } } as never);
    assert.equal(engine.state.pendingChoice, undefined);
  });

  test("TargetDeclaration.distinctTypes allows at most one pick of each card type", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "d", def: doer("Smasher", [], [{ id: "t", selector: { controller: "opponent" }, count: 3, distinctTypes: true, optional: true }]), owner: P1 },
        { key: "c1", def: character({ name: "C1" }), owner: P2 },
        { key: "c2", def: character({ name: "C2" }), owner: P2 },
        { key: "i1", def: item({ name: "I1" }), owner: P2 },
        { key: "l1", def: location({ name: "L1" }), owner: P2 }
      ]
    });
    assert.throws(() => activate(engine, P1, id("d"), "go", { selected: { t: [id("c1"), id("c2")] } }), /./, "two characters");
    activate(engine, P1, id("d"), "go", { selected: { t: [id("c1"), id("i1"), id("l1")] } });
  });

  test("RestrictionGrantDefinition.exceptPickerType: cannotBePicked does not apply to an item's pick", () => {
    const giant = character({
      name: "Giant",
      behavior: { abilities: [{ id: "r", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction: "cannotBePicked", exceptPickerType: "item" }] }] } as never
    });
    const pick = [{ id: "t", selector: { type: "character" }, count: 1 }];
    const { engine, id } = buildGame({
      cards: [
        { key: "g", def: giant, owner: P2 },
        { key: "ci", def: item({ name: "ItemDoer", behavior: { abilities: [{ id: "go", type: "activated", targets: pick, effects: [] }] } as never }), owner: P1 },
        { key: "cc", def: doer("CharDoer", [], pick), owner: P1 }
      ]
    });
    activate(engine, P1, id("ci"), "go", { selected: { t: [id("g")] } });
    assert.throws(() => activate(engine, P1, id("cc"), "go", { selected: { t: [id("g")] } }), /./, "a character's ability cannot pick it");
  });

  test("an `if` branch parks the rest of its effects while a nested effect's choice is outstanding", () => {
    const { engine, id } = buildGame({
      cards: [
        {
          key: "d",
          def: doer("Branch", [
            {
              type: "if",
              condition: { type: "targetExists", target: "source" },
              effects: [
                { type: "chooserSelectsTarget", chooser: "controller", declaration: { id: "a", selector: { type: "character" }, count: 1, optional: true }, effects: [] },
                { type: "addCounter", target: "source", counter: "after", amount: 1 }
              ]
            } as never
          ]),
          owner: P1
        }
      ]
    });
    activate(engine, P1, id("d"), "go");
    assert.ok(engine.state.pendingChoice, "the nested pick is open");
    assert.equal(engine.state.cards[id("d")].counters.after ?? 0, 0, "the next effect waits for the answer");
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never);
    assert.equal(engine.state.cards[id("d")].counters.after, 1, "and runs after it");
  });
});
