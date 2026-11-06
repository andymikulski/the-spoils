import assert from "node:assert/strict";
import { buildGame, activate, resolvePendingResponses, bank, character, developFaction, item, P1, P2, play, tactic } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackOpenWindow, playRaw } from "./_battle.js";
import { pending } from "./_board.js";
import { endTurn, spentResources } from "./_turn.js";

type Cards = NonNullable<Parameters<typeof buildGame>[0]>["cards"];
type Engine = ReturnType<typeof buildGame>["engine"];
type P = typeof P1 | typeof P2;
const ready = (e: Engine, p: string = P1) => e.getAvailableResourceCount(p as never);
const zone = (e: Engine, cardId: string) => e.state.cards[cardId].zone;
const dmg = (e: Engine, cardId: string) => e.state.cards[cardId].damage ?? 0;
const infl = (e: Engine, p: P) => e.state.players[p].influence;
const rf = (fn: () => unknown, why: string, pattern?: RegExp) =>
  refused(
    () => {
      try {
        fn();
      } catch (err) {
        if (process.env.DBG) console.log(why, "=>", (err as Error).message);
        throw err;
      }
    },
    why,
    pattern
  );
const flipUpRaw = (engine: Engine, player: P, cardId: string) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });
const resolve = (engine: Engine, choice: Record<string, unknown>) => {
  const pc = pending(engine)!;
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
};
/** A free tactic by which its caster discards `count` cards from `who`'s hand (relative to the caster). */
const stripTactic = (who: "self" | "opponent", count: number) =>
  tactic({
    name: `Strip ${who} ${count}`,
    cost: 0,
    behavior: {
      abilities: [
        count > 0
          ? {
              id: "d",
              type: "activated",
              targets: [{ id: "t", selector: { zone: "hand", owner: who }, count }],
              effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
            }
          : {
              id: "d",
              type: "activated",
              effects: [
                {
                  type: "forEach",
                  selector: { zone: "hand", owner: who },
                  effects: [{ type: "moveCard", target: { type: "selected", id: "__candidate" }, to: "discard" }]
                }
              ]
            }
      ]
    } as never
  });
/** A free tactic that destroys one chosen item (decl `t`). */
const itemKiller = () =>
  tactic({
    name: "Item Killer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    } as never
  });
const charKiller = () =>
  tactic({
    name: "Char Killer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    } as never
  });

// ============================================================================
// Phalludrix, the Impotenator -- item, warlord, cost 1, [R]
// UNIQUE PHALLUDRIX
// When an effect controlled by an opponent causes you to discard any number of cards, you may put them back into your hand.
// EQUIP -- COST: Pick a character. If it is an adriel card then X is 0, otherwise X is 3. Pay X. -- EFFECT: Attach this card to the character.
// The attached character gains 2 strength.
// At the start of each opponent's turn, you may restore the attached character.
// ============================================================================
const PH = "513334b0-8ed9-4d1b-9eea-86af96f9247e";
function phBoard(
  o: { rage?: number; greed?: number; spent?: number; phZone?: "hand" | "play"; attach?: string; extra?: Cards; turn?: number; active?: P } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    random: () => 0.5,
    cards: [
      { key: "ph", def: printing(PH), owner: P1, zone: o.phZone ?? "hand", attachedToKey: o.attach },
      { key: "host", def: character({ name: "Host", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "adr", def: character({ name: "Adr", subtype: ["adriel"], strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "knight", def: character({ name: "Knight", subtype: ["knight"], strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDisc", def: character({ name: "InDisc" }), owner: P1, zone: "discard" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ] as Cards
  });
}
// R2 (user, 2026-10-21): Phalludrix prints no ATTACH TO. It is deployed for its own cost of 1 with no pick, and the EQUIP
// ability (a separate activation, 0 or 3) attaches it. Total cost of deploy + EQUIP is therefore 1 + X.
const equip = (b: ReturnType<typeof phBoard>, host: string) => {
  play(b.engine, P1, b.id("ph"));
  resolvePendingResponses(b.engine);
  activate(b.engine, P1, b.id("ph"), "equip", { selected: { eq: [b.id(host)] } });
  resolvePendingResponses(b.engine);
};

clause(PH, "0:unique", "printed card: item, warlord, cost 1, threshold r, UNIQUE phalludrix, attaches to a character", () => {
  const p = printing(PH);
  assert.equal(p.type, "item");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 1);
  assert.equal(p.threshold, "r");
  assert.equal((p as unknown as { unique?: string }).unique, "phalludrix");
  assert.equal((p as unknown as { attachTo?: string }).attachTo, undefined, "no ATTACH TO is printed (R2): EQUIP attaches it");
});
clause(PH, "0:unique", "deploying on an adriel costs exactly 1 [R]: one rage is enough, none is not, and a greed does not meet the threshold", () => {
  const b = phBoard({ rage: 1 });
  equip(b, "adr");
  assert.equal(zone(b.engine, b.id("ph")), "play");
  assert.equal(ready(b.engine), 0, "cost 1 paid");
  rf(() => equip(phBoard({ rage: 0, spent: 1 }), "adr"), "no ready resource for cost 1 (threshold met by a spent [R])", /cannot be paid/);
  rf(() => equip(phBoard({ rage: 0, greed: 1 }), "adr"), "one greed has no [R] icon");
});
clause(PH, "0:unique", "the [R] threshold may be met by spent resources while a ready one pays the cost", () => {
  const b = phBoard({ rage: 0, greed: 1, spent: 1 });
  equip(b, "adr");
  assert.equal(zone(b.engine, b.id("ph")), "play", "spent rage meets the threshold");
  assert.equal(ready(b.engine), 0);
  rf(() => equip(phBoard({ rage: 0, greed: 0, spent: 1 }), "adr"), "spent resource cannot pay the cost");
});
clause(PH, "0:unique", "a second Phalludrix makes you keep one: choosing the new one destroys the old one", () => {
  const b = phBoard({ rage: 2, phZone: "play", attach: "host", extra: [{ key: "ph2", def: printing(PH), owner: P1, zone: "hand" }] as Cards });
  play(b.engine, P1, b.id("ph2"), { selected: { attachTo: [b.id("adr")], eq: [b.id("adr")] } });
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("ph"), b.id("ph2")].sort());
  resolve(b.engine, { kind: "uniqueSurvivor", keep: b.id("ph2") });
  assert.equal(zone(b.engine, b.id("ph2")), "play");
  assert.equal(zone(b.engine, b.id("ph")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});
clause(PH, "0:unique", "choosing the old Phalludrix keeps it and destroys the new one", () => {
  const b = phBoard({ rage: 2, phZone: "play", attach: "host", extra: [{ key: "ph2", def: printing(PH), owner: P1, zone: "hand" }] as Cards });
  play(b.engine, P1, b.id("ph2"), { selected: { attachTo: [b.id("adr")], eq: [b.id("adr")] } });
  resolve(b.engine, { kind: "uniqueSurvivor", keep: b.id("ph") });
  assert.equal(zone(b.engine, b.id("ph")), "play");
  assert.equal(zone(b.engine, b.id("ph2")), "discard");
});
clause(PH, "0:unique", "the restriction is per player: the opponent may control their own Phalludrix with no choice", () => {
  const b = phBoard({
    phZone: "play",
    attach: "host",
    turn: 2,
    active: P2,
    extra: [
      { key: "ph2", def: printing(PH), owner: P2, zone: "hand" },
      ...bank("rage", 4, P2)
    ] as Cards
  });
  play(b.engine, P2, b.id("ph2"), { selected: { attachTo: [b.id("foe")], eq: [b.id("foe")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("ph")), "play");
  assert.equal(zone(b.engine, b.id("ph2")), "play");
});

// --- 1:rule discard replacement ---
const strip = (b: ReturnType<typeof phBoard>, who: P, opts: { selected: Record<string, string[]> }) => {
  playRaw(b.engine, who, b.id("strip"), opts as never);
  resolvePendingResponses(b.engine);
};
const discardBoard = (o: { phZone?: "hand" | "play"; turn?: number; active?: P; strip?: { owner: P; who: "self" | "opponent"; count: number } } = {}) => {
  const strip = o.strip ?? { owner: P2, who: "opponent" as const, count: 1 };
  return phBoard({
    phZone: o.phZone ?? "play",
    attach: "host",
    turn: o.turn ?? 2,
    active: o.active ?? P2,
    extra: [
      { key: "h0", def: character({ name: "H0" }), owner: P1, zone: "hand" },
      { key: "h1", def: character({ name: "H1" }), owner: P1, zone: "hand" },
      { key: "g0", def: character({ name: "G0" }), owner: P2, zone: "hand" },
      { key: "strip", def: stripTactic(strip.who, strip.count), owner: strip.owner, zone: "hand" }
    ] as Cards
  });
};
clause(PH, "1:rule", "an opponent's effect that discards one of your cards lets you put it back into your hand (accept)", () => {
  const b = discardBoard();
  strip(b, P2, { selected: { t: [b.id("h0")] } });
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "replacementChoice");
  assert.equal(pc.playerId, P1, "you choose");
  resolve(b.engine, { kind: "replacementChoice", apply: true });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("h0")), "hand", "put back into your hand");
  assert.ok(b.engine.state.players[P1].hand.includes(b.id("h0")), "b.engine.state.players[P1].hand.includes(b.id(\"h0\"))");
  assert.equal(zone(b.engine, b.id("h1")), "hand");
});
clause(PH, "1:rule", "'may': declining leaves the discarded card in the discard pile", () => {
  const b = discardBoard();
  strip(b, P2, { selected: { t: [b.id("h0")] } });
  assert.equal(pending(b.engine)?.kind, "replacementChoice");
  resolve(b.engine, { kind: "replacementChoice", apply: false });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("h0")), "discard");
  assert.equal(zone(b.engine, b.id("h1")), "hand");
});
clause(PH, "1:rule", "any number of cards: three discarded cards can all be put back", () => {
  const b = discardBoard({ strip: { owner: P2, who: "opponent", count: 0 } });
  strip(b, P2, { selected: {} });
  drain(b.engine, (pc) => (pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("h0")), "hand");
  assert.equal(zone(b.engine, b.id("h1")), "hand");
  assert.equal(zone(b.engine, b.id("inHand")), "hand", "all three discarded cards go back");
});
clause(PH, "1:rule", "any number of cards: of three discarded cards you may put back just one", () => {
  const b = discardBoard({ strip: { owner: P2, who: "opponent", count: 0 } });
  strip(b, P2, { selected: {} });
  let first = true;
  drain(b.engine, (pc) => {
    if (pc.kind !== "replacementChoice") return declineAll(pc);
    const apply = first;
    first = false;
    return { kind: "replacementChoice", apply };
  });
  const zs = ["h0", "h1", "inHand"].map((k) => zone(b.engine, b.id(k))).sort();
  assert.deepEqual(zs, ["discard", "discard", "hand"], "exactly the one you accepted is back");
});
clause(PH, "1:rule", "your own effect discarding your own cards is not an opponent's effect: no choice, the card is discarded", () => {
  const b = discardBoard({ turn: 1, active: P1, strip: { owner: P1, who: "self", count: 1 } });
  strip(b, P1, { selected: { t: [b.id("h0")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("h0")), "discard");
});
clause(PH, "1:rule", "an opponent's effect discarding the OPPONENT's own cards is not 'you discard': no choice", () => {
  const b = discardBoard({ strip: { owner: P2, who: "self", count: 1 } });
  strip(b, P2, { selected: { t: [b.id("g0")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("g0")), "discard");
});
clause(PH, "1:rule", "only works while Phalludrix is in play: from your hand there is no choice", () => {
  const b = discardBoard({ phZone: "hand" });
  strip(b, P2, { selected: { t: [b.id("h0")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("h0")), "discard");
});
clause(PH, "1:rule", "an opponent's effect that DESTROYS your character is not a discard: no choice to put it back", () => {
  const killer = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5,
    cards: [
      { key: "ph", def: printing(PH), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "host", def: character({ name: "Host", life: 2 }), owner: P1, zone: "play" },
      { key: "ck", def: charKiller(), owner: P2, zone: "hand" }
    ] as Cards
  });
  play(killer.engine, P2, killer.id("ck"), { selected: { t: [killer.id("host")] } });
  assert.equal(pending(killer.engine), undefined, "destruction is not discarding cards");
  assert.equal(zone(killer.engine, killer.id("host")), "discard");
});

// --- 2:ability EQUIP ---
clause(PH, "2:ability", "equipping a non-adriel character costs 1 + X=3: exactly 4 rage works, the item attaches to the picked character", () => {
  const b = phBoard({ rage: 4 });
  equip(b, "host");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("ph")), "play");
  assert.equal(b.engine.state.cards[b.id("ph")].attachedTo, b.id("host"));
  assert.equal(ready(b.engine), 0, "1 + 3 paid");
});
clause(PH, "2:ability", "equipping a non-adriel character is refused one resource short (3 rage) or with no [R] icon (4 greed)", () => {
  const ok = phBoard({ rage: 4 });
  equip(ok, "host");
  assert.equal(zone(ok.engine, ok.id("ph")), "play", "positive control");
  rf(() => equip(phBoard({ rage: 3 }), "host"), "X is 3 for a non-adriel: 3 resources are not enough");
  rf(() => equip(phBoard({ rage: 0, greed: 4 }), "host"), "no [R] icon");
});
clause(PH, "2:ability", "a subtype other than adriel (knight) still pays X=3", () => {
  const b = phBoard({ rage: 4 });
  equip(b, "knight");
  assert.equal(b.engine.state.cards[b.id("ph")].attachedTo, b.id("knight"));
  assert.equal(ready(b.engine), 0);
  rf(() => equip(phBoard({ rage: 3 }), "knight"), "knight pays X=3");
});
clause(PH, "2:ability", "equipping an adriel character makes X 0: only the printed 1 is paid, 4 rage leaves 3", () => {
  const b = phBoard({ rage: 4 });
  equip(b, "adr");
  assert.equal(b.engine.state.cards[b.id("ph")].attachedTo, b.id("adr"));
  assert.equal(ready(b.engine), 3, "only the card's cost of 1 is paid, X is 0");
});
clause(PH, "2:ability", "the opponent's character can be picked too (a character, not 'your character')", () => {
  const b = phBoard({ rage: 4 });
  equip(b, "foe");
  assert.equal(b.engine.state.cards[b.id("ph")].attachedTo, b.id("foe"));
  assert.equal(ready(b.engine), 0);
});
clause(PH, "2:ability", "only characters can be picked: an item, a character in hand, or one in the discard pile is refused; so is no pick", () => {
  const b = phBoard({ rage: 4 });
  equip(b, "host");
  assert.equal(zone(b.engine, b.id("ph")), "play", "positive control");
  rf(() => equip(phBoard({ rage: 4 }), "it"), "item is not a character");
  rf(() => equip(phBoard({ rage: 4 }), "inHand"), "character in hand");
  rf(() => equip(phBoard({ rage: 4 }), "inDisc"), "character in discard");
  const nb = phBoard({ rage: 4 });
  play(nb.engine, P1, nb.id("ph"));
  rf(() => activate(nb.engine, P1, nb.id("ph"), "equip"), "no character picked (same board)");
});

clause(PH, "2:ability", "EQUIP is one pick: 'Pick a character' once is enough to equip (the engine also demands a second, separate attachTo pick)", () => {
  const b = phBoard({ rage: 4 });
  play(b.engine, P1, b.id("ph"));
  resolvePendingResponses(b.engine);
  activate(b.engine, P1, b.id("ph"), "equip", { selected: { eq: [b.id("host")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zone(b.engine, b.id("ph")), "play");
  assert.equal(b.engine.state.cards[b.id("ph")].attachedTo, b.id("host"));
  assert.equal(ready(b.engine), 0);
});
// --- 3:rule +2 strength ---
const attached = (extra: Cards = []) => phBoard({ rage: 0, phZone: "play", attach: "host", extra });
clause(PH, "3:rule", "the attached character gains 2 strength (printed 1 becomes 3); other characters are unchanged", () => {
  const b = attached();
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("adr"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 3, "only strength");
  assert.equal(b.engine.getStat(b.id("host"), "speed"), 1, "only strength");
});
clause(PH, "3:rule", "it follows the picked character, including an opponent's: the foe gains 2 and the item's own host does not", () => {
  const b = phBoard({ rage: 4 });
  equip(b, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 4);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1);
});
clause(PH, "3:rule", "equipping through the real EQUIP grants the bonus immediately; an unattached Phalludrix in hand grants none", () => {
  const b = phBoard({ rage: 4 });
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1);
  equip(b, "host");
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
});
clause(PH, "3:rule", "once Phalludrix leaves play the bonus is gone", () => {
  const b = attached([{ key: "ik", def: itemKiller(), owner: P1, zone: "hand" }] as Cards);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
  play(b.engine, P1, b.id("ik"), { selected: { t: [b.id("ph")] } });
  assert.equal(zone(b.engine, b.id("ph")), "discard");
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1);
});

// --- 4:rule restore ---
const restoreBoard = () =>
  phBoard({
    rage: 0,
    phZone: "play",
    attach: "host",
    extra: [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", depleted: true }] as Cards
  });
const toOpponentTurn = (b: ReturnType<typeof phBoard>) => {
  b.engine.state.cards[b.id("host")].depleted = true;
  endTurn(b.engine, P1);
};
clause(PH, "4:rule", "at the start of the opponent's turn you are asked, and accepting restores the attached character only", () => {
  const b = restoreBoard();
  toOpponentTurn(b);
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.state.cards[b.id("host")].depleted, true, "still depleted while the choice waits");
  resolve(b.engine, { kind: "chooserSelectsOption", index: 1 });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("host")].depleted, false, "restored");
  assert.equal(b.engine.state.cards[b.id("other")].depleted, true, "other characters are not restored");
});
clause(PH, "4:rule", "'may': declining leaves the attached character depleted", () => {
  const b = restoreBoard();
  toOpponentTurn(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  resolve(b.engine, { kind: "chooserSelectsOption", index: 0 });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("host")].depleted, true);
});
clause(PH, "4:rule", "no prompt at the start of YOUR OWN turn", () => {
  const b = restoreBoard();
  toOpponentTurn(b);
  resolve(b.engine, { kind: "chooserSelectsOption", index: 0 });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("host")].depleted, true);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(pending(b.engine), undefined, "no Phalludrix prompt on your own turn");
});
clause(PH, "4:rule", "it triggers on each opponent's turn: asked again the next time", () => {
  const b = restoreBoard();
  toOpponentTurn(b);
  resolve(b.engine, { kind: "chooserSelectsOption", index: 0 });
  drain(b.engine, declineAll);
  endTurn(b.engine, P2);
  b.engine.state.cards[b.id("host")].depleted = true;
  endTurn(b.engine, P1);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  resolve(b.engine, { kind: "chooserSelectsOption", index: 1 });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("host")].depleted, false);
});
clause(PH, "4:rule", "an opponent's character wearing it is restored too, and the opponent's turn start asks Phalludrix's controller", () => {
  const b = phBoard({ rage: 0, phZone: "play", attach: "foe" });
  b.engine.state.cards[b.id("foe")].depleted = true;
  endTurn(b.engine, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1);
  resolve(b.engine, { kind: "chooserSelectsOption", index: 1 });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
});

// ============================================================================
// Plunging Shriever -- character (dragon), warlord, cost 4, [R][R], 3/4/1
// When this card enters play, you may pick an item. If you do, destroy that item and your faction loses 2 influence.
// FLY AWAY -- COST: Remove an item in an opponent's discard pile from the game. -- EFFECT: Flip this card face-down under its owner's control.
// FLIP UP: 3 [R][R]
// ============================================================================
const PS = "ec2a5b27-94ff-4b64-912b-b4fef8895da7";
function psBoard(
  o: { rage?: number; greed?: number; spent?: number; psZone?: "hand" | "play"; faceDown?: boolean; psOwner?: P; psController?: P; turn?: number; active?: P; extra?: Cards } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    random: () => 0.5,
    cards: [
      { key: "ps", def: printing(PS), owner: o.psOwner ?? P1, controller: o.psController, zone: o.psZone ?? "hand", faceDown: o.faceDown },
      { key: "myItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "foeChar", def: character({ name: "FoeChar" }), owner: P2, zone: "play" },
      { key: "myChar", def: character({ name: "MyChar" }), owner: P1, zone: "play" },
      { key: "foeDiscItem", def: item({ name: "FoeDiscItem" }), owner: P2, zone: "discard" },
      { key: "foeDiscItem2", def: item({ name: "FoeDiscItem2" }), owner: P2, zone: "discard" },
      { key: "myDiscItem", def: item({ name: "MyDiscItem" }), owner: P1, zone: "discard" },
      { key: "foeDiscChar", def: character({ name: "FoeDiscChar" }), owner: P2, zone: "discard" },
      { key: "foeHandItem", def: item({ name: "FoeHandItem" }), owner: P2, zone: "hand" },
      ...bank("rage", o.rage ?? 4, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ] as Cards
  });
}
const pickItm = (ids: string[]) => (pc: { kind: string; [k: string]: unknown }) =>
  pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { itm: ids } } : declineAll(pc);
const deployPs = (b: ReturnType<typeof psBoard>, ids: string[] | null) => {
  play(b.engine, P1, b.id("ps"));
  if (ids) drain(b.engine, pickItm(ids.map((k) => b.id(k))));
  else drain(b.engine, declineAll);
};

clause(PS, "0:rule", "printed card: warlord dragon character, cost 4, threshold rr, 3 strength / 4 speed / 1 life", () => {
  const p = printing(PS);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual(p.subtype, ["dragon"]);
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "rr");
  assert.equal(p.strength, 3);
  assert.equal(p.speed, 4);
  assert.equal(p.life, 1);
  const b = psBoard({ psZone: "play" });
  assert.equal(b.engine.getStat(b.id("ps"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("ps"), "speed"), 4);
  assert.equal(b.engine.getStat(b.id("ps"), "life"), 1);
});
clause(PS, "0:rule", "deploys for exactly 4 with [R][R]; 3 rage is one short, and 1 rage + 3 greed is one icon short", () => {
  const b = psBoard({ rage: 4 });
  deployPs(b, null);
  assert.equal(zone(b.engine, b.id("ps")), "play");
  assert.equal(ready(b.engine), 0, "cost 4 paid");
  rf(() => deployPs(psBoard({ rage: 3 }), null), "one short");
  rf(() => deployPs(psBoard({ rage: 1, greed: 3 }), null), "one [R] icon short of the threshold");
  const ok = psBoard({ rage: 2, greed: 2 });
  deployPs(ok, null);
  assert.equal(zone(ok.engine, ok.id("ps")), "play", "2 rage + 2 greed is enough");
});
clause(PS, "0:rule", "entering play: you may pick an opponent's item; it is destroyed and your faction loses 2 influence", () => {
  const b = psBoard();
  const before = [infl(b.engine, P1), infl(b.engine, P2)];
  deployPs(b, ["foeItem"]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("foeItem")), "discard", "destroyed");
  assert.equal(zone(b.engine, b.id("myItem")), "play", "only the picked item");
  assert.equal(infl(b.engine, P1), before[0] - 2, "your faction loses 2");
  assert.equal(infl(b.engine, P2), before[1], "their faction is unaffected");
});
clause(PS, "0:rule", "the picked item may be your own: it is destroyed and you still lose 2 influence", () => {
  const b = psBoard();
  const before = infl(b.engine, P1);
  deployPs(b, ["myItem"]);
  assert.equal(zone(b.engine, b.id("myItem")), "discard");
  assert.equal(zone(b.engine, b.id("foeItem")), "play");
  assert.equal(infl(b.engine, P1), before - 2);
});
clause(PS, "0:rule", "'you may': picking nothing destroys nothing and costs no influence", () => {
  const b = psBoard();
  const before = [infl(b.engine, P1), infl(b.engine, P2)];
  deployPs(b, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("ps")), "play");
  assert.equal(zone(b.engine, b.id("foeItem")), "play");
  assert.equal(zone(b.engine, b.id("myItem")), "play");
  assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before);
});
clause(PS, "0:rule", "only an item in play can be picked: a character, an item in a discard pile, or one in a hand is refused", () => {
  const b = psBoard();
  play(b.engine, P1, b.id("ps"));
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "selectTargets", "the optional pick is offered");
  const attempt = (k: string) => () => resolve(b.engine, { kind: "selectTargets", selected: { itm: [b.id(k)] } });
  rf(attempt("foeChar"), "a character is not an item");
  rf(attempt("myChar"), "your character is not an item");
  rf(attempt("foeDiscItem"), "an item in a discard pile");
  rf(attempt("foeHandItem"), "an item in a hand");
  assert.equal(pending(b.engine)?.kind, "selectTargets", "still waiting for a legal pick");
  resolve(b.engine, { kind: "selectTargets", selected: { itm: [b.id("foeItem")] } });
  drain(b.engine, declineAll);
  assert.equal(zone(b.engine, b.id("foeItem")), "discard", "positive control");
});
clause(PS, "0:rule", "only one item is picked: two picks are refused", () => {
  const b = psBoard();
  play(b.engine, P1, b.id("ps"));
  rf(() => resolve(b.engine, { kind: "selectTargets", selected: { itm: [b.id("foeItem"), b.id("myItem")] } }), "pick an item, singular");
});
clause(PS, "0:rule", "another card entering play does not trigger it", () => {
  const b = psBoard({ psZone: "play", extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] as Cards });
  const before = infl(b.engine, P1);
  play(b.engine, P1, b.id("newbie"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zone(b.engine, b.id("foeItem")), "play");
  assert.equal(infl(b.engine, P1), before);
});

// --- FLY AWAY ---
const fly = (b: ReturnType<typeof psBoard>, key: string, who: P = P1) =>
  activate(b.engine, who, b.id("ps"), "fly-away", { selected: { gone: [b.id(key)] } });
clause(PS, "1:ability:fly-away", "removes an item from the opponent's discard pile from the game and flips Shriever face-down", () => {
  const b = psBoard({ psZone: "play" });
  fly(b, "foeDiscItem");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("foeDiscItem")), "removed", "cost: removed from the game");
  assert.equal(zone(b.engine, b.id("foeDiscItem2")), "discard", "only the one chosen");
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown, true);
  assert.equal(zone(b.engine, b.id("ps")), "play", "flipped, not moved");
  assert.equal(b.engine.state.cards[b.id("ps")].controllerId, P1);
});
clause(PS, "1:ability:fly-away", "a different item in the opponent's discard pile can be chosen", () => {
  const b = psBoard({ psZone: "play" });
  fly(b, "foeDiscItem2");
  assert.equal(zone(b.engine, b.id("foeDiscItem2")), "removed");
  assert.equal(zone(b.engine, b.id("foeDiscItem")), "discard");
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown, true);
});
clause(PS, "1:ability:fly-away", "only an ITEM in the OPPONENT's DISCARD PILE pays: own discard, a character, an item in play or in hand are refused", () => {
  const ok = psBoard({ psZone: "play" });
  fly(ok, "foeDiscItem");
  assert.equal(ok.engine.state.cards[ok.id("ps")].faceDown, true, "positive control");
  for (const [k, why] of [
    ["myDiscItem", "your own discard pile"],
    ["foeDiscChar", "a character, not an item"],
    ["foeItem", "an item in play"],
    ["foeHandItem", "an item in their hand"]
  ] as const) {
    const b = psBoard({ psZone: "play" });
    rf(() => fly(b, k), why);
    assert.equal(b.engine.state.cards[b.id("ps")].faceDown ?? false, false, `${why}: still face-up`);
    assert.equal(zone(b.engine, b.id(k)), k === "myDiscItem" || k === "foeDiscChar" ? "discard" : zone(b.engine, b.id(k)));
  }
});
clause(PS, "1:ability:fly-away", "cannot be paid when the opponent's discard pile holds no item", () => {
  const b = psBoard({ psZone: "play" });
  for (const k of ["foeDiscItem", "foeDiscItem2"]) b.engine.state.cards[b.id(k)].zone = "removed" as never;
  rf(() => fly(b, "foeDiscItem"), "no item left in their discard pile");
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown ?? false, false);
});
clause(PS, "1:ability:fly-away", "'under its owner's control': a Shriever you took from its owner goes back face-down under the owner's control", () => {
  const b = psBoard({ psZone: "play", psOwner: P2, psController: P1 });
  assert.equal(b.engine.state.cards[b.id("ps")].controllerId, P1);
  fly(b, "foeDiscItem");
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("ps")].controllerId, P2, "its owner controls it");
  assert.equal(zone(b.engine, b.id("foeDiscItem")), "removed");
});
clause(PS, "1:ability:fly-away", "it is the controller's ability: the other player is not offered it, and a face-down Shriever has none", () => {
  const b = psBoard({ psZone: "play" });
  const has = (p: P) => b.engine.getAvailableActivatedAbilities(p as never).some((a: { cardId: string }) => a.cardId === b.id("ps"));
  assert.equal(has(P1), true, "controller can use it");
  assert.equal(has(P2), false, "opponent cannot");
  const fd = psBoard({ psZone: "play", faceDown: true });
  rf(() => fly(fd, "foeDiscItem"), "a face-down card has no abilities");
  assert.equal(zone(fd.engine, fd.id("foeDiscItem")), "discard", "nothing was paid");
});

// --- FLIP UP ---
const fdBoard = (o: { rage?: number; greed?: number; spent?: number; extra?: Cards; turn?: number; active?: P } = {}) =>
  psBoard({ psZone: "play", faceDown: true, rage: o.rage ?? 0, greed: o.greed ?? 0, spent: o.spent, extra: o.extra, turn: o.turn, active: o.active });
clause(PS, "2:flipUp", "FLIP UP costs 3 with [R][R]: it comes face-up; the card may help pay for itself (2 rage + itself)", () => {
  const b = fdBoard({ rage: 2 });
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown, true);
  flipUpRaw(b.engine, P1, b.id("ps"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown ?? false, false, "face-up");
  assert.equal(zone(b.engine, b.id("ps")), "play");
  const rich = fdBoard({ rage: 5 });
  flipUpRaw(rich.engine, P1, rich.id("ps"));
  drain(rich.engine, declineAll);
  assert.equal(rich.engine.state.cards[rich.id("ps")].faceDown ?? false, false);
  assert.ok([2, 3].includes(ready(rich.engine)), `3 paid out of 5 (+itself): ${ready(rich.engine)} left`);
});
clause(PS, "2:flipUp", "FLIP UP is refused one short of 3 (1 rage + itself) and one [R] icon short (1 rage + 2 greed)", () => {
  const ok = fdBoard({ rage: 2 });
  flipUpRaw(ok.engine, P1, ok.id("ps"));
  assert.equal(ok.engine.state.cards[ok.id("ps")].faceDown ?? false, false, "positive control");
  const short = fdBoard({ rage: 1, spent: 1 });
  rf(() => flipUpRaw(short.engine, P1, short.id("ps")), "one short of cost 3 (threshold [R][R] met by a spent [R])", /FLIP UP costs cannot be paid/);
  assert.equal(short.engine.state.cards[short.id("ps")].faceDown, true);
  const iconShort = fdBoard({ rage: 1, greed: 2 });
  rf(() => flipUpRaw(iconShort.engine, P1, iconShort.id("ps")), "only one [R] icon for [R][R]");
  assert.equal(iconShort.engine.state.cards[iconShort.id("ps")].faceDown, true);
  const noRage = fdBoard({ rage: 0, greed: 4 });
  rf(() => flipUpRaw(noRage.engine, P1, noRage.id("ps")), "no [R] icons at all");
  const costShort = fdBoard({ rage: 1, spent: 1 });
  rf(() => flipUpRaw(costShort.engine, P1, costShort.id("ps")), "rr met by a spent rage but only 2 can pay (1 ready + itself) for cost 3", /cannot be paid/i);
  assert.equal(costShort.engine.state.cards[costShort.id("ps")].faceDown, true);
  const costOk = fdBoard({ rage: 2, spent: 1 });
  flipUpRaw(costOk.engine, P1, costOk.id("ps"));
  assert.equal(costOk.engine.state.cards[costOk.id("ps")].faceDown ?? false, false, "control: 2 ready + itself pays 3");
});
clause(PS, "2:flipUp", "the threshold may be met by spent resources while greed pays the cost", () => {
  const b = fdBoard({ rage: 0, greed: 3, spent: 2 });
  flipUpRaw(b.engine, P1, b.id("ps"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown ?? false, false);
  const no = fdBoard({ rage: 0, greed: 3, spent: 1 });
  rf(() => flipUpRaw(no.engine, P1, no.id("ps")), "spent [R] alone is one icon short");
});
clause(PS, "2:flipUp", "the card's own icon does not count toward its threshold (rr needed from others)", () => {
  const b = fdBoard({ rage: 1, greed: 2 });
  rf(() => flipUpRaw(b.engine, P1, b.id("ps")), "threshold counted before it is face-up");
});
clause(PS, "2:flipUp", "flipping up plays the card as though from hand (RULES FLIP UP), so its enters-play pick is offered and works: item destroyed, 2 influence lost", () => {
  const b = fdBoard({ rage: 3 });
  const before = infl(b.engine, P1);
  flipUpRaw(b.engine, P1, b.id("ps"));
  assert.equal(pending(b.engine)?.kind, "selectTargets");
  resolve(b.engine, { kind: "selectTargets", selected: { itm: [b.id("foeItem")] } });
  drain(b.engine, declineAll);
  assert.equal(zone(b.engine, b.id("foeItem")), "discard");
  assert.equal(zone(b.engine, b.id("myItem")), "play");
  assert.equal(infl(b.engine, P1), before - 2);
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown ?? false, false);
});
clause(PS, "2:flipUp", "a character's FLIP UP is refused on the opponent's turn when no window is open (CR 507.4d: a character is still only deployable on your turn)", () => {
  const b = fdBoard({ rage: 3, turn: 2, active: P2 });
  rf(() => flipUpRaw(b.engine, P1, b.id("ps")), "opponent's turn, no window", /turn|priority|timing/i);
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown, true);
});
clause(PS, "2:flipUp", "a non-tactic FLIP UP is refused inside the opponent's response window", () => {
  const mk = () =>
    fdBoard({
      rage: 3,
      turn: 2,
      active: P2,
      extra: [{ key: "att", def: character({ name: "Att", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }] as Cards
    });
  const b = mk();
  declareAttackOpenWindow(b.engine, P2, [b.id("att")]);
  assert.ok(b.engine.state.responseWindow, "the response window is open");
  assert.equal((b.engine.state.responseWindow as unknown as { priorityPlayerId: string }).priorityPlayerId, P1, "the defender holds priority");
  rf(() => flipUpRaw(b.engine, P1, b.id("ps")), "opponent's response window", /window|respon|priority|tactic/i);
  assert.equal(b.engine.state.cards[b.id("ps")].faceDown, true);
  const own = fdBoard({ rage: 3 });
  flipUpRaw(own.engine, P1, own.id("ps"));
  assert.equal(own.engine.state.cards[own.id("ps")].faceDown ?? false, false, "control: outside a window it flips");
});

// ============================================================================
// Robustical Badass -- character (soldier), warlord, cost 4, [R], 3/3/3
// [R][R][R]: At the start of your turn, you may inflict 1 damage to an opponent's faction.
// ============================================================================
const RB = "c1cc2de0-3430-42e2-af02-ff9418a3bdd5";
function rbBoard(o: { rage?: number; greed?: number; spent?: number; rbZone?: "hand" | "play"; faceDown?: boolean; rbOwner?: P; p2rage?: number; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5,
    cards: [
      { key: "rb", def: printing(RB), owner: o.rbOwner ?? P1, zone: o.rbZone ?? "play", faceDown: o.faceDown },
      { key: "foeChar", def: character({ name: "FoeChar", life: 5 }), owner: P2, zone: "play" },
      { key: "myChar", def: character({ name: "MyChar", life: 5 }), owner: P1, zone: "play" },
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...bank("rage", o.p2rage ?? 0, P2),
      ...(o.extra ?? [])
    ] as Cards
  });
}
clause(RB, "0:rule@rrr", "printed card: warlord soldier character, cost 4, threshold r, 3 strength / 3 speed / 3 life", () => {
  const p = printing(RB);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual(p.subtype, ["soldier"]);
  assert.equal(p.cost, 4);
  assert.equal(p.threshold, "r");
  assert.equal(p.strength, 3);
  assert.equal(p.speed, 3);
  assert.equal(p.life, 3);
  const b = rbBoard();
  assert.equal(b.engine.getStat(b.id("rb"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("rb"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("rb"), "life"), 3);
});
clause(RB, "0:rule@rrr", "deploys for exactly 4 with an [R]: 3 rage is one short and 4 greed has no [R] icon", () => {
  const mk = (rage: number, greed: number) => rbBoard({ rbZone: "hand", rage, greed });
  const play1 = (b: ReturnType<typeof rbBoard>) => {
    b.engine.state.activePlayerId = P1;
    play(b.engine, P1, b.id("rb"));
  };
  const b = mk(4, 0);
  play1(b);
  assert.equal(zone(b.engine, b.id("rb")), "play");
  assert.equal(ready(b.engine), 0, "cost 4 paid");
  rf(() => play1(mk(3, 0)), "one short");
  rf(() => play1(mk(0, 4)), "one icon short ([R])");
  const mixed = mk(1, 3);
  play1(mixed);
  assert.equal(zone(mixed.engine, mixed.id("rb")), "play", "one [R] icon is enough to deploy");
});
const startOwnTurn = (b: ReturnType<typeof rbBoard>) => endTurn(b.engine, P2);
clause(RB, "0:rule@rrr", "with [R][R][R], at the start of your turn you are asked and accepting deals 1 damage to the opponent's faction", () => {
  const b = rbBoard();
  const before = [infl(b.engine, P1), infl(b.engine, P2)];
  startOwnTurn(b);
  assert.equal(b.engine.state.activePlayerId, P1);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before, "nothing yet while the choice waits");
  resolve(b.engine, { kind: "chooserSelectsOption", index: 1 });
  drain(b.engine, declineAll);
  assert.equal(infl(b.engine, P2), before[1] - 1, "opponent's faction takes 1");
  assert.equal(infl(b.engine, P1), before[0], "your faction is untouched");
  assert.equal(dmg(b.engine, b.id("foeChar")), 0, "no character is damaged");
  assert.equal(dmg(b.engine, b.id("myChar")), 0);
});
clause(RB, "0:rule@rrr", "'you may': declining deals no damage", () => {
  const b = rbBoard();
  const before = infl(b.engine, P2);
  startOwnTurn(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  resolve(b.engine, { kind: "chooserSelectsOption", index: 0 });
  drain(b.engine, declineAll);
  assert.equal(infl(b.engine, P2), before);
});
clause(RB, "0:rule@rrr", "the threshold needs three [R]: two rage + a greed does not trigger it", () => {
  const ok = rbBoard({ rage: 3 });
  startOwnTurn(ok);
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsOption", "positive control: rrr");
  const b = rbBoard({ rage: 2, greed: 1 });
  const before = infl(b.engine, P2);
  startOwnTurn(b);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(pending(b.engine), undefined, "rr + g is short of rrr");
  assert.equal(infl(b.engine, P2), before);
  const two = rbBoard({ rage: 2 });
  startOwnTurn(two);
  assert.equal(pending(two.engine), undefined, "rr alone is short");
});
clause(RB, "0:rule@rrr", "spent resources count toward the threshold (2 ready + 1 spent rage), and more than three also work", () => {
  const b = rbBoard({ rage: 2, spent: 1 });
  startOwnTurn(b);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  const many = rbBoard({ rage: 5 });
  startOwnTurn(many);
  assert.equal(pending(many.engine)?.kind, "chooserSelectsOption");
});
clause(RB, "0:rule@rrr", "it is 'your turn' only: the opponent's turn start does not trigger it", () => {
  const b = rbBoard();
  b.engine.state.activePlayerId = P1;
  b.engine.state.turn = 1 as never;
  const before = infl(b.engine, P2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(pending(b.engine), undefined);
  assert.equal(infl(b.engine, P2), before);
});
clause(RB, "0:rule@rrr", "it fires each of your turns (a second turn asks again)", () => {
  const b = rbBoard();
  startOwnTurn(b);
  resolve(b.engine, { kind: "chooserSelectsOption", index: 1 });
  drain(b.engine, declineAll);
  const mid = infl(b.engine, P2);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption");
  resolve(b.engine, { kind: "chooserSelectsOption", index: 1 });
  drain(b.engine, declineAll);
  assert.equal(infl(b.engine, P2), mid - 1);
});
clause(RB, "0:rule@rrr", "the controller's opponent is hit: a Robustical under the OTHER player's control damages the first player's faction", () => {
  const b = rbBoard({ rbOwner: P2, rage: 0, p2rage: 3 });
  b.engine.state.activePlayerId = P1;
  b.engine.state.turn = 1 as never;
  const before = [infl(b.engine, P1), infl(b.engine, P2)];
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const pc = pending(b.engine);
  assert.equal(pc?.kind, "chooserSelectsOption");
  assert.equal(pc?.playerId, P2);
  resolve(b.engine, { kind: "chooserSelectsOption", index: 1 });
  drain(b.engine, declineAll);
  assert.equal(infl(b.engine, P1), before[0] - 1);
  assert.equal(infl(b.engine, P2), before[1]);
});
clause(RB, "0:rule@rrr", "the threshold is the controller's: the opponent's resources do not enable it", () => {
  const b = rbBoard({ rage: 0, p2rage: 3 });
  startOwnTurn(b);
  assert.equal(pending(b.engine), undefined, "P1 has no [R] icons; P2's three do not count");
});
clause(RB, "0:rule@rrr", "only while in play and face-up: no trigger from the hand or when face-down", () => {
  const ok = rbBoard();
  startOwnTurn(ok);
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsOption", "positive control");
  const inHand = rbBoard({ rbZone: "hand" });
  startOwnTurn(inHand);
  assert.equal(pending(inHand.engine), undefined);
  const down = rbBoard({ faceDown: true });
  startOwnTurn(down);
  assert.equal(pending(down.engine), undefined);
});

// ============================================================================
// Seraphim Magic -- tactic, warlord, cost 3, [R][R]
// EXTRA COST: Pick a character. -- This turn, the character gains 3 strength. Draw a card.
// ============================================================================
const SM = "2bb93922-1ef1-49b3-b6b9-0d35905b1ab5";
function smBoard(o: { rage?: number; greed?: number; spent?: number; copies?: number } = {}) {
  const decks = (owner: P, pre: string): NonNullable<Cards> =>
    Array.from({ length: 4 }, (_, i) => ({ key: `${pre}${i}`, def: character({ name: `${pre}${i}` }), owner, zone: "deck" as const })) as NonNullable<Cards>;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "sm", def: printing(SM), owner: P1, zone: "hand" },
      ...(o.copies && o.copies > 1 ? [{ key: "sm2", def: printing(SM), owner: P1, zone: "hand" }] : []),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
      { key: "inDisc", def: character({ name: "InDisc" }), owner: P1, zone: "discard" },
      ...decks(P1, "mydeck"),
      ...decks(P2, "foedeck"),
      ...bank("rage", o.rage ?? 3, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0)
    ] as Cards
  });
}
const cast = (b: ReturnType<typeof smBoard>, target: string, card = "sm") =>
  play(b.engine, P1, b.id(card), { selected: { c: [b.id(target)] } });
clause(SM, "0:extraCost", "printed card: warlord tactic, cost 3, threshold rr", () => {
  const p = printing(SM);
  assert.equal(p.type, "tactic");
  assert.equal(p.trade, "warlord");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "rr");
});
clause(SM, "0:extraCost", "costs exactly 3: three rage works and spends all three; 2 rage is one short; 1 rage + 2 greed is an icon short", () => {
  const b = smBoard({ rage: 3 });
  cast(b, "mine");
  assert.equal(zone(b.engine, b.id("sm")), "discard");
  assert.equal(ready(b.engine), 0, "cost 3 paid");
  rf(() => cast(smBoard({ rage: 2 }), "mine"), "one short");
  rf(() => cast(smBoard({ rage: 1, greed: 2 }), "mine"), "one [R] short of rr");
  rf(() => cast(smBoard({ rage: 0, greed: 3 }), "mine"), "no [R] icons");
  const mix = smBoard({ rage: 2, greed: 1 });
  cast(mix, "mine");
  assert.equal(zone(mix.engine, mix.id("sm")), "discard", "rr + g is enough");
});
clause(SM, "0:extraCost", "the threshold may be met by spent resources while greed pays", () => {
  const b = smBoard({ rage: 0, greed: 3, spent: 2 });
  cast(b, "mine");
  assert.equal(zone(b.engine, b.id("sm")), "discard");
  assert.equal(ready(b.engine), 0);
  rf(() => cast(smBoard({ rage: 0, greed: 3, spent: 1 }), "mine"), "spent [R] alone is one icon short");
  rf(() => cast(smBoard({ rage: 0, greed: 2, spent: 2 }), "mine"), "spent cannot pay the cost");
});
clause(SM, "0:extraCost", "a character must be picked: none, an item, a character in hand or in the discard pile is refused; either player's in-play character is fine", () => {
  const ok = smBoard();
  cast(ok, "foe");
  assert.equal(zone(ok.engine, ok.id("sm")), "discard", "positive control (opponent's character)");
  const own = smBoard();
  cast(own, "mine");
  assert.equal(zone(own.engine, own.id("sm")), "discard", "your own character");
  const none = smBoard();
  rf(() => play(none.engine, P1, none.id("sm")), "no character picked");
  assert.equal(zone(none.engine, none.id("sm")), "hand");
  rf(() => cast(smBoard(), "it"), "an item");
  rf(() => cast(smBoard(), "inHand"), "a character in hand");
  rf(() => cast(smBoard(), "inDisc"), "a character in the discard pile");
  const two = smBoard();
  rf(() => play(two.engine, P1, two.id("sm"), { selected: { c: [two.id("mine"), two.id("foe")] } }), "only one character");
});
clause(SM, "0:extraCost", "the pick and the cost happen when the card is cast: the cost is already paid while the card waits to resolve", () => {
  const b = smBoard();
  playRaw(b.engine, P1, b.id("sm"), { selected: { c: [b.id("mine")] } });
  assert.equal(ready(b.engine), 0, "cost already paid while the card waits to resolve");
});
clause(SM, "1:rule", "the picked character gains 3 strength this turn; nobody else does", () => {
  const b = smBoard();
  cast(b, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 5, "2 + 3");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3, "unpicked opponent character unchanged");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4, "only strength");
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "only strength");
});
clause(SM, "1:rule", "an opponent's character can be the picked one: it gains 3 strength", () => {
  const b = smBoard();
  cast(b, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 6);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
});
clause(SM, "1:rule", "'this turn': the bonus is still there at the end of the turn and gone once the next turn starts", () => {
  const b = smBoard();
  cast(b, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 5);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "expired");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "and stays expired");
});
clause(SM, "1:rule", "two copies stack: +6 strength", () => {
  const b = smBoard({ rage: 6, copies: 2 });
  cast(b, "mine", "sm");
  cast(b, "mine", "sm2");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 8, "2 + 3 + 3");
  assert.equal(ready(b.engine), 0);
});
clause(SM, "1:rule", "draw a card: you draw the top card of your own deck, the opponent draws nothing", () => {
  const b = smBoard();
  const myDeck = [...b.engine.state.players[P1].deck];
  const foeDeck = [...b.engine.state.players[P2].deck];
  const foeHand = [...b.engine.state.players[P2].hand];
  cast(b, "mine");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(b.engine.state.players[P1].hand, [myDeck[0]], "the tactic left the hand, exactly the top card was drawn");
  assert.deepEqual(b.engine.state.players[P1].deck, myDeck.slice(1));
  assert.deepEqual(b.engine.state.players[P2].deck, foeDeck);
  assert.deepEqual(b.engine.state.players[P2].hand, foeHand);
});
clause(SM, "1:rule", "you draw even when the opponent's character is the pick (the controller draws)", () => {
  const b = smBoard();
  const myDeck = [...b.engine.state.players[P1].deck];
  const foeDeck = [...b.engine.state.players[P2].deck];
  cast(b, "foe");
  assert.deepEqual(b.engine.state.players[P1].hand, [myDeck[0]]);
  assert.deepEqual(b.engine.state.players[P2].deck, foeDeck);
});

// ============================================================================
// Spitting Sarume -- character (dragon), warlord, cost 5, [R], 3/3/2
// When this card enters play, inflict 1 damage to all characters an opponent controls.
// FLIP UP: 3 [R]
// ============================================================================
const SS = "ece06645-25f1-4680-9785-30a0a22b7837";
function ssBoard(o: { rage?: number; greed?: number; spent?: number; ssZone?: "hand" | "play"; faceDown?: boolean; extra?: Cards } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "ss", def: printing(SS), owner: P1, zone: o.ssZone ?? "hand", faceDown: o.faceDown },
      { key: "f1", def: character({ name: "F1", life: 3 }), owner: P2, zone: "play" },
      { key: "f2", def: character({ name: "F2", life: 1 }), owner: P2, zone: "play" },
      { key: "f3", def: character({ name: "F3", life: 4 }), owner: P2, zone: "play" },
      { key: "foeItem", def: item({ name: "FoeItem" }), owner: P2, zone: "play" },
      { key: "fd", def: character({ name: "FD", life: 3 }), owner: P2, zone: "play", faceDown: true },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", life: 3 }), owner: P2, controller: P1, zone: "play" },
      { key: "lent", def: character({ name: "Lent", life: 3 }), owner: P1, controller: P2, zone: "play" },
      ...bank("rage", o.rage ?? 5, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...(o.extra ?? [])
    ] as Cards
  });
}
const deploySs = (b: ReturnType<typeof ssBoard>) => {
  play(b.engine, P1, b.id("ss"));
  drain(b.engine, declineAll);
};
clause(SS, "0:rule", "printed card: warlord dragon character, cost 5, threshold r, 3 strength / 3 speed / 2 life", () => {
  const p = printing(SS);
  assert.equal(p.type, "character");
  assert.equal(p.trade, "warlord");
  assert.deepEqual(p.subtype, ["dragon"]);
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "r");
  assert.equal(p.strength, 3);
  assert.equal(p.speed, 3);
  assert.equal(p.life, 2);
  const b = ssBoard({ ssZone: "play" });
  assert.equal(b.engine.getStat(b.id("ss"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("ss"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("ss"), "life"), 2);
});
clause(SS, "0:rule", "deploys for exactly 5 with an [R]: 4 rage is one short, 5 greed has no [R]; 1 rage + 4 greed works", () => {
  const b = ssBoard({ rage: 5 });
  deploySs(b);
  assert.equal(zone(b.engine, b.id("ss")), "play");
  assert.equal(ready(b.engine), 0, "cost 5 paid");
  rf(() => deploySs(ssBoard({ rage: 4 })), "one short");
  rf(() => deploySs(ssBoard({ rage: 0, greed: 5 })), "no [R] icon");
  const mixed = ssBoard({ rage: 1, greed: 4 });
  deploySs(mixed);
  assert.equal(zone(mixed.engine, mixed.id("ss")), "play");
});
clause(SS, "0:rule", "entering play deals 1 damage to each character an opponent controls", () => {
  const b = ssBoard();
  deploySs(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(dmg(b.engine, b.id("f1")), 1);
  assert.equal(dmg(b.engine, b.id("f3")), 1);
  assert.equal(dmg(b.engine, b.id("lent")), 1, "controlled by the opponent although you own it");
  assert.equal(zone(b.engine, b.id("f1")), "play");
});
clause(SS, "0:rule", "a 1-life opposing character is destroyed by the damage; the 3- and 4-life ones survive", () => {
  const b = ssBoard();
  deploySs(b);
  assert.equal(zone(b.engine, b.id("f2")), "discard");
  assert.equal(zone(b.engine, b.id("f1")), "play");
  assert.equal(zone(b.engine, b.id("f3")), "play");
});
clause(SS, "0:rule", "only characters an opponent controls: your own, ones you control but they own, Sarume itself, items, and the factions are untouched", () => {
  const b = ssBoard();
  const before = [infl(b.engine, P1), infl(b.engine, P2)];
  deploySs(b);
  assert.equal(dmg(b.engine, b.id("mine")), 0, "your character");
  assert.equal(dmg(b.engine, b.id("stolen")), 0, "owned by them, controlled by you");
  assert.equal(dmg(b.engine, b.id("ss")), 0, "Sarume itself");
  assert.equal(dmg(b.engine, b.id("foeItem")), 0, "their item");
  assert.deepEqual([infl(b.engine, P1), infl(b.engine, P2)], before, "no faction damage");
});
clause(SS, "0:rule", "a face-down card (a resource) is not a character an opponent controls", () => {
  const b = ssBoard();
  deploySs(b);
  assert.equal(dmg(b.engine, b.id("fd")), 0);
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
});
clause(SS, "0:rule", "it triggers only for Sarume itself: another card entering later deals no further damage", () => {
  const b = ssBoard({ rage: 5, extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] as Cards });
  deploySs(b);
  assert.equal(dmg(b.engine, b.id("f1")), 1);
  play(b.engine, P1, b.id("newbie"));
  drain(b.engine, declineAll);
  assert.equal(dmg(b.engine, b.id("f1")), 1, "unchanged");
  assert.equal(dmg(b.engine, b.id("f3")), 1);
});
clause(SS, "0:rule", "with no opposing characters nothing happens", () => {
  const b = ssBoard();
  for (const k of ["f1", "f2", "f3", "lent"]) b.engine.state.cards[b.id(k)].zone = "discard" as never;
  deploySs(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zone(b.engine, b.id("ss")), "play");
  assert.equal(dmg(b.engine, b.id("mine")), 0);
});
const fdSs = (o: { rage?: number; greed?: number; spent?: number } = {}) =>
  ssBoard({ ssZone: "play", faceDown: true, rage: o.rage ?? 0, greed: o.greed ?? 0, spent: o.spent });
clause(SS, "1:flipUp", "FLIP UP costs 3 with [R]: it comes face-up; the card may help pay for itself (1 rage... + itself + 1 other)", () => {
  const b = fdSs({ rage: 2 });
  flipUpRaw(b.engine, P1, b.id("ss"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("ss")].faceDown ?? false, false);
  assert.equal(zone(b.engine, b.id("ss")), "play");
  const rich = fdSs({ rage: 5 });
  flipUpRaw(rich.engine, P1, rich.id("ss"));
  drain(rich.engine, declineAll);
  assert.ok([2, 3].includes(ready(rich.engine)), `3 paid out of 5 (+itself): ${ready(rich.engine)} left`);
});
clause(SS, "1:flipUp", "FLIP UP is refused one short of 3 (1 rage + itself) and with no [R] icon (greed only)", () => {
  const ok = fdSs({ rage: 2 });
  flipUpRaw(ok.engine, P1, ok.id("ss"));
  assert.equal(ok.engine.state.cards[ok.id("ss")].faceDown ?? false, false, "positive control");
  const short = fdSs({ rage: 1, spent: 1 });
  rf(() => flipUpRaw(short.engine, P1, short.id("ss")), "one short of cost 3 (threshold met by a spent [R])", /FLIP UP costs cannot be paid/);
  assert.equal(short.engine.state.cards[short.id("ss")].faceDown, true);
  const noIcon = fdSs({ rage: 0, greed: 4 });
  rf(() => flipUpRaw(noIcon.engine, P1, noIcon.id("ss")), "no [R] icon");
  assert.equal(noIcon.engine.state.cards[noIcon.id("ss")].faceDown, true);
});
clause(SS, "1:flipUp", "the [R] threshold may be met by a spent rage while greed pays the cost", () => {
  const b = fdSs({ rage: 0, greed: 3, spent: 1 });
  flipUpRaw(b.engine, P1, b.id("ss"));
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.cards[b.id("ss")].faceDown ?? false, false);
  const no = fdSs({ rage: 0, greed: 3, spent: 0 });
  rf(() => flipUpRaw(no.engine, P1, no.id("ss")), "no [R] icon anywhere");
});
clause(SS, "1:flipUp", "the card's own icon does not count toward its threshold", () => {
  const b = fdSs({ rage: 0, greed: 3 });
  rf(() => flipUpRaw(b.engine, P1, b.id("ss")), "threshold is checked after flipping: its own icon doesn't help");
});
clause(SS, "1:flipUp", "flipping up plays the card as though from hand, so its enters-play damage happens: 1 damage to each opposing character", () => {
  const b = fdSs({ rage: 3 });
  flipUpRaw(b.engine, P1, b.id("ss"));
  drain(b.engine, declineAll);
  assert.equal(dmg(b.engine, b.id("f1")), 1);
  assert.equal(dmg(b.engine, b.id("f3")), 1);
  assert.equal(zone(b.engine, b.id("f2")), "discard", "the 1-life one dies");
  assert.equal(dmg(b.engine, b.id("mine")), 0);
  assert.equal(b.engine.state.cards[b.id("ss")].faceDown ?? false, false);
});
clause(SS, "1:flipUp", "a character's FLIP UP is refused on the opponent's turn when no window is open (CR 507.4d)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5,
    cards: [{ key: "ss", def: printing(SS), owner: P1, zone: "play", faceDown: true }, ...bank("rage", 3, P1)] as Cards
  });
  rf(() => flipUpRaw(b.engine, P1, b.id("ss")), "opponent's turn, no window", /turn|priority|timing/i);
  assert.equal(b.engine.state.cards[b.id("ss")].faceDown, true);
});
clause(SS, "1:flipUp", "a non-tactic FLIP UP is refused inside the opponent's response window", () => {
  const mk = () => {
    const g = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      random: () => 0.5,
      cards: [
        { key: "ss", def: printing(SS), owner: P1, zone: "play", faceDown: true },
        { key: "att", def: character({ name: "Att", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
        ...bank("rage", 3, P1)
      ] as Cards
    });
    return g;
  };
  const b = mk();
  declareAttackOpenWindow(b.engine, P2, [b.id("att")]);
  assert.ok(b.engine.state.responseWindow, "the response window is open");
  assert.equal((b.engine.state.responseWindow as unknown as { priorityPlayerId: string }).priorityPlayerId, P1, "the defender holds priority");
  rf(() => flipUpRaw(b.engine, P1, b.id("ss")), "opponent's response window", /window|respon|priority|tactic/i);
  assert.equal(b.engine.state.cards[b.id("ss")].faceDown, true);
  const own = fdSs({ rage: 3 });
  flipUpRaw(own.engine, P1, own.id("ss"));
  assert.equal(own.engine.state.cards[own.id("ss")].faceDown ?? false, false, "control: outside a window it flips");
});
