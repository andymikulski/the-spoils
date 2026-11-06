import assert from "node:assert/strict";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  activate,
  play
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdCostChoices } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { pending, zoneOf, tokensOn } from "./_board.js";
import { attachedCount, endTurn, readyCount, spentResources } from "./_turn.js";

const WASTE = "7331f393-05da-4661-bbf6-4ee695c830cd"; // Wasteland -- UNIQUE WASTELAND
const SUCCOR = "f9372755-6c19-4d67-85ba-c73c259e6b2c"; // Zenobia's Succor
const MAJOR = "2b149e8a-cc40-4c1b-a99f-93369ce5b4bb"; // Abusive Major General
const ADUL = "e38bc85c-e7ab-4f6f-b795-08976682f7bd"; // Auditory Adulation

const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });

const faction = (engine: SpoilsEngine, p: PlayerId): CardInstanceId => engine.state.players[p].factionId!;

// ============================================================================
// Wasteland -- location, cost 5, [V][V][V], structure 1, UNIQUE WASTELAND
// ============================================================================

interface WOpts {
  turn?: number;
  active?: PlayerId;
  owner?: PlayerId;
  controller?: PlayerId;
  counters?: Record<string, number>;
}
const wboard = (extra: CardPlacement[] = [], o: WOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 1,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "w", def: printing(WASTE), owner: o.owner ?? P1, zone: "play", controller: o.controller, counters: o.counters },
      ...extra
    ]
  });

const handBoard = (cards: CardPlacement[]) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "w", def: printing(WASTE), owner: P1, zone: "hand" }, ...cards]
  });

clause(WASTE, "0:unique", "printed as a universal location with cost 5, [V][V][V] and structure 1: deploys for exactly 5 Volition", () => {
  const g = handBoard([...volition(5, P1), { key: "r1", def: resourceCard({ name: "Extra" }), owner: P1, zone: "play" }]);
  const w = g.engine.getDefinition(g.id("w"));
  assert.equal(w.type, "location");
  assert.equal(w.trade, "universal");
  assert.equal(g.engine.getStat(g.id("w"), "structure"), 1);
  assert.equal(readyCount(g.engine, P1), 6);
  play(g.engine, P1, g.id("w"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(readyCount(g.engine, P1), 1, "cost 5 paid, not more or less");
});

clause(WASTE, "0:unique", "one resource short of cost 5 refuses the deploy", () => {
  const g = handBoard([...volition(4, P1)]);
  refused(() => play(g.engine, P1, g.id("w")), "4 resources can't pay cost 5", /Costs cannot be paid/);
  assert.equal(zoneOf(g.engine, g.id("w")), "hand");
  assert.equal(readyCount(g.engine, P1), 4, "nothing was paid");
});

clause(WASTE, "0:unique", "[V][V][V]: three Volition among five resources deploys; two Volition (and three Rage) is one icon short", () => {
  const ok = handBoard([...volition(3, P1), ...bank("rage", 2, P1)]);
  play(ok.engine, P1, ok.id("w"));
  assert.equal(zoneOf(ok.engine, ok.id("w")), "play");
  const short = handBoard([...volition(2, P1), ...bank("rage", 3, P1)]);
  refused(() => play(short.engine, P1, short.id("w")), "only two Volition icons", /Threshold requirements/);
  assert.equal(zoneOf(short.engine, short.id("w")), "hand");
  assert.equal(readyCount(short.engine, P1), 5, "nothing paid");
});

clause(WASTE, "0:unique", "[V][V][V] counts spent Volition: 3 spent Volition + 5 ready Rage pays cost 5 and spends exactly 5", () => {
  const spentVol = volition(3, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  const g = handBoard([...spentVol, ...bank("rage", 6, P1)]);
  assert.equal(readyCount(g.engine, P1), 6);
  play(g.engine, P1, g.id("w"));
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(readyCount(g.engine, P1), 1);
});

clause(WASTE, "0:unique", "controlling a second Wasteland makes you keep one: choosing the new one destroys the old one", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "w", def: printing(WASTE), owner: P1, zone: "play" },
      { key: "w2", def: printing(WASTE), owner: P1, zone: "hand" },
      ...volition(5, P1)
    ]
  });
  play(g.engine, P1, g.id("w2"));
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [g.id("w"), g.id("w2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("w2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("w2")), "play");
  assert.equal(zoneOf(g.engine, g.id("w")), "discard");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(WASTE, "0:unique", "choosing the old Wasteland keeps it and destroys the new one", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "w", def: printing(WASTE), owner: P1, zone: "play" },
      { key: "w2", def: printing(WASTE), owner: P1, zone: "hand" },
      ...volition(5, P1)
    ]
  });
  play(g.engine, P1, g.id("w2"));
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("w") } } as never);
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(zoneOf(g.engine, g.id("w2")), "discard");
});

clause(WASTE, "0:unique", "UNIQUE is per player: the opponent may control their own Wasteland with no choice and no destruction", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "w", def: printing(WASTE), owner: P1, zone: "play" },
      { key: "w2", def: printing(WASTE), owner: P2, zone: "hand" },
      ...volition(5, P2)
    ]
  });
  play(g.engine, P2, g.id("w2"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(zoneOf(g.engine, g.id("w2")), "play");
});

clause(WASTE, "0:unique", "a location with a different UNIQUE designation is not a duplicate", () => {
  const g = wboard([{ key: "o", def: location({ name: "Other", unique: "other place" } as never), owner: P1, zone: "play" }]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(zoneOf(g.engine, g.id("o")), "play");
});

// -- rule 1: retaliate -------------------------------------------------------

const attacker = (name = "Atk", strength = 3) => character({ name, strength, life: 5, speed: 3 });
const zapper = (name: string, targetType: "location" | "character" = "location") =>
  character({
    name,
    strength: 1,
    life: 5,
    speed: 1,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: targetType }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });

clause(WASTE, "1:rule", "a character that attacks and inflicts damage to Wasteland is destroyed", () => {
  const g = wboard([{ key: "atk", def: attacker(), owner: P2, zone: "play" }], { turn: 2, active: P2 });
  assert.equal(zoneOf(g.engine, g.id("atk")), "play");
  fightThrough(g.engine, P2, [g.id("atk")], { type: "card", cardId: g.id("w") }, []);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard", "the damaging character is destroyed");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(WASTE, "1:rule", "only the character that inflicted the damage is destroyed: a bystander character of the same player stays", () => {
  const g = wboard(
    [
      { key: "atk", def: attacker(), owner: P2, zone: "play" },
      { key: "bystander", def: attacker("Bystander"), owner: P2, zone: "play" },
      { key: "mine", def: attacker("Mine"), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  fightThrough(g.engine, P2, [g.id("atk")], { type: "card", cardId: g.id("w") }, []);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard");
  assert.equal(zoneOf(g.engine, g.id("bystander")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
});

clause(WASTE, "1:rule", "two characters that both inflict damage to Wasteland are both destroyed", () => {
  const g = wboard(
    [
      { key: "a1", def: attacker("A1", 2), owner: P2, zone: "play" },
      { key: "a2", def: attacker("A2", 2), owner: P2, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  g.engine.state.cards[g.id("w")].damage = 0;
  fightThrough(g.engine, P2, [g.id("a1"), g.id("a2")], { type: "card", cardId: g.id("w") }, []);
  assert.equal(zoneOf(g.engine, g.id("a1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("a2")), "discard");
});

clause(WASTE, "1:rule", "an attacker that does not inflict damage to Wasteland (it attacks the faction) is not destroyed", () => {
  const g = wboard([{ key: "atk", def: attacker(), owner: P2, zone: "play" }], { turn: 2, active: P2 });
  fightThrough(g.engine, P2, [g.id("atk")], { type: "faction", playerId: P1 }, []);
  assert.equal(zoneOf(g.engine, g.id("atk")), "play");
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
  assert.equal(g.engine.state.cards[g.id("w")].damage, 0);
});

clause(WASTE, "1:rule", "damage the attacker deals to a blocker instead of Wasteland does not destroy it", () => {
  const g = wboard(
    [
      { key: "atk", def: attacker(), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 0, life: 9, speed: 1 }), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  fightThrough(g.engine, P2, [g.id("atk")], { type: "card", cardId: g.id("w") }, [g.id("blk")]);
  assert.equal(zoneOf(g.engine, g.id("atk")), "play", "the blocked attacker never damaged Wasteland");
  assert.equal(g.engine.state.cards[g.id("blk")].damage, 3);
  assert.equal(g.engine.state.cards[g.id("w")].damage, 0);
});

clause(WASTE, "1:rule", "a character's ability that inflicts damage to Wasteland destroys that character (opponent's)", () => {
  const g = wboard([{ key: "z", def: zapper("Zap"), owner: P2, zone: "play" }, { key: "z2", def: zapper("Zap2"), owner: P2, zone: "play" }], { turn: 2, active: P2 });
  activate(g.engine, P2, g.id("z"), "zap", { selected: { t: [g.id("w")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("z")), "discard");
  assert.equal(zoneOf(g.engine, g.id("z2")), "play", "a character that did not damage it stays");
});

clause(WASTE, "1:rule", "it is any character, not just the opponent's: your own character inflicting damage is destroyed too", () => {
  const g = wboard([{ key: "z", def: zapper("Zap"), owner: P1, zone: "play" }]);
  activate(g.engine, P1, g.id("z"), "zap", { selected: { t: [g.id("w")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("z")), "discard");
});

clause(WASTE, "1:rule", "damage inflicted by a non-character (a tactic) does not destroy any character", () => {
  const hit = tactic({
    name: "Hit",
    cost: 0,
    behavior: { abilities: [{ id: "h", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
  });
  const g = wboard(
    [
      { key: "hit", def: hit, owner: P2, zone: "hand" },
      { key: "c2", def: attacker("Any"), owner: P2, zone: "play" },
      { key: "c1", def: attacker("Mine"), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  play(g.engine, P2, g.id("hit"), { selected: { t: [g.id("w")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("w")), "discard", "the tactic really damaged Wasteland (1 damage vs structure 1)");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
  assert.equal(zoneOf(g.engine, g.id("c1")), "play");
});

clause(WASTE, "1:rule", "damage inflicted by an item's ability is not damage by a character: the item is not destroyed", () => {
  const zapItem = item({
    name: "ZapItem",
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }]
        }
      ]
    }
  });
  const g = wboard([{ key: "zi", def: zapItem, owner: P2, zone: "play" }], { turn: 2, active: P2 });
  activate(g.engine, P2, g.id("zi"), "zap", { selected: { t: [g.id("w")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("w")), "discard", "the item really damaged Wasteland (1 vs structure 1)");
  assert.equal(zoneOf(g.engine, g.id("zi")), "play");
});

clause(WASTE, "1:rule", "a character damaging another location is not punished (only damage inflicted to Wasteland counts)", () => {
  const g = wboard(
    [
      { key: "z", def: zapper("Zap"), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "Elsewhere", structure: 5 }), owner: P1, zone: "play" }
    ],
    { turn: 2, active: P2 }
  );
  activate(g.engine, P2, g.id("z"), "zap", { selected: { t: [g.id("loc")] } });
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.cards[g.id("loc")].damage, 1);
  assert.equal(zoneOf(g.engine, g.id("z")), "play");
});

// -- rule 2: erode -----------------------------------------------------------

clause(WASTE, "2:rule", "at the start of your turn a token is put on it, and only then: none on its controller's end of turn, none on the opponent's turn", () => {
  const g = wboard();
  assert.equal(tokensOn(g.engine, g.id("w")), 0);
  endTurn(g.engine, P1);
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tokensOn(g.engine, g.id("w")), 0, "the opponent's turn start adds nothing");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(tokensOn(g.engine, g.id("w")), 1, "your turn start adds one token");
});

clause(WASTE, "2:rule", "one token per turn start: a second of your turns makes it 2", () => {
  const g = wboard();
  for (let i = 0; i < 2; i++) {
    endTurn(g.engine, P1);
    drain(g.engine, declineAll);
    endTurn(g.engine, P2);
    drain(g.engine, declineAll);
  }
  assert.equal(tokensOn(g.engine, g.id("w")), 2);
  assert.equal(zoneOf(g.engine, g.id("w")), "play", "2 tokens do not void anything");
});

clause(WASTE, "2:rule", "'your turn' follows the controller: a Wasteland you control but the opponent owns gets its token at your turn start, not the owner's", () => {
  const g = wboard([], { owner: P2, controller: P1 });
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(tokensOn(g.engine, g.id("w")), 0, "the owner's turn start adds nothing");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(tokensOn(g.engine, g.id("w")), 1, "the controller's turn start does");
});

clause(WASTE, "2:rule", "an opponent-controlled Wasteland gets its token at THAT player's turn start", () => {
  const g = wboard([], { owner: P1, controller: P2 });
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  assert.equal(tokensOn(g.engine, g.id("w")), 1, "P2 controls it, so P2's turn start adds the token");
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
  assert.equal(tokensOn(g.engine, g.id("w")), 1, "P1's turn start (not the controller) adds nothing");
});

// -- rule 3: void all non-resource cards ------------------------------------------------

const voidBoard = (counters: Record<string, number>) =>
  wboard(
    [
      { key: "c1", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "i1", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "l1", def: location({ name: "MyLoc" }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "TheirChar" }), owner: P2, zone: "play" },
      { key: "l2", def: location({ name: "TheirLoc" }), owner: P2, zone: "play" },
      { key: "i2", def: item({ name: "TheirItem" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FaceDownChar" }), owner: P1, zone: "play", faceDown: true },
      { key: "res", def: resourceCard({ name: "RealRes" }), owner: P1, zone: "play" },
      { key: "res2", def: resourceCard({ name: "TheirRes" }), owner: P2, zone: "play" },
      { key: "h1", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "dk1", def: character({ name: "InDeck" }), owner: P1, zone: "deck" },
      { key: "dc1", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" }
    ],
    { counters }
  );

const turnToP1 = (g: ReturnType<typeof wboard>): void => {
  endTurn(g.engine, P1);
  drain(g.engine, declineAll);
  endTurn(g.engine, P2);
  drain(g.engine, declineAll);
};

clause(WASTE, "3:rule", "the third token voids every non-resource card in play, for both players, and Wasteland itself", () => {
  const g = voidBoard({ token: 2 });
  turnToP1(g);
  for (const k of ["c1", "i1", "l1", "c2", "l2", "i2", "w"]) assert.equal(zoneOf(g.engine, g.id(k)), "void", `${k} is voided`);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(WASTE, "3:rule", "resources stay: a real resource card, the opponent's resource and a face-down card (a resource) are not voided", () => {
  const g = voidBoard({ token: 2 });
  turnToP1(g);
  for (const k of ["res", "res2", "fd"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} stays`);
});

clause(WASTE, "3:rule", "factions are not voided", () => {
  const g = voidBoard({ token: 2 });
  turnToP1(g);
  assert.equal(zoneOf(g.engine, faction(g.engine, P1)), "play");
  assert.equal(zoneOf(g.engine, faction(g.engine, P2)), "play");
  assert.equal(g.engine.state.result, undefined);
});

clause(WASTE, "3:rule", "cards in hand, deck and discard are not voided (the effect is on cards in play)", () => {
  const g = voidBoard({ token: 2 });
  turnToP1(g);
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand");
  assert.equal(zoneOf(g.engine, g.id("dk1")), "deck");
  assert.equal(zoneOf(g.engine, g.id("dc1")), "discard");
});

clause(WASTE, "3:rule", "with only 2 tokens after the turn start (1 before) nothing is voided", () => {
  const g = voidBoard({ token: 1 });
  turnToP1(g);
  assert.equal(tokensOn(g.engine, g.id("w")), 2);
  for (const k of ["c1", "i1", "l1", "c2", "l2", "i2", "w"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} stays`);
});

clause(WASTE, "3:rule", "'at least 3': from 3 tokens the next token (4) voids too", () => {
  const g = voidBoard({ token: 3 });
  assert.equal(zoneOf(g.engine, g.id("c1")), "play", "3 preset tokens alone void nothing: the condition is checked when tokens change");
  turnToP1(g);
  for (const k of ["c1", "c2", "w"]) assert.equal(zoneOf(g.engine, g.id(k)), "void", `${k} voided at 4 tokens`);
});

clause(WASTE, "3:rule", "reaching 3 tokens by any means voids at once, not only at a turn start (another effect adds the third)", () => {
  const adder = character({
    name: "Adder",
    behavior: {
      abilities: [
        {
          id: "add",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
  const g = wboard(
    [
      { key: "adder", def: adder, owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "TheirChar" }), owner: P2, zone: "play" }
    ],
    { counters: { token: 1 } }
  );
  activate(g.engine, P1, g.id("adder"), "add", { selected: { t: [g.id("w")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("c2")), "play", "2 tokens: still nothing");
  g.engine.state.cards[g.id("adder")].depleted = false;
  activate(g.engine, P1, g.id("adder"), "add", { selected: { t: [g.id("w")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("c2")), "void", "the third token voided it");
  assert.equal(zoneOf(g.engine, g.id("adder")), "void");
  assert.equal(zoneOf(g.engine, g.id("w")), "void");
});

clause(WASTE, "3:rule", "a token landing on ANOTHER card never triggers it, even while Wasteland already holds 3 tokens", () => {
  const adder = character({
    name: "Adder",
    behavior: {
      abilities: [
        {
          id: "add",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
  const g = wboard(
    [
      { key: "adder", def: adder, owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "TheirChar" }), owner: P2, zone: "play" }
    ],
    { counters: { token: 3 } }
  );
  activate(g.engine, P1, g.id("adder"), "add", { selected: { t: [g.id("c2")] } });
  drain(g.engine, declineAll);
  assert.equal(tokensOn(g.engine, g.id("c2")), 1, "the token really landed on the other card");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
  assert.equal(zoneOf(g.engine, g.id("adder")), "play");
  assert.equal(zoneOf(g.engine, g.id("w")), "play");
});

clause(WASTE, "3:rule", "tokens on other cards don't count: a character with 3 tokens and a Wasteland with 0 voids nothing", () => {
  const g = wboard(
    [
      { key: "c1", def: character({ name: "Loaded" }), owner: P1, zone: "play", counters: { token: 3 } },
      { key: "c2", def: character({ name: "TheirChar" }), owner: P2, zone: "play" }
    ]
  );
  turnToP1(g);
  assert.equal(tokensOn(g.engine, g.id("w")), 1);
  assert.equal(zoneOf(g.engine, g.id("c1")), "play");
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
});

clause(WASTE, "3:rule", "from empty it takes three of your turn starts to void everything (1 and 2 tokens do nothing, the third voids)", () => {
  const g = voidBoard({});
  turnToP1(g);
  turnToP1(g);
  assert.equal(tokensOn(g.engine, g.id("w")), 2);
  assert.equal(zoneOf(g.engine, g.id("c2")), "play");
  turnToP1(g);
  assert.equal(zoneOf(g.engine, g.id("c2")), "void");
  assert.equal(zoneOf(g.engine, g.id("c1")), "void");
  assert.equal(zoneOf(g.engine, g.id("res")), "play");
});

// ============================================================================
// Zenobia's Succor -- tactic, cost 2, no threshold; icon-gated modes
// ============================================================================

interface ZOpts {
  res?: CardPlacement[];
  scAttack?: boolean;
}
const zboard = (o: ZOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "zs", def: printing(SUCCOR), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Mine", strength: 2, life: 3, speed: 2, cost: 2 }), owner: P1, zone: "play", attackEligible: false },
      { key: "oc", def: character({ name: "Theirs", strength: 2, life: 3, speed: 2, cost: 2 }), owner: P2, zone: "play", attackEligible: false },
      { key: "it", def: item({ name: "AnItem" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "ALoc" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      ...(o.res ?? [])
    ]
  });

type ZGame = ReturnType<typeof zboard>;
const stats = (g: ZGame, k: string) => ({
  strength: g.engine.getStat(g.id(k), "strength"),
  life: g.engine.getStat(g.id(k), "life"),
  speed: g.engine.getStat(g.id(k), "speed")
});
const BASE = { strength: 2, life: 3, speed: 2 };

clause(SUCCOR, "0:extraCost", "printed as a universal tactic with cost 2 and no threshold: exactly 2 resources pay it (one is spent... both)", () => {
  const g = zboard({ res: bank("rage", 3, P1) });
  const def = g.engine.getDefinition(g.id("zs"));
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "universal");
  play(g.engine, P1, g.id("zs"), { mode: 4, selected: { c: [g.id("c")] } });
  assert.equal(zoneOf(g.engine, g.id("zs")), "discard");
  assert.equal(readyCount(g.engine, P1), 1, "cost 2 paid: of 3 resources 1 stays ready");
});

clause(SUCCOR, "0:extraCost", "one resource short of cost 2 refuses it, even with the right icon", () => {
  const g = zboard({ res: bank("rage", 1, P1) });
  refused(() => play(g.engine, P1, g.id("zs"), { mode: 4, selected: { c: [g.id("c")] } }), "1 resource can't pay 2", /Costs cannot be paid/);
  assert.equal(zoneOf(g.engine, g.id("zs")), "hand");
  assert.equal(readyCount(g.engine, P1), 1);
  assert.deepEqual(stats(g, "c"), BASE);
});

clause(SUCCOR, "0:extraCost", "'Pick a character' is required: playing without a pick is refused and nothing is paid", () => {
  const g = zboard({ res: bank("rage", 2, P1) });
  refused(() => play(g.engine, P1, g.id("zs"), { mode: 4 }), "no character picked", /requires 1 selection/);
  assert.equal(zoneOf(g.engine, g.id("zs")), "hand");
  assert.equal(readyCount(g.engine, P1), 2);
});

clause(SUCCOR, "0:extraCost", "the pick may be any character in play, yours or the opponent's", () => {
  const g = zboard({ res: bank("rage", 4, P1) });
  play(g.engine, P1, g.id("zs"), { mode: 4, selected: { c: [g.id("oc")] } });
  assert.equal(g.engine.getStat(g.id("oc"), "strength"), 4);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 2);
});

clause(SUCCOR, "0:extraCost", "only a character can be picked in every mode: an item, a location, a character in hand, and a faction are refused (positive control: a character in play)", () => {
  const icons = ["obsession", "greed", "elitism", "deception", "rage"] as const;
  for (let mode = 0; mode < 5; mode++) {
    for (const bad of ["it", "loc", "hc"]) {
      const g = zboard({ res: bank(icons[mode], 2, P1) });
      refused(() => play(g.engine, P1, g.id("zs"), { mode, selected: { c: [g.id(bad)] } }), `mode ${mode}: ${bad} is not a character in play`, /Illegal target/);
      assert.equal(zoneOf(g.engine, g.id("zs")), "hand");
      assert.equal(readyCount(g.engine, P1), 2, "nothing paid");
    }
    const f = zboard({ res: bank(icons[mode], 2, P1) });
    refused(() => play(f.engine, P1, f.id("zs"), { mode, selected: { c: [faction(f.engine, P1)] } }), `mode ${mode}: a faction is not a character`, /Illegal target/);
    const ok = zboard({ res: bank(icons[mode], 2, P1) });
    play(ok.engine, P1, ok.id("zs"), { mode, selected: { c: [ok.id("c")] } });
    assert.equal(zoneOf(ok.engine, ok.id("zs")), "discard", `mode ${mode} control`);
  }
});

const MODES: Array<{ key: string; mode: number; icon: "obsession" | "greed" | "elitism" | "deception" | "rage"; other: "obsession" | "greed" | "elitism" | "deception" | "rage" }> = [
  { key: "1:rule@o", mode: 0, icon: "obsession", other: "rage" },
  { key: "2:rule@g", mode: 1, icon: "greed", other: "rage" },
  { key: "3:rule@e", mode: 2, icon: "elitism", other: "rage" },
  { key: "4:rule@d", mode: 3, icon: "deception", other: "rage" },
  { key: "5:rule@r", mode: 4, icon: "rage", other: "greed" }
];

const withIcon = (m: (typeof MODES)[number], n = 2) => zboard({ res: bank(m.icon, n, P1) });

function modeGate(m: (typeof MODES)[number]): void {
  const no = zboard({ res: bank(m.other, 3, P1) });
  refused(() => play(no.engine, P1, no.id("zs"), { mode: m.mode, selected: { c: [no.id("c")] } }), `without ${m.icon} the mode is unavailable`, /cannot be deployed right now/);
  assert.equal(zoneOf(no.engine, no.id("zs")), "hand");
  assert.equal(readyCount(no.engine, P1), 3, "nothing paid");
  // One icon among the cost: works (3 resources, 1 of the icon).
  const yes = zboard({ res: [...bank(m.icon, 1, P1), ...bank(m.other, 2, P1)] });
  play(yes.engine, P1, yes.id("zs"), { mode: m.mode, selected: { c: [yes.id("c")] } });
  assert.equal(zoneOf(yes.engine, yes.id("zs")), "discard");
  assert.equal(readyCount(yes.engine, P1), 1);
}

// [O] COVERT
clause(SUCCOR, "1:rule@o", "[O]: the picked character gains COVERT this turn (and nothing else changes; the other character does not)", () => {
  const g = withIcon(MODES[0]);
  assert.equal(g.engine.getKeywords(g.id("c")).includes("covert"), false);
  play(g.engine, P1, g.id("zs"), { mode: 0, selected: { c: [g.id("c")] } });
  assert.equal(g.engine.getKeywords(g.id("c")).includes("covert"), true);
  assert.equal(g.engine.getKeywords(g.id("oc")).includes("covert"), false);
  assert.deepEqual(stats(g, "c"), BASE);
  assert.equal(g.engine.getKeywords(g.id("c")).includes("aggro"), false);
  assert.equal(readyCount(g.engine, P1), 0);
});
clause(SUCCOR, "1:rule@o", "[O]: COVERT also lands on the opponent's character, and ends with the turn", () => {
  const g = withIcon(MODES[0]);
  play(g.engine, P1, g.id("zs"), { mode: 0, selected: { c: [g.id("oc")] } });
  assert.equal(g.engine.getKeywords(g.id("oc")).includes("covert"), true);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getKeywords(g.id("oc")).includes("covert"), false, "'this turn' ends");
  endTurn(g.engine, P2);
  assert.equal(g.engine.getKeywords(g.id("oc")).includes("covert"), false);
});
clause(SUCCOR, "1:rule@o", "[O]: the mode needs [O]; one [O] among the cost works", () => modeGate(MODES[0]));
clause(SUCCOR, "1:rule@o", "[O]: the granted COVERT is real: a covert attacker can't be blocked by an ordinary character", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "zs", def: printing(SUCCOR), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...bank("obsession", 2, P1)
    ]
  });
  play(g.engine, P1, g.id("zs"), { mode: 0, selected: { c: [g.id("c")] } });
  declareAttackBy(g.engine, P1, [g.id("c")]);
  refused(() => g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [g.id("blk")] }), "ordinary can't block covert", /covert/i);
});

// [G] +2 life
clause(SUCCOR, "2:rule@g", "[G]: the picked character gains 2 life this turn (3 -> 5); strength and speed unchanged, the other character unaffected", () => {
  const g = withIcon(MODES[1]);
  play(g.engine, P1, g.id("zs"), { mode: 1, selected: { c: [g.id("c")] } });
  assert.deepEqual(stats(g, "c"), { strength: 2, life: 5, speed: 2 });
  assert.deepEqual(stats(g, "oc"), BASE);
  assert.equal(g.engine.getKeywords(g.id("c")).includes("covert"), false);
  assert.equal(readyCount(g.engine, P1), 0);
});
clause(SUCCOR, "2:rule@g", "[G]: the +2 life holds the character up (damage 4 on life 5 survives) and also works on the opponent's character; it ends with the turn", () => {
  const g = zboard({ res: bank("greed", 2, P1) });
  g.engine.state.cards[g.id("oc")].damage = 2;
  assert.equal(g.engine.getStat(g.id("oc"), "life"), 3, "setup: life 3");
  play(g.engine, P1, g.id("zs"), { mode: 1, selected: { c: [g.id("oc")] } });
  assert.equal(g.engine.getStat(g.id("oc"), "life"), 5);
  // 4 damage would be lethal on life 3 (a character with damage >= life is destroyed); on the boosted life 5 it holds.
  g.engine.state.cards[g.id("oc")].damage = 4;
  (g.engine as unknown as { checkStateBasedActions(): void }).checkStateBasedActions();
  assert.equal(zoneOf(g.engine, g.id("oc")), "play", "4 damage vs 5 life");
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("oc"), "life"), 3, "'this turn' ends");
});
clause(SUCCOR, "2:rule@g", "[G]: the mode needs [G]; one [G] among the cost works", () => modeGate(MODES[1]));

// [E] AGGRO
clause(SUCCOR, "3:rule@e", "[E]: the picked character gains AGGRO this turn, which is real: it can attack the turn it entered; without it, it can't", () => {
  const ctl = zboard({ res: bank("elitism", 2, P1) });
  refused(() => declareAttackBy(ctl.engine, P1, [ctl.id("c")]), "control: summoning-sick without AGGRO", /does not have AGGRO/);
  const g = zboard({ res: bank("elitism", 2, P1) });
  assert.equal(g.engine.getKeywords(g.id("c")).includes("aggro"), false);
  play(g.engine, P1, g.id("zs"), { mode: 2, selected: { c: [g.id("c")] } });
  assert.equal(g.engine.getKeywords(g.id("c")).includes("aggro"), true);
  assert.equal(g.engine.getKeywords(g.id("oc")).includes("aggro"), false);
  assert.deepEqual(stats(g, "c"), BASE);
  declareAttackBy(g.engine, P1, [g.id("c")]);
  assert.ok(g.engine.state.battle, "it attacked");
});
clause(SUCCOR, "3:rule@e", "[E]: AGGRO lands on the opponent's character too, and ends with the turn", () => {
  const g = zboard({ res: bank("elitism", 2, P1) });
  play(g.engine, P1, g.id("zs"), { mode: 2, selected: { c: [g.id("oc")] } });
  assert.equal(g.engine.getKeywords(g.id("oc")).includes("aggro"), true);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getKeywords(g.id("oc")).includes("aggro"), false);
});
clause(SUCCOR, "3:rule@e", "[E]: the mode needs [E]; one [E] among the cost works", () => modeGate(MODES[2]));

// [D] +1 speed
clause(SUCCOR, "4:rule@d", "[D]: the picked character gains 1 speed this turn (2 -> 3); strength and life unchanged, the other character unaffected", () => {
  const g = withIcon(MODES[3]);
  play(g.engine, P1, g.id("zs"), { mode: 3, selected: { c: [g.id("c")] } });
  assert.deepEqual(stats(g, "c"), { strength: 2, life: 3, speed: 3 });
  assert.deepEqual(stats(g, "oc"), BASE);
  assert.equal(readyCount(g.engine, P1), 0);
});
clause(SUCCOR, "4:rule@d", "[D]: +1 speed also works on the opponent's character and ends with the turn", () => {
  const g = withIcon(MODES[3]);
  play(g.engine, P1, g.id("zs"), { mode: 3, selected: { c: [g.id("oc")] } });
  assert.equal(g.engine.getStat(g.id("oc"), "speed"), 3);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("oc"), "speed"), 2);
});
clause(SUCCOR, "4:rule@d", "[D]: the mode needs [D]; one [D] among the cost works", () => modeGate(MODES[3]));

// [R] +2 strength
clause(SUCCOR, "5:rule@r", "[R]: the picked character gains 2 strength this turn (2 -> 4); life and speed unchanged, the other character unaffected", () => {
  const g = withIcon(MODES[4]);
  play(g.engine, P1, g.id("zs"), { mode: 4, selected: { c: [g.id("c")] } });
  assert.deepEqual(stats(g, "c"), { strength: 4, life: 3, speed: 2 });
  assert.deepEqual(stats(g, "oc"), BASE);
  assert.equal(readyCount(g.engine, P1), 0);
});
clause(SUCCOR, "5:rule@r", "[R]: +2 strength also works on the opponent's character and ends with the turn", () => {
  const g = withIcon(MODES[4]);
  play(g.engine, P1, g.id("zs"), { mode: 4, selected: { c: [g.id("oc")] } });
  assert.equal(g.engine.getStat(g.id("oc"), "strength"), 4);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("oc"), "strength"), 2);
  endTurn(g.engine, P2);
  assert.equal(g.engine.getStat(g.id("oc"), "strength"), 2);
});
clause(SUCCOR, "5:rule@r", "[R]: the mode needs [R]; one [R] among the cost works", () => modeGate(MODES[4]));
clause(SUCCOR, "5:rule@r", "with several icons available only the chosen mode applies (e.g. [R] with [O] present: +2 strength, no COVERT)", () => {
  const g = zboard({ res: [...bank("obsession", 1, P1), ...bank("rage", 1, P1)] });
  play(g.engine, P1, g.id("zs"), { mode: 4, selected: { c: [g.id("c")] } });
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 4);
  assert.equal(g.engine.getKeywords(g.id("c")).includes("covert"), false);
});

// ============================================================================
// Abusive Major General -- character, cost 4 [R][R][R][R], 3/4/4, soldier tyrant
// ============================================================================

const mgHand = (res: CardPlacement[]) =>
  buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "mg", def: printing(MAJOR), owner: P1, zone: "hand" }, ...res]
  });

clause(MAJOR, "0:ability:bleed", "printed as a Warlord soldier tyrant with cost 4 [R][R][R][R], strength 3 / speed 4 / life 4", () => {
  const g = mgHand(bank("rage", 4, P1));
  const d = g.engine.getDefinition(g.id("mg"));
  assert.equal(d.type, "character");
  assert.equal(d.trade, "warlord");
  assert.deepEqual([...(d.subtype ?? [])].sort(), ["soldier", "tyrant"]);
  play(g.engine, P1, g.id("mg"));
  assert.equal(zoneOf(g.engine, g.id("mg")), "play");
  assert.equal(readyCount(g.engine, P1), 0);
  assert.equal(g.engine.getStat(g.id("mg"), "strength"), 3);
  assert.equal(g.engine.getStat(g.id("mg"), "speed"), 4);
  assert.equal(g.engine.getStat(g.id("mg"), "life"), 4);
});

clause(MAJOR, "0:ability:bleed", "cost 4 is separate from the [R][R][R][R] threshold: 4 spent Rage + 4 ready Greed pays exactly 4, 3 ready Greed is one short", () => {
  const ok = mgHand([...spentResources(P1, 4), ...bank("greed", 4, P1)]);
  assert.equal(readyCount(ok.engine, P1), 4);
  play(ok.engine, P1, ok.id("mg"));
  assert.equal(zoneOf(ok.engine, ok.id("mg")), "play");
  assert.equal(readyCount(ok.engine, P1), 0);
  const short = mgHand([...spentResources(P1, 4), ...bank("greed", 3, P1)]);
  refused(() => play(short.engine, P1, short.id("mg")), "3 ready resources can't pay 4", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("mg")), "hand");
  assert.equal(readyCount(short.engine, P1), 3);
});

clause(MAJOR, "0:ability:bleed", "threshold [R][R][R][R]: 3 Rage + 1 Greed (4 resources) is one icon short; 4 Rage works", () => {
  const short = mgHand([...bank("rage", 3, P1), ...bank("greed", 1, P1)]);
  refused(() => play(short.engine, P1, short.id("mg")), "only three [R]", /Threshold requirements/);
  assert.equal(zoneOf(short.engine, short.id("mg")), "hand");
  assert.equal(readyCount(short.engine, P1), 4);
  const ok = mgHand(bank("rage", 4, P1));
  play(ok.engine, P1, ok.id("mg"));
  assert.equal(zoneOf(ok.engine, ok.id("mg")), "play");
});

interface BleedOpts {
  res?: CardPlacement[];
  oppRes?: CardPlacement[];
}
const bleedBoard = (o: BleedOpts = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "mg", def: printing(MAJOR), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 3 }), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 6, speed: 3 }), owner: P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", life: 6 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 6 }), owner: P1, zone: "play" },
      ...(o.res ?? bank("rage", 3, P1)),
      ...(o.oppRes ?? [])
    ]
  });
type BG = ReturnType<typeof bleedBoard>;
const rawBleed = (g: BG, pick: string, player: PlayerId = P1): void =>
  g.engine.perform({ type: "activateAbility", playerId: player, cardId: g.id("mg"), abilityId: "bleed", selected: { c: [g.id(pick)] }, variables: {} } as never);
const bleed = (g: BG, pick: string): void => {
  rawBleed(g, pick);
  resolvePendingResponses(g.engine);
};
const startBattle = (g: BG, withBlock = false): void => {
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  if (withBlock) {
    resolvePendingResponses(g.engine);
    g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("blk")] });
    g.engine.perform({ type: "passPriority", playerId: P2 });
  }
};
const resourcesOf = (g: BG, p: PlayerId) => g.engine.state.players[p].play.filter((id) => g.engine.isResource(id) && g.engine.state.cards[id].attachedTo === faction(g.engine, p) || (g.engine.isResource(id) && g.engine.state.cards[id].controllerId === p));

clause(MAJOR, "0:ability:bleed", "EFFECT: inflicts exactly 2 damage to the picked attacking character", () => {
  const g = bleedBoard();
  startBattle(g);
  bleed(g, "atk");
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 2);
  assert.equal(zoneOf(g.engine, g.id("atk")), "play");
});

clause(MAJOR, "0:ability:bleed", "the pick may be a blocking character (either side's), in battle", () => {
  const g = bleedBoard();
  startBattle(g, true);
  bleed(g, "blk");
  assert.equal(g.engine.state.cards[g.id("blk")].damage, 2);
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 0);
});

clause(MAJOR, "0:ability:bleed", "2 damage destroys a character with 2 life, but not one with 3", () => {
  const dead = bleedBoard();
  dead.engine.state.cards[dead.id("atk")].damage = 4;
  startBattle(dead);
  bleed(dead, "atk");
  assert.equal(zoneOf(dead.engine, dead.id("atk")), "discard", "life 6, 4 + 2 = lethal");
  const alive = bleedBoard();
  alive.engine.state.cards[alive.id("atk")].damage = 3;
  startBattle(alive);
  bleed(alive, "atk");
  assert.equal(zoneOf(alive.engine, alive.id("atk")), "play", "3 + 2 = 5 < 6");
  assert.equal(alive.engine.state.cards[alive.id("atk")].damage, 5);
});

clause(MAJOR, "0:ability:bleed", "it can pick Abusive Major General itself when it is in the battle", () => {
  const g = bleedBoard();
  g.engine.state.cards[g.id("mg")].damage = 0;
  declareAttackOpenWindow(g.engine, P2, [g.id("atk")]);
  resolvePendingResponses(g.engine);
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [g.id("mg")] });
  g.engine.perform({ type: "passPriority", playerId: P2 });
  bleed(g, "mg");
  assert.equal(g.engine.state.cards[g.id("mg")].damage, 2);
});

clause(MAJOR, "0:ability:bleed", "COST: destroys a resource you control (one, to its owner's discard), and no other card", () => {
  const g = bleedBoard();
  startBattle(g);
  const before = g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id));
  assert.equal(before.length, 3);
  bleed(g, "atk");
  const after = g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id));
  assert.equal(after.length, 2, "exactly one resource destroyed");
  const gone = before.filter((id) => !after.includes(id));
  assert.equal(gone.length, 1);
  assert.equal(zoneOf(g.engine, gone[0]), "discard");
  assert.equal(zoneOf(g.engine, g.id("mg")), "play");
  assert.equal(zoneOf(g.engine, faction(g.engine, P1)), "play");
});

clause(MAJOR, "0:ability:bleed", "the cost is paid on activation, not at resolution (the resource is already gone while the ability waits)", () => {
  const g = bleedBoard();
  startBattle(g);
  rawBleed(g, "atk");
  const left = g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id));
  assert.equal(left.length, 2, "paid before resolution");
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 0, "effect not yet resolved");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 2);
});

clause(MAJOR, "0:ability:bleed", "the controller's resources only: the opponent's resources are never destroyed", () => {
  const g = bleedBoard({ res: bank("rage", 1, P1), oppRes: bank("greed", 4, P2) });
  startBattle(g);
  bleed(g, "atk");
  assert.equal(g.engine.state.players[P2].play.filter((id) => g.engine.isResource(id)).length, 4);
  assert.equal(g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id)).length, 0);
});

clause(MAJOR, "0:ability:bleed", "a face-down card is a resource you control and can be the destroyed one (only resource: it is destroyed)", () => {
  const g = bleedBoard({ res: volition(1, P1) });
  startBattle(g);
  const fd = g.engine.state.players[P1].play.find((id) => g.engine.isResource(id))!;
  bleed(g, "atk");
  assert.equal(zoneOf(g.engine, fd), "discard");
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 2);
});

clause(MAJOR, "0:ability:bleed", "no resource to destroy: the cost can't be paid, the ability is refused and nothing is damaged", () => {
  const g = bleedBoard({ res: [] });
  startBattle(g);
  refused(() => rawBleed(g, "atk"), "no resource to destroy", /Ability costs cannot be paid/);
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 0);
});

clause(MAJOR, "0:ability:bleed", "the controller chooses which resource is destroyed (a pick among their resources), not a random one", () => holdCostChoices(() => {
  const g = bleedBoard({ res: [...bank("rage", 1, P1), ...bank("greed", 1, P1), ...bank("elitism", 1, P1)] });
  startBattle(g);
  const before = g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id));
  rawBleed(g, "atk");
  const pc = pending(g.engine) as unknown as { playerId: PlayerId } | undefined;
  assert.ok(pc, "the controller is asked which resource to destroy");
  assert.equal(pc!.playerId, P1);
  assert.equal(before.length, 3);
}));

clause(MAJOR, "0:ability:bleed", "'Pick a character in battle': a character that is not in the battle is refused (positive control: attacker)", () => {
  for (const bad of ["bystander", "mine"]) {
    const g = bleedBoard();
    startBattle(g);
    refused(() => rawBleed(g, bad), `${bad} is not in the battle`, /Illegal target/);
    assert.equal(g.engine.state.cards[g.id(bad)].damage, 0);
    assert.equal(g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id)).length, 3, "no resource destroyed");
  }
  const ok = bleedBoard();
  startBattle(ok);
  bleed(ok, "atk");
  assert.equal(ok.engine.state.cards[ok.id("atk")].damage, 2);
});

clause(MAJOR, "0:ability:bleed", "a faction in the battle (the attack's target) is not a character: refused, no resource destroyed", () => {
  const g = bleedBoard();
  startBattle(g);
  refused(() => rawBleed(g, "mine"), "control-like: a non-battling character");
  const f = bleedBoard();
  startBattle(f);
  assert.equal(f.engine.state.battle?.target && (f.engine.state.battle.target as { type: string }).type, "faction");
  refused(() => f.engine.perform({ type: "activateAbility", playerId: P1, cardId: f.id("mg"), abilityId: "bleed", selected: { c: [faction(f.engine, P1)] }, variables: {} } as never), "a faction is not a character", /Illegal target/);
  assert.equal(f.engine.state.players[P1].play.filter((id) => f.engine.isResource(id)).length, 3);
});

clause(MAJOR, "0:ability:bleed", "outside any battle there is nothing to pick: refused, no resource destroyed", () => {
  const g = bleedBoard();
  refused(() => rawBleed(g, "atk"), "no battle", /current timing/);
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 0);
  assert.equal(g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id)).length, 3);
});

clause(MAJOR, "0:ability:bleed", "no deplete is part of the cost: a depleted Abusive Major General can still BLEED", () => {
  const g = bleedBoard();
  g.engine.state.cards[g.id("mg")].depleted = true;
  startBattle(g);
  bleed(g, "atk");
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 2);
});

clause(MAJOR, "0:ability:bleed", "it can be used again in the same battle, paying another resource each time", () => {
  const g = bleedBoard();
  startBattle(g);
  bleed(g, "atk");
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 2, "first BLEED resolved");
  g.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  g.engine.perform({ type: "passPriority", playerId: P2 });
  bleed(g, "atk");
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 4);
  assert.equal(g.engine.state.players[P1].play.filter((id) => g.engine.isResource(id)).length, 1);
});

clause(MAJOR, "0:ability:bleed", "only its controller can use it (the attacking player can't BLEED their opponent's General)", () => {
  const g = bleedBoard();
  startBattle(g);
  refused(() => rawBleed(g, "atk", P2), "not P2's card", /do not control/);
  assert.equal(g.engine.state.cards[g.id("atk")].damage, 0);
});

// ============================================================================
// Auditory Adulation -- tactic, cost 4 [R], FLIP UP 3 [R]
// ============================================================================

const aaHand = (res: CardPlacement[], extra: CardPlacement[] = []) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "aa", def: printing(ADUL), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Mine", strength: 2, life: 4, speed: 2, cost: 4 }), owner: P1, zone: "play" },
      { key: "oc", def: character({ name: "Theirs", strength: 1, life: 4, speed: 2, cost: 7 }), owner: P2, zone: "play" },
      { key: "zero", def: character({ name: "Free", strength: 1, life: 4, speed: 2, cost: 0 }), owner: P1, zone: "play" },
      { key: "it", def: item({ name: "AnItem" }), owner: P1, zone: "play" },
      ...res,
      ...extra
    ]
  });
type AG = ReturnType<typeof aaHand>;
const noRes = (pc: { kind: string }): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [] } : declineAll(pc as never));
const pickRes = (id: string) => (pc: { kind: string }): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id] } : declineAll(pc as never));

clause(ADUL, "0:extraCost", "printed as a Warlord tactic with cost 4 [R]: 4 Rage pays exactly 4", () => {
  const g = aaHand(bank("rage", 5, P1));
  const d = g.engine.getDefinition(g.id("aa"));
  assert.equal(d.type, "tactic");
  assert.equal(d.trade, "warlord");
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("c")] } });
  drain(g.engine, noRes);
  assert.equal(zoneOf(g.engine, g.id("aa")), "discard");
  assert.equal(readyCount(g.engine, P1), 1, "cost 4 paid out of 5");
});

clause(ADUL, "0:extraCost", "cost is separate from the threshold: 1 spent Rage + 4 ready Greed pays exactly 4; 3 ready Greed is one short; 4 Greed alone has no [R]", () => {
  const ok = aaHand([...spentResources(P1, 1), ...bank("greed", 4, P1)]);
  play(ok.engine, P1, ok.id("aa"), { selected: { c: [ok.id("c")] } });
  drain(ok.engine, noRes);
  assert.equal(zoneOf(ok.engine, ok.id("aa")), "discard");
  assert.equal(readyCount(ok.engine, P1), 0);
  const short = aaHand([...spentResources(P1, 1), ...bank("greed", 3, P1)]);
  refused(() => play(short.engine, P1, short.id("aa"), { selected: { c: [short.id("c")] } }), "one resource short", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("aa")), "hand");
  assert.equal(readyCount(short.engine, P1), 3);
  const noIcon = aaHand(bank("greed", 4, P1));
  refused(() => play(noIcon.engine, P1, noIcon.id("aa"), { selected: { c: [noIcon.id("c")] } }), "no [R]", /Threshold requirements/);
  assert.equal(zoneOf(noIcon.engine, noIcon.id("aa")), "hand");
  assert.equal(readyCount(noIcon.engine, P1), 4);
  const oneIcon = aaHand([...bank("rage", 1, P1), ...bank("greed", 3, P1)]);
  play(oneIcon.engine, P1, oneIcon.id("aa"), { selected: { c: [oneIcon.id("c")] } });
  drain(oneIcon.engine, noRes);
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("aa")), "discard");
});

clause(ADUL, "0:extraCost", "'Pick a character' is required: no pick is refused and nothing is paid", () => {
  const g = aaHand(bank("rage", 4, P1));
  refused(() => play(g.engine, P1, g.id("aa")), "no pick", /requires 1 selection/);
  assert.equal(zoneOf(g.engine, g.id("aa")), "hand");
  assert.equal(readyCount(g.engine, P1), 4);
});

clause(ADUL, "0:extraCost", "only a character can be picked (an item is refused), but it may be the opponent's", () => {
  const bad = aaHand(bank("rage", 4, P1));
  refused(() => play(bad.engine, P1, bad.id("aa"), { selected: { c: [bad.id("it")] } }), "an item is not a character", /Illegal target/);
  assert.equal(readyCount(bad.engine, P1), 4);
  const ok = aaHand(bank("rage", 4, P1));
  play(ok.engine, P1, ok.id("aa"), { selected: { c: [ok.id("oc")] } });
  drain(ok.engine, noRes);
  assert.equal(ok.engine.getStat(ok.id("oc"), "strength"), 1 + 7);
});

clause(ADUL, "0:extraCost", "'only not during a battle': it can't be deployed while a battle is in progress (control: the same board without a battle works)", () => {
  const mk = () =>
    aaHand(bank("rage", 4, P1), [{ key: "pt", def: character({ name: "Pt", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]);
  const ctl = mk();
  play(ctl.engine, P1, ctl.id("aa"), { selected: { c: [ctl.id("c")] } });
  drain(ctl.engine, noRes);
  assert.equal(zoneOf(ctl.engine, ctl.id("aa")), "discard");
  const g = mk();
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("c")], target: { type: "faction", playerId: P2 } });
  assert.ok(g.engine.state.battle, "a battle is in progress");
  assert.equal(g.engine.state.priorityPlayerId, P1, "the attacker holds priority, so only the battle blocks the tactic");
  refused(() => playRaw(g.engine, P1, g.id("aa"), { selected: { c: [g.id("zero")] } }), "during a battle", /cannot be (deployed|flipped up) right now/);
  assert.equal(zoneOf(g.engine, g.id("aa")), "hand");
  assert.equal(readyCount(g.engine, P1), 4, "nothing paid");
});

clause(ADUL, "0:extraCost", "the battle restriction ends with the battle: after it, the tactic can be deployed again", () => {
  const g = aaHand(bank("rage", 4, P1), [{ key: "pt", def: character({ name: "Pt", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" }]);
  declareAttackBy(g.engine, P1, [g.id("c")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  finishBattle(g.engine);
  assert.equal(g.engine.state.battle, undefined);
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("oc")] } });
  drain(g.engine, noRes);
  assert.equal(zoneOf(g.engine, g.id("aa")), "discard");
});

clause(ADUL, "1:rule", "this turn the picked character gains strength equal to its numeric cost (cost 4: 2 -> 6; the opponent's cost 7: 1 -> 8; cost 0: unchanged)", () => {
  const a = aaHand(bank("rage", 4, P1));
  play(a.engine, P1, a.id("aa"), { selected: { c: [a.id("c")] } });
  drain(a.engine, noRes);
  assert.equal(a.engine.getStat(a.id("c"), "strength"), 6);
  assert.equal(a.engine.getStat(a.id("oc"), "strength"), 1, "other characters unaffected");
  assert.equal(a.engine.getStat(a.id("c"), "life"), 4);
  assert.equal(a.engine.getStat(a.id("c"), "speed"), 2);
  const b = aaHand(bank("rage", 4, P1));
  play(b.engine, P1, b.id("aa"), { selected: { c: [b.id("oc")] } });
  drain(b.engine, noRes);
  assert.equal(b.engine.getStat(b.id("oc"), "strength"), 8);
  assert.equal(b.engine.getStat(b.id("c"), "strength"), 2);
  const z = aaHand(bank("rage", 4, P1));
  play(z.engine, P1, z.id("aa"), { selected: { c: [z.id("zero")] } });
  drain(z.engine, noRes);
  assert.equal(z.engine.getStat(z.id("zero"), "strength"), 1);
});

clause(ADUL, "1:rule", "the strength bonus lasts this turn only", () => {
  const g = aaHand(bank("rage", 4, P1));
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("c")] } });
  drain(g.engine, noRes);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
  endTurn(g.engine, P1);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 2);
  endTurn(g.engine, P2);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 2);
});

clause(ADUL, "1:rule", "the strength follows the picked character's own numeric cost, not the tactic's: a cost-7 character gets +7", () => {
  const g = aaHand(bank("rage", 4, P1));
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("oc")] } });
  drain(g.engine, noRes);
  assert.equal(g.engine.getStat(g.id("oc"), "strength"), 8);
});

const isResourceIn = (g: AG, k: string): boolean => g.engine.state.cards[g.id(k)].zone === "play" && g.engine.isResource(g.id(k));

clause(ADUL, "1:rule", "'You may play a resource': accepted, a resource card from your hand is played as a resource", () => {
  const g = aaHand(bank("rage", 4, P1), [{ key: "rc", def: resourceCard({ name: "HandRes" }), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("c")] } });
  drain(g.engine, pickRes(g.id("rc")));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(isResourceIn(g, "rc"), true);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6, "the strength bonus also applied");
});

clause(ADUL, "1:rule", "'You may play a resource': a non-resource card from hand can be played face-down as a resource", () => {
  const g = aaHand(bank("rage", 4, P1), [{ key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("c")] } });
  drain(g.engine, pickRes(g.id("hc")));
  assert.equal(g.engine.state.cards[g.id("hc")].zone, "play");
  assert.equal(g.engine.state.cards[g.id("hc")].faceDown, true);
  assert.equal(g.engine.isResource(g.id("hc")), true);
});

clause(ADUL, "1:rule", "'You may play a resource': declined, nothing is played and the card stays in hand (the strength bonus still applies)", () => {
  const g = aaHand(bank("rage", 4, P1), [{ key: "rc", def: resourceCard({ name: "HandRes" }), owner: P1, zone: "hand" }]);
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("c")] } });
  drain(g.engine, noRes);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("rc")), "hand");
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
});

clause(ADUL, "1:rule", "the resource played comes from YOUR hand only: picking a resource card in the opponent's hand or in your deck plays nothing", () => {
  for (const bad of ["theirs", "deck"]) {
    const g = aaHand(bank("rage", 4, P1), [
      { key: "mine", def: resourceCard({ name: "MyHandRes" }), owner: P1, zone: "hand" },
      { key: "theirs", def: resourceCard({ name: "TheirHandRes" }), owner: P2, zone: "hand" },
      { key: "deck", def: resourceCard({ name: "DeckRes" }), owner: P1, zone: "deck" }
    ]);
    play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("c")] } });
    const pc = pending(g.engine) as unknown as { kind: string; playerId: PlayerId };
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1, "you choose");
    try {
      drain(g.engine, pickRes(g.id(bad)));
    } catch {
      /* a refusal is fine */
    }
    assert.equal(zoneOf(g.engine, g.id(bad)), bad === "theirs" ? "hand" : "deck", `${bad} was not played`);
  }
});

clause(ADUL, "1:rule", "'a resource' is one: answering with two cards from hand plays at most one", () => {
  const g = aaHand(bank("rage", 4, P1), [
    { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "hand" },
    { key: "r2", def: resourceCard({ name: "R2" }), owner: P1, zone: "hand" }
  ]);
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("c")] } });
  try {
    drain(g.engine, (pc: { kind: string }) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [g.id("r1"), g.id("r2")] } : declineAll(pc as never)));
  } catch {
    /* a refusal is fine */
  }
  const played = ["r1", "r2"].filter((k) => zoneOf(g.engine, g.id(k)) === "play").length;
  assert.ok(played <= 1, `at most one resource played, got ${played}`);
});

clause(ADUL, "1:rule", "an empty hand is fine: the resource part does nothing and no prompt soft-locks", () => {
  const g = aaHand(bank("rage", 4, P1));
  play(g.engine, P1, g.id("aa"), { selected: { c: [g.id("c")] } });
  drain(g.engine, noRes);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
});

// -- FLIP UP: 3 [R] ------------------------------------------------------------

interface FOpts {
  others: CardPlacement[];
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}
const fboard = (o: FOpts) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn ?? 1,
    activePlayerId: o.active ?? P1,
    cards: [
      { key: "aa", def: printing(ADUL), owner: P1, zone: "play", faceDown: true },
      { key: "c", def: character({ name: "Mine", strength: 2, life: 4, speed: 2, cost: 4 }), owner: P1, zone: "play" },
      { key: "pt", def: character({ name: "Pt", strength: 1, life: 4, speed: 2, cost: 1 }), owner: P2, zone: "play" },
      ...o.others,
      ...(o.extra ?? [])
    ]
  });
type FG = ReturnType<typeof fboard>;
const flip = (g: FG, pick = "c"): void => {
  rawFlipUp(g.engine, P1, g.id("aa"), { c: [g.id(pick)] });
  resolvePendingResponses(g.engine);
};

clause(ADUL, "2:flipUp", "a face-down Auditory Adulation flips up for 3 with [R]: its effect runs (the picked character gets strength = its cost) and the tactic goes to the discard pile", () => {
  const g = fboard({ others: [...bank("rage", 1, P1), ...bank("greed", 2, P1)] });
  assert.equal(readyCount(g.engine, P1), 4);
  flip(g);
  drain(g.engine, noRes);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
  assert.equal(zoneOf(g.engine, g.id("aa")), "discard");
});

clause(ADUL, "2:flipUp", "pays exactly 3 (not the tactic's normal 4): of 5 other resources, 3 are spent and 2 stay ready", () => {
  const g = fboard({ others: [...bank("rage", 2, P1), ...bank("greed", 3, P1)] });
  flip(g);
  drain(g.engine, noRes);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
  // CR 507.4b: the card may pay for itself, so the payer is rule-neutral. 6 ready before (5 others + itself), 3 paid, the flipped card stops being a resource:
  // 2 others ready if three others paid, 3 others ready if it paid itself plus two others.
  assert.ok([2, 3].includes(readyCount(g.engine, P1)), `exactly 3 resources' worth was paid (ready after: ${readyCount(g.engine, P1)} must be 2 or 3)`);
});

clause(ADUL, "2:flipUp", "the card may pay for its own FLIP UP: itself plus two other resources (one [R]) is exactly enough and all are spent", () => {
  const g = fboard({ others: [...bank("rage", 1, P1), ...bank("greed", 1, P1)] });
  assert.equal(readyCount(g.engine, P1), 3, "itself + 2 others");
  flip(g);
  drain(g.engine, noRes);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
  assert.equal(readyCount(g.engine, P1), 0);
});

clause(ADUL, "2:flipUp", "is refused when short: itself plus one other resource is only 2, nothing is paid", () => {
  const g = fboard({ others: bank("rage", 1, P1) });
  refused(() => rawFlipUp(g.engine, P1, g.id("aa"), { c: [g.id("c")] }), "2 resources can't pay 3", /FLIP UP costs cannot be paid/);
  assert.equal(g.engine.state.cards[g.id("aa")].faceDown, true);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 2);
  assert.equal(readyCount(g.engine, P1), 2);
});

clause(ADUL, "2:flipUp", "needs [R] after flipping: three Greed others is not the threshold and its own Volition is not [R]", () => {
  const g = fboard({ others: bank("greed", 3, P1) });
  refused(() => rawFlipUp(g.engine, P1, g.id("aa"), { c: [g.id("c")] }), "no [R] among the resources", /FLIP UP threshold/);
  assert.equal(g.engine.state.cards[g.id("aa")].faceDown, true);
  assert.equal(readyCount(g.engine, P1), 4);
  const ok = fboard({ others: [...bank("rage", 1, P1), ...bank("greed", 2, P1)] });
  flip(ok);
  assert.equal(ok.engine.state.cards[ok.id("aa")].faceDown === true, false);
});

clause(ADUL, "2:flipUp", "FLIP UP threshold counts spent [R]: a spent Rage + three ready Greed pays 3 and flips", () => {
  const g = fboard({ others: [...spentResources(P1, 1), ...bank("greed", 3, P1)] });
  flip(g);
  drain(g.engine, noRes);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
  assert.ok(readyCount(g.engine, P1) <= 1, "itself + 3 greed = 4 ready, 3 paid, and the flipped card is no longer a resource");
});

clause(ADUL, "2:flipUp", "the extra cost applies: FLIP UP without picking a character is refused", () => {
  const g = fboard({ others: [...bank("rage", 1, P1), ...bank("greed", 2, P1)] });
  refused(() => rawFlipUp(g.engine, P1, g.id("aa"), {}), "no character picked", /requires 1 selection/);
  assert.equal(g.engine.state.cards[g.id("aa")].faceDown, true);
  assert.equal(readyCount(g.engine, P1), 4);
});

clause(ADUL, "2:flipUp", "'not during a battle' still applies to FLIP UP: refused in a battle (control: allowed outside one)", () => {
  const g = fboard({ others: [...bank("rage", 1, P1), ...bank("greed", 2, P1)] });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("c")], target: { type: "faction", playerId: P2 } });
  assert.ok(g.engine.state.battle, "g.engine.state.battle");
  assert.equal(g.engine.state.priorityPlayerId, P1, "the attacker holds priority, so only the battle blocks the flip");
  refused(() => rawFlipUp(g.engine, P1, g.id("aa"), { c: [g.id("pt")] }), "during a battle", /cannot be (deployed|flipped up) right now/);
  assert.equal(g.engine.state.cards[g.id("aa")].faceDown, true);
  assert.equal(readyCount(g.engine, P1), 4, "nothing paid");
});

clause(ADUL, "2:flipUp", "a tactic may be flipped up in the opponent's response window (a tactic can be deployed whenever a tactic could be)", () => {
  const g = fboard({
    turn: 2,
    active: P2,
    others: [...bank("rage", 1, P1), ...bank("greed", 2, P1)],
    extra: [{ key: "oh", def: character({ name: "OppHand", cost: 0 }), owner: P2, zone: "hand" }]
  });
  playRaw(g.engine, P2, g.id("oh"));
  assert.ok(g.engine.state.responseWindow, "a response window is open");
  rawFlipUp(g.engine, P1, g.id("aa"), { c: [g.id("c")] });
  resolvePendingResponses(g.engine);
  drain(g.engine, noRes);
  assert.equal(g.engine.getStat(g.id("c"), "strength"), 6);
  assert.equal(zoneOf(g.engine, g.id("aa")), "discard");
});

clause(ADUL, "2:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const g = fboard({ others: [...bank("rage", 1, P1), ...bank("greed", 2, P1)] });
  refused(() => rawFlipUp(g.engine, P2, g.id("aa"), { c: [g.id("c")] }), "not P2's card", /do not control/);
  const hand = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "aa", def: printing(ADUL), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Mine", cost: 4 }), owner: P1, zone: "play" },
      ...bank("rage", 3, P1)
    ]
  });
  refused(() => rawFlipUp(hand.engine, P1, hand.id("aa"), { c: [hand.id("c")] }), "in hand, not face-down in play", /face-down resource/);
  assert.equal(zoneOf(hand.engine, hand.id("aa")), "hand");
});
