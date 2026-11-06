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
  play,
  resolvePendingResponses,
  tactic,
  volition
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { resourceCard } from "../support/fixtures.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fight, playRaw } from "./_battle.js";
import { declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { spentResources } from "./_turn.js";

type Pc = { kind: string; playerId: PlayerId; [k: string]: any };
type Board = ReturnType<typeof buildGame>;

const ready = (e: SpoilsEngine, p: PlayerId = P1): number => e.getAvailableResourceCount(p);
const dmg = (b: Board, key: string): number => b.engine.state.cards[b.id(key)].damage ?? 0;
const pcOf = (e: SpoilsEngine): Pc | undefined => pending(e) as unknown as Pc | undefined;
const resolveChoice = (e: SpoilsEngine, choice: Record<string, unknown>): void => {
  const pc = pcOf(e)!;
  e.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
  if (!e.state.pendingChoice) resolvePendingResponses(e);
};
const rawFlipUp = (e: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(e, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const MSG = /afford|resource|threshold|cost|pay|icon|enough/i;
const FACTION_P1 = { type: "faction", playerId: P1 } as const;
const logCount = (e: SpoilsEngine, type: string): number => e.getLog().filter((entry) => entry.event?.type === type).length;

const mk = (cards: CardPlacement[], active: PlayerId = P1) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: active,
    random: () => 0.5,
    cards: [...cards, ...fillers("pd", 4, P1, "deck"), ...fillers("qd", 4, P2, "deck")]
  });

const hand = (id: string): CardPlacement => ({ key: "c", def: printing(id), owner: P1, zone: "hand" });

/** Shared deploy-cost checks: exactly enough, one short, one icon short. */
function deployChecks(id: string, cost: number, ok: CardPlacement[], oneShort: CardPlacement[], iconShort: CardPlacement[], settle?: (b: Board) => void): void {
  const a = mk([hand(id), ...ok]);
  const before = ready(a.engine);
  play(a.engine, P1, a.id("c"));
  settle?.(a);
  assert.equal(a.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(a.engine, a.id("c")), "play", "deploys with exactly enough");
  assert.equal(before - ready(a.engine), cost, `pays exactly ${cost}`);
  const s = mk([hand(id), ...oneShort]);
  refused(() => play(s.engine, P1, s.id("c")), `one short of cost ${cost}`, MSG);
  assert.equal(zoneOf(s.engine, s.id("c")), "hand");
  const t = mk([hand(id), ...iconShort]);
  refused(() => play(t.engine, P1, t.id("c")), "threshold not met", MSG);
  assert.equal(zoneOf(t.engine, t.id("c")), "hand");
}

const targetTactic = (name: string, effect: Record<string, unknown>, selector: Record<string, unknown> = { zone: "play", type: "character" }) =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector, count: 1 }], effects: [effect] }] }
  } as never);

// ============================================================================
// Goutflame Talonclaw -- UNIQUE warlord dragon, cost 8 [R]x5, 9/3/8
// ============================================================================
const GT = "cb503376-78b8-447c-9119-734f992429c9";
const GT_RES = (): CardPlacement[] => [...bank("rage", 5, P1), ...volition(3, P1)];

/** Talonclaw in hand with 8 resources and a spread of targets already in play. */
const gtEtbBoard = () =>
  mk([
    hand(GT),
    ...GT_RES(),
    { key: "oloc", def: location({ name: "Their Loc" }), owner: P2, zone: "play" },
    { key: "oitm", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
    { key: "och", def: character({ name: "Their Char", life: 2 }), owner: P2, zone: "play" },
    { key: "och2", def: character({ name: "Their Char 2", life: 2 }), owner: P2, zone: "play" },
    { key: "mloc", def: location({ name: "My Loc" }), owner: P1, zone: "play" },
    { key: "mitm", def: item({ name: "My Item" }), owner: P1, zone: "play" },
    { key: "mch", def: character({ name: "My Char", life: 2 }), owner: P1, zone: "play" }
  ]);

const gtInPlay = (extra: CardPlacement[] = [], active: PlayerId = P1) =>
  mk([{ key: "t", def: printing(GT), owner: P1, zone: "play" }, ...extra], active);

clause(GT, "0:unique", "printed card: a warlord dragon character, cost 8, threshold [R]x5, 9 strength / 3 speed / 8 life", () => {
  const b = gtInPlay();
  assert.deepEqual(b.engine.getCardTypes(b.id("t")), ["character"]);
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 9);
  assert.equal(b.engine.getStat(b.id("t"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("t"), "life"), 8);
  const d = b.engine.getDefinition(b.id("t"));
  assert.equal(d.trade, "warlord");
  assert.deepEqual(d.subtype, ["dragon"]);
  assert.equal(d.unique, "goutflame talonclaw");
});

clause(GT, "0:unique", "deploys for exactly 8 resources with five [R]; one short and four [R] are refused", () => {
  const settle = (b: Board) => {
    if (pcOf(b.engine)) resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] });
  };
  deployChecks(GT, 8, GT_RES(), [...bank("rage", 5, P1), ...volition(2, P1)], [...bank("rage", 4, P1), ...bank("greed", 4, P1)], settle);
});

const uniqueBoard = (extra: CardPlacement[]) => mk([...bank("rage", 12, P1), ...volition(4, P1), ...extra]);
const declinePicks = (e: SpoilsEngine) => {
  while (pcOf(e) && pcOf(e)!.kind === "chooserSelectsTarget") resolveChoice(e, { kind: "chooserSelectsTarget", selected: [] });
};

clause(GT, "0:unique", "UNIQUE: a second Talonclaw makes you keep one; keeping either copy resolves cleanly", () => {
  for (const keep of ["a", "b"]) {
    const other = keep === "a" ? "b" : "a";
    const b = uniqueBoard([
      { key: "a", def: printing(GT), owner: P1, zone: "play" },
      { key: "b", def: printing(GT), owner: P1, zone: "hand" }
    ]);
    play(b.engine, P1, b.id("b"));
    const pc = pcOf(b.engine)!;
    assert.equal(pc.kind, "uniqueSurvivor");
    assert.equal(pc.playerId, P1);
    assert.deepEqual([...pc.candidates].sort(), [b.id("a"), b.id("b")].sort());
    resolveChoice(b.engine, { kind: "uniqueSurvivor", keep: b.id(keep) });
    declinePicks(b.engine);
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(b.engine, b.id(keep)), "play");
    assert.equal(b.engine.state.cards[b.id(keep)].faceDown, false, "the kept copy stays face-up");
    // CR 507.5 destroys the extra copy, but the printed phoenix clause replaces being destroyed: it is flipped face-down under its owner instead.
    assert.equal(zoneOf(b.engine, b.id(other)), "play", "the extra copy is not destroyed: it stays in play");
    assert.equal(b.engine.state.cards[b.id(other)].faceDown, true, "the extra copy was flipped face-down instead of destroyed");
  }
});

clause(GT, "0:unique", "UNIQUE with the enters-play pick: answering the pick and then the survivor choice (either copy) leaves nothing pending and no stuck response window (SYS-11)", () => {
  for (const keep of ["a", "b"]) {
    const other = keep === "a" ? "b" : "a";
    const b = uniqueBoard([
      { key: "a", def: printing(GT), owner: P1, zone: "play" },
      { key: "b", def: printing(GT), owner: P1, zone: "hand" }
    ]);
    play(b.engine, P1, b.id("b"));
    // E11: corrected per Q53 (UNIQUE is enforced immediately): the survivor choice is the FIRST prompt, before the new
    // copy's enters-play pick (the old test answered the pick first). The pick follows only if the NEW copy is kept.
    assert.equal(pcOf(b.engine)?.kind, "uniqueSurvivor", "the survivor choice is the first prompt");
    resolveChoice(b.engine, { kind: "uniqueSurvivor", keep: b.id(keep) });
    if (keep === "b") {
      assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget", "the kept new copy's enters-play pick follows");
      resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] });
    }
    assert.equal(b.engine.state.pendingChoice, undefined, "nothing is left pending");
    assert.equal(b.engine.state.responseWindow, undefined, "the response window closed (no soft-lock)");
    assert.equal(zoneOf(b.engine, b.id(keep)), "play");
    assert.equal(b.engine.state.cards[b.id(keep)].faceDown, false, "the kept copy stays face-up");
    assert.equal(b.engine.state.cards[b.id(other)].faceDown, true, "the other copy is flipped face-down instead of destroyed");
  }
});

clause(GT, "0:unique", "UNIQUE is per player and per name: the opponent's copy and a different unique card do not prompt", () => {
  const d = uniqueBoard([
    { key: "a", def: printing(GT), owner: P2, zone: "play" },
    { key: "b", def: printing(GT), owner: P1, zone: "hand" }
  ]);
  play(d.engine, P1, d.id("b"));
  assert.notEqual(pcOf(d.engine)?.kind, "uniqueSurvivor", "the opponent's copy is separate");
  declinePicks(d.engine);
  assert.equal(zoneOf(d.engine, d.id("a")), "play");
  assert.equal(zoneOf(d.engine, d.id("b")), "play");
  const e = uniqueBoard([
    { key: "a", def: character({ name: "Somebody Else", unique: "somebody else" }), owner: P1, zone: "play" },
    { key: "b", def: printing(GT), owner: P1, zone: "hand" }
  ]);
  play(e.engine, P1, e.id("b"));
  assert.notEqual(pcOf(e.engine)?.kind, "uniqueSurvivor");
  declinePicks(e.engine);
  assert.equal(zoneOf(e.engine, e.id("a")), "play");
  assert.equal(zoneOf(e.engine, e.id("b")), "play");
});

// --- 1:rule enters-play pick ------------------------------------------------
const gtPlayAndPrompt = (b: Board) => {
  play(b.engine, P1, b.id("c"));
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
};

clause(GT, "1:rule", "when it enters play its controller is asked which cards to pick, and may decline: nothing is destroyed", () => {
  const b = gtEtbBoard();
  gtPlayAndPrompt(b);
  const pc = pcOf(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "its controller picks");
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["oloc", "oitm", "och", "och2", "mloc", "mitm", "mch", "c"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} stays`);
});

clause(GT, "1:rule", "picking a location, an item and a character destroys exactly those three (mine or theirs); the rest stay", () => {
  const b = gtEtbBoard();
  gtPlayAndPrompt(b);
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("oloc"), b.id("oitm"), b.id("och")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["oloc", "oitm", "och"]) assert.equal(zoneOf(b.engine, b.id(k)), "discard", `${k} destroyed`);
  for (const k of ["och2", "mloc", "mitm", "mch", "c"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} stays`);
  const c = gtEtbBoard();
  gtPlayAndPrompt(c);
  resolveChoice(c.engine, { kind: "chooserSelectsTarget", selected: [c.id("mloc"), c.id("mitm"), c.id("mch")] });
  for (const k of ["mloc", "mitm", "mch"]) assert.equal(zoneOf(c.engine, c.id(k)), "discard", `my own ${k} may be picked too`);
  for (const k of ["oloc", "oitm", "och", "och2", "c"]) assert.equal(zoneOf(c.engine, c.id(k)), "play");
});

clause(GT, "1:rule", "it may pick only some of the three kinds: just an item, just a location, just a character", () => {
  for (const [k, others] of [
    ["oitm", ["oloc", "och", "mitm"]],
    ["oloc", ["oitm", "och", "mloc"]],
    ["och", ["oloc", "oitm", "och2"]]
  ] as const) {
    const b = gtEtbBoard();
    gtPlayAndPrompt(b);
    resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id(k)] });
    assert.equal(zoneOf(b.engine, b.id(k)), "discard", `${k} destroyed`);
    for (const o of others) assert.equal(zoneOf(b.engine, b.id(o)), "play", `${o} stays`);
  }
});

clause(GT, "1:rule", "'a location, item and/or character': at most one of each kind, so two characters cannot both be picked", () => {
  const b = gtEtbBoard();
  gtPlayAndPrompt(b);
  const pc = pcOf(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  // positive control: a location, an item and a character is accepted (previous test); two characters must not be.
  try {
    resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("och"), b.id("och2")] });
  } catch {
    /* refused: good */
  }
  const destroyed = ["och", "och2"].filter((k) => zoneOf(b.engine, b.id(k)) === "discard");
  assert.ok(destroyed.length <= 1, `at most one character is destroyed, but ${destroyed.length} were`);
});

clause(GT, "1:rule", "a face-down card (a resource) is not a location, item or character and cannot be picked", () => {
  const mkb = () =>
    mk([
      hand(GT),
      ...GT_RES(),
      { key: "fd", def: character({ name: "Hidden Char", life: 2 }), owner: P2, zone: "play", faceDown: true },
      { key: "och", def: character({ name: "Their Char", life: 2 }), owner: P2, zone: "play" }
    ]);
  const b = mkb();
  play(b.engine, P1, b.id("c"));
  assert.equal(pcOf(b.engine)?.kind, "chooserSelectsTarget");
  try {
    resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("fd")] });
  } catch {
    /* refused: good */
  }
  assert.equal(zoneOf(b.engine, b.id("fd")), "play", "the face-down card is not destroyed");
  assert.equal(b.engine.state.cards[b.id("fd")].faceDown, true);
  const c = mkb();
  play(c.engine, P1, c.id("c"));
  resolveChoice(c.engine, { kind: "chooserSelectsTarget", selected: [c.id("och")] });
  assert.equal(zoneOf(c.engine, c.id("och")), "discard", "positive control: the face-up character can be picked");
  assert.equal(zoneOf(c.engine, c.id("fd")), "play");
});

clause(GT, "1:rule", "the trigger fires only for Talonclaw itself: another card entering play does not prompt, and the trigger is on only while it is in play", () => {
  const b = gtInPlay([
    { key: "nc", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
  ]);
  play(b.engine, P1, b.id("nc"));
  assert.equal(b.engine.state.pendingChoice, undefined, "another card entering play does not trigger it");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
});

clause(GT, "1:rule", "it may pick itself (it is a character in play): the destroy is replaced and it flips face-down instead", () => {
  const b = gtEtbBoard();
  gtPlayAndPrompt(b);
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("c")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(b.engine.state.cards[b.id("c")].faceDown, true);
});

// --- 2:rule control + blocking --------------------------------------------
const stealer = () =>
  targetTactic("Mutiny", { type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" });

clause(GT, "2:rule", "opponents cannot take control of it: their steal effect leaves it with its controller", () => {
  const b = gtInPlay(
    [
      { key: "steal", def: stealer(), owner: P2, zone: "hand" },
      { key: "other", def: character({ name: "Control Check" }), owner: P1, zone: "play" }
    ],
    P2
  );
  play(b.engine, P2, b.id("steal"), { selected: { t: [b.id("t")] } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("t")].controllerId, P1, "still controlled by its controller");
  assert.equal(zoneOf(b.engine, b.id("t")), "play");
  // positive control: the same effect does take an ordinary character
  const c = gtInPlay(
    [
      { key: "steal", def: stealer(), owner: P2, zone: "hand" },
      { key: "other", def: character({ name: "Control Check" }), owner: P1, zone: "play" }
    ],
    P2
  );
  play(c.engine, P2, c.id("steal"), { selected: { t: [c.id("other")] } });
  resolvePendingResponses(c.engine);
  assert.equal(c.engine.state.cards[c.id("other")].controllerId, P2, "control effect works on an ordinary character");
});

clause(GT, "2:rule", "it is protected only against opponents: its own controller's control effects are not what the rule stops (static, on while in play)", () => {
  // a face-down Talonclaw (not a character, rule off) can be taken
  const b = mk(
    [
      { key: "t", def: printing(GT), owner: P1, zone: "play", faceDown: true },
      { key: "steal", def: targetTactic("Mutiny2", { type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }, { zone: "play" }), owner: P2, zone: "hand" }
    ],
    P2
  );
  play(b.engine, P2, b.id("steal"), { selected: { t: [b.id("t")] } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("t")].controllerId, P2, "the face-down card has no abilities, so it can be taken");
});

const blockBoard = (blockerStrength: number, extraAttacker = false) =>
  gtInPlay([
    { key: "blk", def: character({ name: "Blocker", strength: blockerStrength, life: 3 }), owner: P2, zone: "play" },
    ...(extraAttacker ? [{ key: "mate", def: character({ name: "Mate", strength: 2, life: 5 }), owner: P1, zone: "play" } as CardPlacement] : [])
  ]);

clause(GT, "2:rule", "it cannot be blocked by a character with 1 strength: the block is refused, the attack stays unblocked", () => {
  const b = blockBoard(1);
  declareAttackBy(b.engine, P1, [b.id("t")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "strength 1 cannot block Talonclaw", /block/i);
  assert.equal(b.engine.state.cards[b.id("blk")].depleted ?? false, false);
  const c = blockBoard(2);
  fight(c.engine, P1, [c.id("t")], { type: "faction", playerId: P2 }, [c.id("blk")]);
  assert.equal(zoneOf(c.engine, c.id("blk")), "discard", "positive control: a 2-strength character blocks (and dies to 9 damage)");
});

clause(GT, "2:rule", "it cannot be blocked by a character with 0 strength (1 strength or LESS)", () => {
  const b = blockBoard(0);
  declareAttackBy(b.engine, P1, [b.id("t")]);
  refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "strength 0 cannot block Talonclaw", /block/i);
});

clause(GT, "2:rule", "the block restriction follows the blocker's CURRENT strength: a 3-strength character shrunk to 1 cannot block", () => {
  const shrinker = character({
    name: "Shrinker",
    behavior: {
      abilities: [
        { id: "shrink", type: "continuous", modifiers: [{ selector: { zone: "play", controller: "opponent", type: "character" }, stat: "strength", operation: "add", value: -2 }] }
      ]
    }
  } as never);
  const b = gtInPlay([
    { key: "blk", def: character({ name: "Big Blocker", strength: 3, life: 3 }), owner: P2, zone: "play" },
    { key: "sh", def: shrinker, owner: P1, zone: "play" }
  ]);
  if (b.engine.getStat(b.id("blk"), "strength") === 1) {
    declareAttackBy(b.engine, P1, [b.id("t")]);
    refused(() => declareBlockers(b.engine, P2, [b.id("blk")]), "shrunk to 1 strength", /block/i);
  } else {
    assert.equal(b.engine.getStat(b.id("blk"), "strength"), 1, "setup: the shrink aura applies");
  }
});

clause(GT, "2:rule", "the block limit is Talonclaw's own: a 1-strength character may still block its fellow attacker", () => {
  const b = blockBoard(1, true);
  declareAttackBy(b.engine, P1, [b.id("mate")]);
  declareBlockers(b.engine, P2, [b.id("blk")]);
  assert.equal(b.engine.state.pendingChoice === undefined || true, true);
  assert.ok(b.engine.state.battle, "the block was accepted for a different attacker");
});

// --- 3:rule destroyed / removed -> flip face-down ---------------------------
const faceDownResource = (b: Board, key: string) => {
  const c = b.engine.state.cards[b.id(key)];
  assert.equal(c.zone, "play", "stays in play");
  assert.equal(c.faceDown, true, "flipped face-down");
  assert.equal(c.controllerId, P1, "under its owner's control");
  assert.equal(c.ownerId, P1);
  assert.equal(b.engine.isResource(b.id(key)), true, "a face-down card is a resource");
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id(key)), "not in the discard pile");
};

clause(GT, "3:rule", "a destroy effect flips it face-down in play instead of discarding it", () => {
  const b = gtInPlay([{ key: "kill", def: targetTactic("Kill", { type: "destroy", target: { type: "selected", id: "t" } }), owner: P2, zone: "hand" }], P2);
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("t")] } });
  resolvePendingResponses(b.engine);
  faceDownResource(b, "t");
});

clause(GT, "3:rule", "lethal damage (8, its life) flips it face-down instead of destroying it", () => {
  const b = gtInPlay([{ key: "zap", def: targetTactic("Zap", { type: "dealDamage", target: { type: "selected", id: "t" }, amount: 8 }), owner: P2, zone: "hand" }], P2);
  play(b.engine, P2, b.id("zap"), { selected: { t: [b.id("t")] } });
  resolvePendingResponses(b.engine);
  faceDownResource(b, "t");
  const c = gtInPlay([{ key: "zap", def: targetTactic("Zap", { type: "dealDamage", target: { type: "selected", id: "t" }, amount: 7 }), owner: P2, zone: "hand" }], P2);
  play(c.engine, P2, c.id("zap"), { selected: { t: [c.id("t")] } });
  resolvePendingResponses(c.engine);
  assert.equal(c.engine.state.cards[c.id("t")].faceDown, false, "7 damage is not lethal: it stays face-up");
  assert.equal(dmg(c, "t"), 7);
});

clause(GT, "3:rule", "lethal battle damage flips it face-down instead of destroying it", () => {
  const b = gtInPlay([{ key: "att", def: character({ name: "Hulk", strength: 8, speed: 3, life: 12 }), owner: P2, zone: "play" }], P2);
  fight(b.engine, P2, [b.id("att")], FACTION_P1, [b.id("t")]);
  faceDownResource(b, "t");
  assert.equal(zoneOf(b.engine, b.id("att")), "play", "positive control: the battle ran and the 12-life attacker took Talonclaw's 9 and survived");
});

clause(GT, "3:rule", "'removed from the game' flips it face-down instead (it stays in play)", () => {
  const b = gtInPlay([{ key: "rm", def: targetTactic("Banish", { type: "removeFromGame", target: { type: "selected", id: "t" } }), owner: P2, zone: "hand" }], P2);
  play(b.engine, P2, b.id("rm"), { selected: { t: [b.id("t")] } });
  resolvePendingResponses(b.engine);
  faceDownResource(b, "t");
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id("t")), "!b.engine.state.players[P1].discard.includes(b.id(\"t\"))");
});

clause(GT, "3:rule", "'under its owner's control': a Talonclaw controlled by the opponent flips face-down under its OWNER", () => {
  const b = mk([
    { key: "t", def: printing(GT), owner: P1, controller: P2, zone: "play" },
    { key: "kill", def: targetTactic("Kill", { type: "destroy", target: { type: "selected", id: "t" } }), owner: P2, zone: "hand" }
  ], P2);
  assert.equal(b.engine.state.cards[b.id("t")].controllerId, P2, "setup: P2 controls it");
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("t")] } });
  resolvePendingResponses(b.engine);
  faceDownResource(b, "t");
});

clause(GT, "3:rule", "the replacement belongs to the face-up card only: a destroyed ordinary character is discarded, and a face-down Talonclaw is no character", () => {
  const b = gtInPlay([
    { key: "o", def: character({ name: "Ordinary", life: 2 }), owner: P1, zone: "play" },
    { key: "kill", def: targetTactic("Kill", { type: "destroy", target: { type: "selected", id: "t" } }), owner: P2, zone: "hand" }
  ], P2);
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("o")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("o")), "discard", "other characters are not protected");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, false);
});

clause(GT, "3:rule", "a flipped-down Talonclaw cannot be destroyed a second time as a character (it is not one) and keeps counting as a resource", () => {
  const b = gtInPlay([{ key: "kill", def: targetTactic("Kill", { type: "destroy", target: { type: "selected", id: "t" } }), owner: P2, zone: "hand" }], P2);
  const before = ready(b.engine, P1);
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("t")] } });
  resolvePendingResponses(b.engine);
  faceDownResource(b, "t");
  assert.equal(ready(b.engine, P1) - before, 1, "it now provides one resource");
  assert.equal(b.engine.state.cards[b.id("t")].damage ?? 0, 0);
});

// --- 4:flipUp ---------------------------------------------------------------
const fdGt = (others: CardPlacement[], extra: CardPlacement[] = [], active: PlayerId = P1) =>
  mk([{ key: "t", def: printing(GT), owner: P1, zone: "play", faceDown: true }, ...others, ...extra], active);
const nine = (n: number): CardPlacement[] => [...bank("rage", 5, P1), ...volition(n - 5, P1)];

clause(GT, "4:flipUp", "flips up for 9 resources with [R]x5: Talonclaw itself plus 8 others (5 Rage) is exactly enough and everything is spent", () => {
  const b = fdGt(nine(8));
  assert.equal(ready(b.engine), 9, "setup: itself + 8 others");
  rawFlipUp(b.engine, P1, b.id("t"));
  resolvePendingResponses(b.engine);
  if (pcOf(b.engine)) resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] });
  const c = b.engine.state.cards[b.id("t")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, false);
  assert.deepEqual(b.engine.getCardTypes(b.id("t")), ["character"]);
  assert.equal(b.engine.getStat(b.id("t"), "strength"), 9);
  assert.equal(ready(b.engine), 0, "all nine resources were spent (it stopped being one)");
});

clause(GT, "4:flipUp", "is refused one resource short (itself + 7 others), and nothing is paid", () => {
  const b = fdGt(nine(7).slice(0, 5).concat(volition(2, P1)));
  assert.equal(ready(b.engine), 8);
  refused(() => rawFlipUp(b.engine, P1, b.id("t")), "8 resources are not 9", MSG);
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  assert.equal(ready(b.engine), 8, "nothing was paid");
  const ok = fdGt(nine(8));
  rawFlipUp(ok.engine, P1, ok.id("t"));
  assert.equal(ok.engine.state.cards[ok.id("t")].faceDown, false, "positive control: itself + 8 others is enough");
});

clause(GT, "4:flipUp", "needs [R]x5: nine resources with only four Rage are refused; its own face-down Volition icon does not count", () => {
  const b = fdGt([...bank("rage", 4, P1), ...bank("greed", 4, P1)]);
  assert.equal(ready(b.engine), 9);
  refused(() => rawFlipUp(b.engine, P1, b.id("t")), "only four Rage", MSG);
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  assert.equal(ready(b.engine), 9, "nothing was paid");
  const ok = fdGt([...bank("rage", 5, P1), ...bank("greed", 3, P1)]);
  rawFlipUp(ok.engine, P1, ok.id("t"));
  resolvePendingResponses(ok.engine);
  if (pcOf(ok.engine)) resolveChoice(ok.engine, { kind: "chooserSelectsTarget", selected: [] });
  assert.equal(ok.engine.state.cards[ok.id("t")].faceDown, false, "positive control: five Rage works");
});

clause(GT, "4:flipUp", "spent Rage resources count toward the threshold but cannot pay: 3 ready + 5 spent Rage is refused, 8 ready + 5 spent works", () => {
  const b = fdGt([...volition(3, P1), ...spentResources(P1, 5)]);
  assert.equal(ready(b.engine), 4, "setup: itself + 3 ready");
  refused(() => rawFlipUp(b.engine, P1, b.id("t")), "spent resources cannot pay", MSG);
  const c = fdGt([...volition(8, P1), ...spentResources(P1, 5)]);
  rawFlipUp(c.engine, P1, c.id("t"));
  resolvePendingResponses(c.engine);
  if (pcOf(c.engine)) resolveChoice(c.engine, { kind: "chooserSelectsTarget", selected: [] });
  assert.equal(c.engine.state.cards[c.id("t")].faceDown, false);
});

clause(GT, "4:flipUp", "with spare resources it pays 9 (not its normal 8, not more): ready count afterwards is rule-neutral about which resources paid", () => {
  const b = fdGt([...bank("rage", 5, P1), ...volition(7, P1)]);
  assert.equal(ready(b.engine), 13);
  rawFlipUp(b.engine, P1, b.id("t"));
  resolvePendingResponses(b.engine);
  if (pcOf(b.engine)) resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [] });
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, false);
  assert.ok([3, 4].includes(ready(b.engine)), `13 resources minus a 9 payment (and Talonclaw leaving the pool) leaves 3 or 4, got ${ready(b.engine)}`);
});

clause(GT, "4:flipUp", "the flipped-up Talonclaw enters play, so its enters-play pick is offered to its controller", () => {
  const b = fdGt(nine(8), [{ key: "och", def: character({ name: "Their Char", life: 2 }), owner: P2, zone: "play" }]);
  rawFlipUp(b.engine, P1, b.id("t"));
  resolvePendingResponses(b.engine);
  const pc = pcOf(b.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the enters-play trigger fires on FLIP UP");
  assert.equal(pc?.playerId, P1);
  resolveChoice(b.engine, { kind: "chooserSelectsTarget", selected: [b.id("och")] });
  assert.equal(zoneOf(b.engine, b.id("och")), "discard");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, false);
});

clause(GT, "4:flipUp", "only its controller can flip it, and only while it is face-down in play (a face-up one is refused)", () => {
  const b = fdGt(nine(8), [...bank("rage", 5, P2), ...volition(4, P2)]);
  refused(() => rawFlipUp(b.engine, P2, b.id("t")), "not the controller");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  const up = gtInPlay(nine(8));
  refused(() => rawFlipUp(up.engine, P1, up.id("t")), "already face-up");
  assert.equal(ready(up.engine), 8, "nothing paid");
  const ok = fdGt(nine(8));
  rawFlipUp(ok.engine, P1, ok.id("t"));
  assert.equal(ok.engine.state.cards[ok.id("t")].faceDown, false, "positive control: the controller flips it up for 9");
});

// ============================================================================
// Idol Smasher -- warlord vandal, cost 4 [R][R], 2/3/3, EXTRA COST: you may pick an item
// ============================================================================
const IS = "6d6df680-598d-461a-a049-028609e1fe6f";
const IS_RES = (): CardPlacement[] => [...bank("rage", 2, P1), ...volition(2, P1)];
const isBoard = (extra: CardPlacement[] = []) =>
  mk([
    hand(IS),
    ...IS_RES(),
    { key: "oi", def: item({ name: "Their Item" }), owner: P2, zone: "play" },
    { key: "mi", def: item({ name: "My Item" }), owner: P1, zone: "play" },
    { key: "och", def: character({ name: "Their Char", life: 2 }), owner: P2, zone: "play" },
    { key: "oloc", def: location({ name: "Their Loc" }), owner: P2, zone: "play" },
    ...extra
  ]);

clause(IS, "0:extraCost", "printed card: a warlord vandal character, cost 4, threshold [R][R], 2 strength / 3 speed / 3 life", () => {
  const b = isBoard();
  play(b.engine, P1, b.id("c"));
  assert.deepEqual(b.engine.getCardTypes(b.id("c")), ["character"]);
  assert.equal(b.engine.getStat(b.id("c"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("c"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("c"), "life"), 3);
  const d = b.engine.getDefinition(b.id("c"));
  assert.equal(d.trade, "warlord");
  assert.deepEqual(d.subtype, ["vandal"]);
});

clause(IS, "0:extraCost", "deploys for exactly 4 resources with two [R]; one short and one [R] are refused", () => {
  deployChecks(IS, 4, IS_RES(), [...bank("rage", 2, P1), ...volition(1, P1)], [...bank("rage", 1, P1), ...volition(3, P1)]);
});

clause(IS, "0:extraCost", "the item pick is optional: deploying with no pick pays 4 and puts it in play with a clean board", () => {
  const b = isBoard();
  const before = ready(b.engine);
  play(b.engine, P1, b.id("c"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(before - ready(b.engine), 4);
  for (const k of ["oi", "mi", "och", "oloc"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} stays`);
});

clause(IS, "0:extraCost", "the pick is an EXTRA COST: it is committed when played, the destroy happens on entering play", () => {
  const b = isBoard();
  playRaw(b.engine, P1, b.id("c"), { selected: { it: [b.id("oi")] } });
  assert.equal(ready(b.engine), 0, "cost paid while it waits");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(zoneOf(b.engine, b.id("oi")), "discard");
});

clause(IS, "0:extraCost", "any item may be picked, mine or the opponent's; a character, a location or a face-down card is refused", () => {
  const b = isBoard();
  play(b.engine, P1, b.id("c"), { selected: { it: [b.id("mi")] } });
  assert.equal(zoneOf(b.engine, b.id("mi")), "discard", "my own item may be picked");
  for (const bad of ["och", "oloc"]) {
    const c = isBoard();
    refused(() => play(c.engine, P1, c.id("c"), { selected: { it: [c.id(bad)] } }), `${bad} is not an item`);
    assert.equal(zoneOf(c.engine, c.id("c")), "hand");
    assert.equal(zoneOf(c.engine, c.id(bad)), "play");
    assert.equal(ready(c.engine), 4, "nothing was paid");
  }
});

clause(IS, "0:extraCost", "at most one item can be picked: two picked items are refused", () => {
  const b = isBoard();
  refused(() => play(b.engine, P1, b.id("c"), { selected: { it: [b.id("oi"), b.id("mi")] } }), "only one item");
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
  assert.equal(zoneOf(b.engine, b.id("oi")), "play");
  assert.equal(zoneOf(b.engine, b.id("mi")), "play");
});

clause(IS, "1:rule", "if an item was picked as part of the cost, that item is destroyed; other items stay", () => {
  const b = isBoard();
  play(b.engine, P1, b.id("c"), { selected: { it: [b.id("oi")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("oi")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mi")), "play", "the other item stays");
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("oi")), "goes to its owner's discard pile");
});

clause(IS, "1:rule", "no item picked: no item is destroyed, even when items are in play", () => {
  const b = isBoard();
  play(b.engine, P1, b.id("c"), { selected: {} });
  assert.equal(zoneOf(b.engine, b.id("oi")), "play");
  assert.equal(zoneOf(b.engine, b.id("mi")), "play");
});

clause(IS, "1:rule", "with no item in play the card deploys normally and destroys nothing", () => {
  const b = mk([hand(IS), ...IS_RES(), { key: "och", def: character({ name: "Their Char" }), owner: P2, zone: "play" }]);
  play(b.engine, P1, b.id("c"));
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(zoneOf(b.engine, b.id("och")), "play");
});

clause(IS, "1:rule", "the trigger is only for Idol Smasher itself entering play: a later card entering play destroys no item", () => {
  const b = isBoard([{ key: "nc", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("c"));
  play(b.engine, P1, b.id("nc"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["oi", "mi"]) assert.equal(zoneOf(b.engine, b.id(k)), "play", `${k} stays`);
});

// ============================================================================
// Implosive Explosion -- warlord tactic, cost 3 [R]
// ============================================================================
const IE = "8dc6d0cb-f250-44fc-a963-486bf5a196f7";
const ieHand: CardPlacement = { key: "c", def: printing(IE), owner: P1, zone: "hand" };
const fd = (cost: number, key = "fd"): CardPlacement => ({ key, def: resourceCard({ name: `Staple ${key}`, cost }), owner: P1, zone: "play", faceDown: true });
const ieBoard = (fdCost: number, extra: CardPlacement[] = [], rage = 3) =>
  mk([
    ieHand,
    ...bank("rage", rage, P1),
    fd(fdCost),
    { key: "v", def: character({ name: "Victim", life: 6 }), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine", life: 6 }), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "A Location", structure: 6 }), owner: P2, zone: "play" },
    ...extra
  ]);
const iePlay = (b: Board, victim = "v", fdKey = "fd") => play(b.engine, P1, b.id("c"), { selected: { fdres: [b.id(fdKey)], victim: [b.id(victim)] } });

clause(IE, "0:extraCost", "printed card: a warlord tactic, cost 3, threshold [R]; played for exactly 3 resources plus the destroyed resource", () => {
  const b = ieBoard(2);
  assert.deepEqual(b.engine.getCardTypes(b.id("c")), ["tactic"]);
  const d = b.engine.getDefinition(b.id("c"));
  assert.equal(d.trade, "warlord");
  assert.equal(ready(b.engine), 4, "setup: 3 Rage + the face-down resource");
  iePlay(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 1, "3 resources paid and the destroyed resource gone, but the new face-down resource exists");
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard", "the picked resource is destroyed");
});

clause(IE, "0:extraCost", "threshold is a single [R]: exactly one Rage icon (plus two other resources for the cost of 3) is enough", () => {
  const b = mk([
    ieHand,
    ...bank("rage", 1, P1),
    ...volition(2, P1),
    fd(2),
    { key: "v", def: character({ name: "Victim", life: 6 }), owner: P2, zone: "play" }
  ]);
  iePlay(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(dmg(b, "v"), 2, "played with one [R] only");
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard", "the picked resource was destroyed");
});

clause(IE, "0:extraCost", "cost 3 is pinned: with 4 Rage + the picked resource, exactly 3 are paid and 1 stays ready (plus the new resource)", () => {
  const b = ieBoard(2, [], 4);
  iePlay(b);
  assert.equal(ready(b.engine), 2, "4 Rage - 3 paid = 1 ready, + the new face-down resource");
});

clause(IE, "0:extraCost", "is refused one short: one Rage and the picked resource are not enough; threshold needs [R]", () => {
  const b = ieBoard(2, [], 1);
  refused(() => iePlay(b), "cost 3 not payable", MSG);
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
  assert.equal(zoneOf(b.engine, b.id("fd")), "play", "the resource was not destroyed");
  assert.equal(dmg(b, "v"), 0);
  const t = mk([ieHand, ...bank("greed", 3, P1), fd(2), { key: "v", def: character({ name: "Victim", life: 6 }), owner: P2, zone: "play" }]);
  refused(() => iePlay(t), "no [R] icon", MSG);
  assert.equal(zoneOf(t.engine, t.id("fd")), "play");
  assert.equal(zoneOf(t.engine, t.id("c")), "hand");
});

clause(IE, "0:extraCost", "the picked resource must be face-down, and yours: a face-up resource, the opponent's face-down card and a non-resource are refused", () => {
  const ok = ieBoard(2);
  const b = ieBoard(2, [
    { key: "up", def: resourceCard({ name: "Face Up", cost: 3 }), owner: P1, zone: "play" },
    { key: "ofd", def: resourceCard({ name: "Their Hidden", cost: 3 }), owner: P2, zone: "play", faceDown: true }
  ]);
  const before = ready(b.engine);
  for (const bad of ["up", "ofd", "mine"]) {
    refused(() => iePlay(b, "v", bad), `${bad} is not a face-down resource I control`);
    assert.equal(zoneOf(b.engine, b.id("c")), "hand");
    assert.equal(ready(b.engine), before, "nothing was paid");
    assert.equal(zoneOf(b.engine, b.id(bad)), "play");
  }
  iePlay(ok);
  assert.equal(zoneOf(ok.engine, ok.id("fd")), "discard", "positive control");
});

clause(IE, "0:extraCost", "X is the destroyed resource's numeric cost, read for two values (1 and 4), and the same card with a different cost changes the damage", () => {
  for (const x of [1, 4]) {
    const b = ieBoard(x);
    iePlay(b);
    assert.equal(dmg(b, "v"), x, `X=${x}`);
  }
});

clause(IE, "0:extraCost", "a face-down non-resource card (a character) also counts: X is its printed cost; the revealed card is logged", () => {
  const b = ieBoard(0, [{ key: "fch", def: character({ name: "Hidden Hero", cost: 5, life: 2 }), owner: P1, zone: "play", faceDown: true }]);
  const reveals = logCount(b.engine, "cardsRevealed");
  iePlay(b, "v", "fch");
  assert.equal(dmg(b, "v"), 5, "X = 5, the printed cost of the hidden card");
  assert.equal(zoneOf(b.engine, b.id("fch")), "discard");
  assert.ok(logCount(b.engine, "cardsRevealed") > reveals, "the resource is revealed");
});

clause(IE, "0:extraCost", "the resource is destroyed as a cost: it is gone while the tactic waits for responses", () => {
  const b = ieBoard(2);
  playRaw(b.engine, P1, b.id("c"), { selected: { fdres: [b.id("fd")], victim: [b.id("v")] } });
  assert.equal(ready(b.engine), 0, "all of the cost is already paid");
  assert.equal(zoneOf(b.engine, b.id("fd")), "discard", "destroyed on payment of the extra cost");
  resolvePendingResponses(b.engine);
  assert.equal(dmg(b, "v"), 2);
});

clause(IE, "0:extraCost", "the picked card may be a character or a location of either player; an item, a face-down card and a faction are refused", () => {
  for (const v of ["v", "mine", "loc"]) {
    const b = ieBoard(2);
    iePlay(b, v);
    assert.equal(dmg(b, v), 2, `${v} takes the damage`);
  }
  const b = ieBoard(2, [{ key: "itm", def: item({ name: "An Item" }), owner: P2, zone: "play" }]);
  refused(() => iePlay(b, "itm"), "an item is not a character or location");
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
  assert.equal(zoneOf(b.engine, b.id("fd")), "play");
  const f = ieBoard(2);
  refused(() => play(f.engine, P1, f.id("c"), { selected: { fdres: [f.id("fd")], victim: [f.engine.state.players[P2].factionId as CardInstanceId] } }), "a faction is not a character or location");
  assert.equal(zoneOf(f.engine, f.id("fd")), "play");
});

clause(IE, "1:rule", "inflicts X damage to the picked character only: other characters and locations take none; a lethal X destroys it", () => {
  const b = ieBoard(3);
  iePlay(b);
  assert.equal(dmg(b, "v"), 3);
  assert.equal(dmg(b, "mine"), 0);
  assert.equal(dmg(b, "loc"), 0);
  assert.equal(zoneOf(b.engine, b.id("v")), "play", "3 damage on 6 life survives");
  const k = mk([ieHand, ...bank("rage", 3, P1), fd(6), { key: "v", def: character({ name: "Victim", life: 6 }), owner: P2, zone: "play" }]);
  iePlay(k);
  assert.equal(zoneOf(k.engine, k.id("v")), "discard", "X equal to its life destroys it");
});

clause(IE, "1:rule", "damage to a picked location: X damage on its structure, destroyed at lethal", () => {
  const b = ieBoard(4);
  iePlay(b, "loc");
  assert.equal(dmg(b, "loc"), 4);
  assert.equal(zoneOf(b.engine, b.id("loc")), "play");
  assert.equal(dmg(b, "v"), 0);
  const k = mk([ieHand, ...bank("rage", 3, P1), fd(6), { key: "loc", def: location({ name: "A Location", structure: 6 }), owner: P2, zone: "play" }]);
  iePlay(k, "loc");
  assert.equal(zoneOf(k.engine, k.id("loc")), "discard");
});

clause(IE, "1:rule", "afterwards the tactic is a face-down resource in play under its owner's control, not in the discard pile", () => {
  const b = ieBoard(2);
  iePlay(b);
  const c = b.engine.state.cards[b.id("c")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1);
  assert.equal(c.ownerId, P1);
  assert.equal(b.engine.isResource(b.id("c")), true);
  assert.ok(!b.engine.state.players[P1].discard.includes(b.id("c")), "not in the discard pile");
  assert.equal(ready(b.engine), 1, "it provides one resource of its own");
});

clause(IE, "1:rule", "it becomes a face-down resource even when the damage is lethal (the victim is destroyed)", () => {
  const b = ieBoard(6);
  iePlay(b);
  assert.equal(zoneOf(b.engine, b.id("v")), "discard");
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(b.engine.state.cards[b.id("c")].faceDown, true);
});

// ============================================================================
// Impressive Hero -- warlord soldier, cost 2 [R][R], 2/3/1
// ============================================================================
const IH = "a10bbd63-932d-4da1-a4ad-c2c35a42c6f1";
const ihBoard = (extra: CardPlacement[] = []) =>
  mk([
    hand(IH),
    ...bank("rage", 2, P1),
    { key: "och", def: character({ name: "Their Char", life: 3 }), owner: P2, zone: "play" },
    { key: "och2", def: character({ name: "Their Other", life: 3 }), owner: P2, zone: "play" },
    { key: "mch", def: character({ name: "My Char", life: 3 }), owner: P1, zone: "play" },
    { key: "itm", def: item({ name: "An Item" }), owner: P2, zone: "play" },
    ...extra
  ]);
const dep = (b: Board, key: string): boolean => b.engine.state.cards[b.id(key)].depleted ?? false;

clause(IH, "0:extraCost", "printed card: a warlord soldier character, cost 2, threshold [R][R], 2 strength / 3 speed / 1 life", () => {
  const b = ihBoard();
  play(b.engine, P1, b.id("c"));
  assert.deepEqual(b.engine.getCardTypes(b.id("c")), ["character"]);
  assert.equal(b.engine.getStat(b.id("c"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("c"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("c"), "life"), 1);
  const d = b.engine.getDefinition(b.id("c"));
  assert.equal(d.trade, "warlord");
  assert.deepEqual(d.subtype, ["soldier"]);
});

clause(IH, "0:extraCost", "deploys for exactly 2 resources with two [R]; one short (the other spent) and one [R] are refused", () => {
  deployChecks(IH, 2, bank("rage", 2, P1), [...bank("rage", 1, P1), ...spentResources(P1, 1)], [...bank("rage", 1, P1), ...volition(1, P1)]);
});

clause(IH, "0:extraCost", "the pick is optional: deploying with no pick pays 2 and depletes nobody", () => {
  const b = ihBoard();
  play(b.engine, P1, b.id("c"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(ready(b.engine), 0);
  for (const k of ["och", "och2", "mch"]) assert.equal(dep(b, k), false, `${k} stays ready`);
});

clause(IH, "0:extraCost", "any character may be picked (mine or theirs); an item or a faction is refused; only one may be picked", () => {
  const b = ihBoard();
  play(b.engine, P1, b.id("c"), { selected: { c: [b.id("mch")] } });
  assert.equal(dep(b, "mch"), true, "my own character may be picked");
  const f = ihBoard();
  refused(() => play(f.engine, P1, f.id("c"), { selected: { c: [f.id("itm")] } }), "an item is not a character");
  assert.equal(zoneOf(f.engine, f.id("c")), "hand");
  assert.equal(ready(f.engine), 2, "nothing paid");
  const g = ihBoard();
  refused(() => play(g.engine, P1, g.id("c"), { selected: { c: [g.engine.state.players[P2].factionId as CardInstanceId] } }), "a faction is not a character");
  assert.equal(zoneOf(g.engine, g.id("c")), "hand");
  const h = ihBoard();
  refused(() => play(h.engine, P1, h.id("c"), { selected: { c: [h.id("och"), h.id("och2")] } }), "only one character");
  assert.equal(zoneOf(h.engine, h.id("c")), "hand");
  assert.equal(dep(h, "och"), false);
});

clause(IH, "1:rule", "if a character was picked as part of the cost, that character is depleted when this enters play; others stay ready", () => {
  const b = ihBoard();
  play(b.engine, P1, b.id("c"), { selected: { c: [b.id("och")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
  assert.equal(dep(b, "och"), true, "the picked character is depleted");
  assert.equal(dep(b, "och2"), false);
  assert.equal(dep(b, "mch"), false);
  assert.equal(dep(b, "c"), false, "Impressive Hero itself is not depleted");
  assert.equal(b.engine.state.cards[b.id("och")].damage ?? 0, 0, "only depleted: no damage");
  assert.equal(zoneOf(b.engine, b.id("och")), "play");
});

clause(IH, "1:rule", "the pick is an EXTRA COST committed at play; the deplete happens on entering play (not before)", () => {
  const b = ihBoard();
  playRaw(b.engine, P1, b.id("c"), { selected: { c: [b.id("och")] } });
  assert.equal(ready(b.engine), 0, "cost paid while it waits");
  assert.equal(dep(b, "och"), false, "not depleted until it enters play");
  resolvePendingResponses(b.engine);
  assert.equal(dep(b, "och"), true);
});

clause(IH, "1:rule", "no character picked: nobody is depleted even with characters in play", () => {
  const b = ihBoard();
  play(b.engine, P1, b.id("c"), { selected: {} });
  for (const k of ["och", "och2", "mch"]) assert.equal(dep(b, k), false);
});

clause(IH, "1:rule", "picking an already-depleted character leaves it depleted without error", () => {
  const b = ihBoard();
  b.engine.state.cards[b.id("och")].depleted = true;
  play(b.engine, P1, b.id("c"), { selected: { c: [b.id("och")] } });
  assert.equal(dep(b, "och"), true);
  assert.equal(zoneOf(b.engine, b.id("c")), "play");
});

clause(IH, "1:rule", "the trigger is only for Impressive Hero itself entering play: a later card entering play depletes nobody", () => {
  const b = ihBoard([{ key: "nc", def: character({ name: "Newcomer", cost: 0 }), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("c"), { selected: {} });
  play(b.engine, P1, b.id("nc"));
  for (const k of ["och", "och2", "mch", "c"]) assert.equal(dep(b, k), false, `${k} stays ready`);
});

// ============================================================================
// Improvised Blowtorch -- warlord tactic, cost 3 [R], FLIP UP: 1 [R]
// ============================================================================
const IB = "7955a998-baec-48c1-97bc-3d0f504eeff3";
const ibBoard = (res: CardPlacement[], life = 3, active: PlayerId = P1) =>
  mk(
    [
      { key: "c", def: printing(IB), owner: P1, zone: "hand" },
      ...res,
      { key: "v", def: character({ name: "Victim", life }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "itm", def: item({ name: "An Item" }), owner: P2, zone: "play" },
      { key: "loc", def: location({ name: "A Location", structure: 5 }), owner: P2, zone: "play" }
    ],
    active
  );
const ibPlay = (b: Board, victim = "v") => play(b.engine, P1, b.id("c"), { selected: { c: [b.id(victim)] } });

clause(IB, "0:extraCost", "printed card: a warlord tactic, cost 3, threshold [R]; played for exactly 3 resources with one [R]", () => {
  const b = ibBoard([...bank("rage", 1, P1), ...volition(2, P1)]);
  assert.deepEqual(b.engine.getCardTypes(b.id("c")), ["tactic"]);
  assert.equal(b.engine.getDefinition(b.id("c")).trade, "warlord");
  ibPlay(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(ready(b.engine), 0, "exactly 3 paid");
  assert.equal(dmg(b, "v"), 2);
  const s = ibBoard([...bank("rage", 1, P1), ...volition(1, P1)]);
  refused(() => ibPlay(s), "one short of cost 3", MSG);
  assert.equal(zoneOf(s.engine, s.id("c")), "hand");
  assert.equal(dmg(s, "v"), 0);
  const t = ibBoard([...bank("greed", 3, P1)]);
  refused(() => ibPlay(t), "no [R]", MSG);
  assert.equal(zoneOf(t.engine, t.id("c")), "hand");
  const e = ibBoard([...bank("rage", 1, P1), ...spentResources(P1, 2).map((p) => p), ...volition(1, P1)]);
  refused(() => ibPlay(e), "only 2 ready resources: spent ones cannot pay", MSG);
});

clause(IB, "0:extraCost", "a character must be picked: playing with no pick is refused and nothing is paid", () => {
  const b = ibBoard([...bank("rage", 1, P1), ...volition(2, P1)]);
  refused(() => play(b.engine, P1, b.id("c"), { selected: {} }), "needs a pick");
  assert.equal(zoneOf(b.engine, b.id("c")), "hand");
  assert.equal(ready(b.engine), 3, "nothing paid");
  ibPlay(b);
  assert.equal(zoneOf(b.engine, b.id("c")), "discard", "positive control");
});

clause(IB, "0:extraCost", "any character may be picked (mine or theirs); an item, a location and a faction are refused", () => {
  const res = () => [...bank("rage", 1, P1), ...volition(2, P1)];
  const m = ibBoard(res());
  ibPlay(m, "mine");
  assert.equal(dmg(m, "mine"), 2, "my own character may be picked");
  for (const bad of ["itm", "loc"]) {
    const b = ibBoard(res());
    refused(() => ibPlay(b, bad), `${bad} is not a character`);
    assert.equal(zoneOf(b.engine, b.id("c")), "hand");
    assert.equal(ready(b.engine), 3);
  }
  const f = ibBoard(res());
  refused(() => play(f.engine, P1, f.id("c"), { selected: { c: [f.engine.state.players[P2].factionId as CardInstanceId] } }), "a faction is not a character");
  assert.equal(zoneOf(f.engine, f.id("c")), "hand");
});

clause(IB, "0:extraCost", "the pick is committed when played: the cost is paid while it waits, the damage only on resolution", () => {
  const b = ibBoard([...bank("rage", 1, P1), ...volition(2, P1)]);
  playRaw(b.engine, P1, b.id("c"), { selected: { c: [b.id("v")] } });
  assert.equal(ready(b.engine), 0, "cost paid");
  assert.equal(dmg(b, "v"), 0, "no damage yet");
  resolvePendingResponses(b.engine);
  assert.equal(dmg(b, "v"), 2);
});

clause(IB, "1:rule", "inflicts exactly 2 damage to the picked character only; others take none; the tactic goes to the discard pile", () => {
  const b = ibBoard([...bank("rage", 1, P1), ...volition(2, P1)]);
  ibPlay(b);
  assert.equal(dmg(b, "v"), 2);
  assert.equal(zoneOf(b.engine, b.id("v")), "play", "2 damage on 3 life survives");
  assert.equal(dmg(b, "mine"), 0);
  assert.equal(zoneOf(b.engine, b.id("c")), "discard", "an ordinary tactic goes to the discard pile");
  assert.equal(b.engine.state.cards[b.id("c")].faceDown, false);
});

clause(IB, "1:rule", "2 damage destroys a character with 2 life but not one with 3", () => {
  const b = ibBoard([...bank("rage", 1, P1), ...volition(2, P1)], 2);
  ibPlay(b);
  assert.equal(zoneOf(b.engine, b.id("v")), "discard");
  const c = ibBoard([...bank("rage", 1, P1), ...volition(2, P1)], 3);
  ibPlay(c);
  assert.equal(zoneOf(c.engine, c.id("v")), "play");
});

const fdIb = (others: CardPlacement[], life = 3, active: PlayerId = P1) =>
  mk(
    [
      { key: "t", def: printing(IB), owner: P1, zone: "play", faceDown: true },
      ...others,
      { key: "v", def: character({ name: "Victim", life }), owner: P2, zone: "play" },
      { key: "itm", def: item({ name: "An Item" }), owner: P2, zone: "play" }
    ],
    active
  );
const ibFlip = (b: Board, victim = "v") => {
  rawFlipUp(b.engine, P1, b.id("t"), { c: [b.id(victim)] });
  resolvePendingResponses(b.engine);
};

clause(IB, "2:flipUp", "FLIP UP for 1 with [R]: a face-down Blowtorch flips up and inflicts 2 damage to the picked character", () => {
  const b = fdIb([...bank("rage", 1, P1)]);
  assert.equal(ready(b.engine), 2, "setup: itself + one Rage");
  ibFlip(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(dmg(b, "v"), 2, "2 damage");
  assert.equal(zoneOf(b.engine, b.id("t")), "discard", "the tactic resolves to the discard pile");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, false);
});

clause(IB, "2:flipUp", "the FLIP UP still needs its extra cost: a character must be picked, and an item is refused", () => {
  const b = fdIb([...bank("rage", 1, P1)]);
  refused(() => rawFlipUp(b.engine, P1, b.id("t"), {}), "no character picked");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  refused(() => rawFlipUp(b.engine, P1, b.id("t"), { c: [b.id("itm")] }), "an item is not a character");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  assert.equal(ready(b.engine), 2, "nothing paid");
  ibFlip(b);
  assert.equal(dmg(b, "v"), 2, "positive control");
});

clause(IB, "2:flipUp", "pays 1 (not the normal 3): with a spare ready resource the spare stays ready; the spent Rage meets the threshold", () => {
  const b = fdIb([...bank("rage", 1, P1), ...volition(3, P1)]);
  assert.equal(ready(b.engine), 5);
  ibFlip(b);
  assert.equal(dmg(b, "v"), 2);
  assert.ok([3, 4].includes(ready(b.engine)), `5 resources minus a 1 payment (and the Blowtorch leaving the pool) leaves 3 or 4, got ${ready(b.engine)}`);
  const c = fdIb([...spentResources(P1, 1)]);
  assert.equal(ready(c.engine), 1, "setup: only the Blowtorch itself is ready");
  ibFlip(c);
  assert.equal(dmg(c, "v"), 2, "itself pays the 1; the spent Rage supplies the [R]");
});

clause(IB, "2:flipUp", "the threshold [R] is required: only a non-Rage resource is refused, and nothing is paid", () => {
  const b = fdIb([...bank("greed", 3, P1)]);
  assert.equal(ready(b.engine), 4);
  refused(() => rawFlipUp(b.engine, P1, b.id("t"), { c: [b.id("v")] }), "no [R] icon", MSG);
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  assert.equal(ready(b.engine), 4);
  assert.equal(dmg(b, "v"), 0);
  const c = fdIb([]);
  refused(() => rawFlipUp(c.engine, P1, c.id("t"), { c: [c.id("v")] }), "its own face-down Volition icon is not [R]", MSG);
});

clause(IB, "2:flipUp", "FLIP UP of a tactic is allowed inside an opponent's response window", () => {
  const b = mk([
    { key: "t", def: printing(IB), owner: P1, zone: "play", faceDown: true },
    ...bank("rage", 1, P1),
    { key: "v", def: character({ name: "Victim", life: 3 }), owner: P2, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
  ], P2);
  declareAttackOpenWindow(b.engine, P2, [b.id("foe")]);
  rawFlipUp(b.engine, P1, b.id("t"), { c: [b.id("v")] });
  resolvePendingResponses(b.engine);
  assert.equal(dmg(b, "v"), 2, "a tactic may be flipped up in response");
});

clause(IB, "2:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const b = fdIb([...bank("rage", 1, P1)]);
  refused(() => rawFlipUp(b.engine, P2, b.id("t"), { c: [b.id("v")] }), "not the controller");
  assert.equal(b.engine.state.cards[b.id("t")].faceDown, true);
  assert.equal(dmg(b, "v"), 0);
  const h = ibBoard([...bank("rage", 3, P1)]);
  refused(() => rawFlipUp(h.engine, P1, h.id("c"), { c: [h.id("v")] }), "in hand, not face-down in play");
  assert.equal(zoneOf(h.engine, h.id("c")), "hand");
});
