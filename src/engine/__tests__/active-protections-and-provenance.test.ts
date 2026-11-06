// Read-only queries that explain what is lingering on the table and where a card's numbers / rules come from:
//  A. getActiveProtections: damage shields, blanket damage / destruction windows, runtime replacements, damage
//     modifiers, hand-move redirects, battle-damage transforms, block / must-block / party grants;
//  B. isAbilitySuppressed / getSuppressedAbilityIds / getAbilitySuppressionSources: "rules text switched off";
//  C. getRestrictionSources / getKeywordGrantSources: printed vs aura vs runtime;
//  D. the extra facts on the deployForFree / coinFlipReplace / chooseChosenBlockers pending choices;
//  E. getStatModifiers: the terms behind getStat (their sum is the delta getStat reports).
// Real cards where they can be played; direct state entries only for the grants no single card makes cheaply.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  answer,
  banks,
  buildGame,
  character,
  developFaction,
  play,
  resolvePendingResponses,
  tactic,
  volition,
  P1,
  P2
} from "./per-card/_harness.js";
import { activate } from "./per-card/_harness.js";
import { declineAll, drain, printing } from "./clauses/_clause.js";
import type { SpoilsEngine } from "../SpoilsEngine.js";
import type { Stat } from "../../types/index.js";

const TINY_SHINY = "580a6694-9b65-4aa5-9668-a18ddfd3f06a";
const LIMITED_LIABILITY = "1fe85217-bff3-488c-967e-8ce08470070c";
const QUOTIDIAN_MISFIRE = "25db7f4b-e843-4d0c-903b-bb7b6fa5ecb0";
const RETREAT = "b8f134f6-19d0-452a-8c5f-5b02ef1a2c75";
const FISCAL_INTERCESSOR = "bdb490e9-ab52-4417-86da-97928dbd394f";
const DELECTABLE_BOON = "0239722a-85a6-46ab-ab23-dc85d11fd4b3";
const SUBVERSION_MATRIX = "66044076-6088-4eba-ab7d-5319ee1db663";
const HEAVY_FISTS = "5a6b4473-eb1d-4e71-86ee-49f9462d9d35";
const INHIBIT = "5032dc44-43e5-4ec7-b044-11d897cb2a49";
const IDUMB = "a0403283-f513-4822-9e8d-afc862ff08b3";
const BIG_HAT = "11dc7067-5dac-4a44-9761-6ff6af9d8895";
const FINGER_TRAP = "fd944597-35f5-4188-974b-2d318a31a3b8";
const DEFENSE_ATTORNEY = "b6e5dd65-97aa-447d-838d-0f13b6cd78ea";
const HASTY_PURSUIT = "8f8af0b4-2e83-48e5-9c84-4fdcecfbbbd1";
const I_SEE_YOU = "1866ab78-bc4c-4181-8556-73a0f675686e";
const REALITY_SHIFT = "f0a05c35-7828-49ac-8a59-131b8287e02d";
const WYRMFANG = "b5fbadf6-df3d-42bd-b55a-daaa1321b076";
const TWO_HEADED_COIN = "f4244678-8524-446d-8c1c-65f126c9df4a";

type Engine = SpoilsEngine;

/** A free tactic that deals 3 damage to one picked character (decl `t`). */
const zap = () =>
  tactic({
    name: "Zap",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }]
        }
      ]
    }
  });

const turnGame = (cards: unknown[], extra: Record<string, unknown> = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: cards as never,
    ...extra
  });

// ---------------------------------------------------------------------------
// A. getActiveProtections
// ---------------------------------------------------------------------------

describe("getActiveProtections: Tiny Shiny (a one-instance damage shield)", () => {
  function shinyGame() {
    return turnGame([
      { key: "ts", def: printing(TINY_SHINY), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Carol", life: 5 }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "Dave", life: 5 }), owner: P1, zone: "play" },
      { key: "zap", def: zap(), owner: P1, zone: "hand" },
      ...banks(3, P1)
    ]);
  }

  test("nothing before; after: the shield on Carol only, hidden source, spent once damage lands", () => {
    const g = shinyGame();
    assert.deepEqual(g.engine.getActiveProtections(), []);
    play(g.engine, P1, g.id("ts"), { selected: { t: [g.id("c")] } });

    const all = g.engine.getActiveProtections();
    assert.equal(all.length, 1);
    const shield = all[0];
    assert.equal(shield.kind, "damageShield");
    assert.deepEqual(shield.appliesToCardIds, [g.id("c")]);
    assert.equal(shield.amount, 2);
    assert.equal(shield.duration, "nextTime");
    // Tiny Shiny re-enters play FACE-DOWN: a viewer is never told which card it is.
    assert.equal(g.engine.state.cards[g.id("ts")].faceDown, true);
    assert.equal(shield.sourceId, undefined);
    assert.equal(shield.text, "The next damage to Carol is reduced by 2 this turn");
    assert.equal(shield.mode, "reduce");
    assert.equal(shield.direction, "incoming");

    assert.equal(g.engine.getActiveProtections(g.id("c")).length, 1);
    assert.deepEqual(g.engine.getActiveProtections(g.id("d")), [], "Dave is not shielded");

    play(g.engine, P1, g.id("zap"), { selected: { t: [g.id("c")] } });
    assert.equal(g.engine.state.cards[g.id("c")].damage, 1, "3 - 2");
    assert.deepEqual(g.engine.getActiveProtections(), [], "the shield is spent");
  });
});

describe("getActiveProtections: Limited Liability (blanket windows) and the turn boundary", () => {
  test("both windows name the tactic, apply to every card, and lapse with the turn", () => {
    const g = turnGame([
      { key: "ll", def: printing(LIMITED_LIABILITY), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Carol" }), owner: P1, zone: "play" },
      ...banks(3, P1)
    ]);
    play(g.engine, P1, g.id("ll"), {});
    const entries = g.engine.getActiveProtections();
    assert.deepEqual(entries.map(e => e.kind).sort(), ["damagePrevention", "destructionRestriction"]);
    for (const e of entries) {
      assert.equal(e.sourceId, g.id("ll"));
      assert.equal(e.duration, "thisTurn");
      assert.equal(e.appliesToCardIds, undefined, "a blanket window is not scoped to cards");
      assert.equal(e.mode, "prevent");
    }
    assert.equal(
      entries.find(e => e.kind === "damagePrevention")!.text,
      "Limited Liability: All damage is reduced to 0 (except damage paid as a cost) this turn"
    );
    assert.equal(
      entries.find(e => e.kind === "destructionRestriction")!.text,
      "Limited Liability: Cards can only be destroyed by costs this turn"
    );
    assert.equal(g.engine.getActiveProtections(g.id("c")).length, 2, "counts for any asked-about card");

    g.engine.perform({ type: "endTurn", playerId: P1 } as never);
    drain(g.engine, declineAll);
    assert.deepEqual(g.engine.getActiveProtections(), []);
  });
});

describe("getActiveProtections: Quotidian Misfire (a hand-move redirect)", () => {
  test("listed with its source; applies to any owner's cards", () => {
    const g = turnGame([
      { key: "qm", def: printing(QUOTIDIAN_MISFIRE), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" },
      ...banks(3, P1)
    ]);
    play(g.engine, P1, g.id("qm"), {});
    const [entry] = g.engine.getActiveProtections();
    assert.equal(entry.kind, "handMoveRedirect");
    assert.equal(entry.sourceId, g.id("qm"));
    assert.equal(entry.controllerId, P1);
    assert.equal(entry.playerId, undefined, "who: any is not one player");
    assert.equal(entry.mode, "redirect");
    assert.equal(entry.text, "Quotidian Misfire: Cards that would enter any player's hand go to the discard instead this turn");
    assert.equal(g.engine.getActiveProtections(g.id("mine")).length, 1);
    assert.equal(g.engine.getActiveProtections(g.id("theirs")).length, 1);
  });

  test("a self-scoped redirect covers only its controller's cards", () => {
    const g = turnGame([
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs" }), owner: P2, zone: "play" }
    ]);
    g.engine.state.handMoveRedirects.push({
      id: "hmr-1",
      sourceControllerId: P1,
      who: "self",
      to: "discard",
      duration: { type: "untilEndOfTurn" },
      createdTurn: g.engine.state.turn
    });
    assert.equal(g.engine.getActiveProtections(g.id("mine")).length, 1);
    assert.deepEqual(g.engine.getActiveProtections(g.id("theirs")), []);
    assert.equal(g.engine.getActiveProtections()[0].playerId, P1);
  });
});

describe("getActiveProtections: Retreat to Mount Mulrich (runtime replacements with a condition)", () => {
  test("both replacements are listed; asking about a card applies the real condition", () => {
    const g = turnGame([
      { key: "r", def: printing(RETREAT), owner: P1, zone: "hand" },
      { key: "c", def: character({ name: "Carol" }), owner: P1, zone: "play" },
      { key: "d", def: character({ name: "Dave" }), owner: P1, zone: "play" },
      ...banks(3, P1)
    ]);
    play(g.engine, P1, g.id("r"), { selected: { c: [g.id("c")] } });
    const all = g.engine.getActiveProtections();
    assert.equal(all.length, 2);
    assert.ok(all.every(e => e.kind === "replacement" && e.controllerId === P1 && e.duration === "thisTurn"));
    const faceDown = g.engine.state.cards[g.id("r")].faceDown;
    assert.equal(all[0].sourceId, faceDown ? undefined : g.id("r"));
    for (const e of all) {
      assert.equal(e.mode, "replace");
      assert.ok(e.replacementKind === "destroy" || e.replacementKind === "leavePlay" || e.replacementKind === "moveToZone");
      assert.equal(e.direction, undefined);
    }
    assert.ok(all.some(e => e.replacementKind === "destroy"), "one replaces destruction");

    assert.equal(g.engine.getActiveProtections(g.id("c")).length, 2, "the picked card is covered");
    assert.deepEqual(g.engine.getActiveProtections(g.id("d")), [], "Dave fails the replacement's condition");
  });
});

describe("getActiveProtections: Fiscal Intercessor (an incoming-damage modifier) and Delectable Boon (a redirect)", () => {
  test("PLEAD lists a -1 modifier on the picked character", () => {
    const g = turnGame([
      { key: "fi", def: printing(FISCAL_INTERCESSOR), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "Carol", life: 5 }), owner: P1, zone: "play" },
      ...banks(3, P1)
    ]);
    activate(g.engine, P1, g.id("fi"), "plead", { selected: { c: [g.id("c")] } });
    const [entry] = g.engine.getActiveProtections(g.id("c"));
    assert.equal(entry.kind, "damageModifier");
    assert.equal(entry.amount, -1);
    assert.equal(entry.mode, "reduce");
    assert.equal(entry.direction, "incoming");
    assert.equal(entry.sourceId, g.id("fi"));
    assert.deepEqual(entry.appliesToCardIds, [g.id("c")]);
    assert.match(entry.text, /^Fiscal Intercessor: Damage inflicted to Carol is reduced by 1 this turn$/);
  });

  test("Boon: the next X damage to the first pick is inflicted to the second instead", () => {
    const g = turnGame([
      { key: "boon", def: printing(DELECTABLE_BOON), owner: P1, zone: "hand" },
      { key: "a", def: character({ name: "Ann", life: 5 }), owner: P1, zone: "play" },
      { key: "b", def: character({ name: "Bea", life: 5 }), owner: P1, zone: "play" },
      ...banks(4, P1)
    ]);
    play(g.engine, P1, g.id("boon"), {
      selected: { first: [g.id("a")], second: [g.id("b")] },
      variables: { x: 2 }
    });
    const [entry] = g.engine.getActiveProtections(g.id("a"));
    assert.equal(entry.kind, "damageShield");
    assert.equal(entry.mode, "redirect");
    assert.equal(entry.direction, "incoming");
    assert.equal(entry.amount, 2);
    assert.match(entry.text, /^Delectable Boon: The next 2 damage to Ann is inflicted to Bea instead/);
    assert.deepEqual(g.engine.getActiveProtections(g.id("b")), []);
  });
});

describe("getActiveProtections: grants that no single cheap card makes (state entries)", () => {
  function board() {
    return turnGame([
      { key: "hero", def: character({ name: "Hero", life: 5 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "lord", def: character({ name: "Lord" }), owner: P1, zone: "play" }
    ]);
  }

  test("battle-damage transforms, block / must-block / party grants, with source and scope", () => {
    const g = board();
    const turn = g.engine.state.turn;
    const dur = { type: "untilEndOfTurn" } as const;
    g.engine.state.battleDamageTransforms.push({
      id: "bdt",
      sourceId: g.id("lord"),
      cardId: g.id("hero"),
      role: "dealer",
      kind: "setAmount",
      amount: 4,
      duration: dur,
      createdTurn: turn
    });
    g.engine.state.blockRestrictionGrants.push({
      id: "brg",
      sourceId: g.id("lord"),
      targetId: g.id("hero"),
      minPartySize: 2,
      duration: dur,
      createdTurn: turn
    });
    g.engine.state.mustBlockGrants.push({
      id: "mbg",
      sourceId: g.id("lord"),
      attackerId: g.id("hero"),
      duration: dur,
      createdTurn: turn
    });
    g.engine.state.partyRestrictionGrants.push({
      id: "prg",
      sourceId: g.id("lord"),
      targetId: g.id("hero"),
      role: "attacking",
      minMembers: 2,
      duration: dur,
      createdTurn: turn
    });

    const kinds = g.engine.getActiveProtections(g.id("hero")).map(e => e.kind).sort();
    assert.deepEqual(kinds, ["battleDamageTransform", "blockRestriction", "mustBlock", "partyRestriction"]);
    const bdt = g.engine.getActiveProtections().find(e => e.id === "bdt")!;
    assert.equal(bdt.amount, 4);
    assert.equal(bdt.sourceId, g.id("lord"));
    assert.equal(bdt.text, "Lord: Hero assigns 4 battle damage instead of its strength this turn");
    assert.equal(
      g.engine.getActiveProtections().find(e => e.id === "brg")!.text,
      "Lord: Only a blocking party of at least 2 may block Hero this turn"
    );
    assert.equal(
      g.engine.getActiveProtections().find(e => e.id === "prg")!.text,
      "Lord: An attacking party including Hero must have at least 2 members this turn"
    );
    assert.deepEqual(g.engine.getActiveProtections(g.id("foe")), [], "the foe is not named by any of them");
  });

  test("a whileSourceInPlay entry is listed only while its source is in play, and a hidden source is not named", () => {
    const g = board();
    g.engine.state.mustBlockGrants.push({
      id: "mbg",
      sourceId: g.id("lord"),
      attackerId: g.id("hero"),
      duration: { type: "whileSourceInPlay" },
      createdTurn: g.engine.state.turn
    });
    assert.equal(g.engine.getActiveProtections().length, 1);
    g.engine.state.cards[g.id("lord")].faceDown = true;
    // A face-down card is not "in play" as a source: the entry is not in force.
    assert.deepEqual(g.engine.getActiveProtections(), []);
    g.engine.state.cards[g.id("lord")].faceDown = false;
    g.engine.state.cards[g.id("lord")].zone = "discard";
    assert.deepEqual(g.engine.getActiveProtections(), []);

    // A lasting shield from a face-down card hides the card but stays listed.
    g.engine.state.cards[g.id("lord")].zone = "play";
    g.engine.state.cards[g.id("lord")].faceDown = true;
    g.engine.state.damageShields.push({
      id: "sh",
      sourceId: g.id("lord"),
      targetId: g.id("hero"),
      amount: 3,
      mode: "reduce",
      persistent: true,
      createdTurn: g.engine.state.turn
    });
    const [shield] = g.engine.getActiveProtections(g.id("hero"));
    assert.equal(shield.duration, "untilSpent");
    assert.equal(shield.sourceId, undefined);
    assert.equal(shield.text, "Prevents the next 3 damage to Hero");
  });

  test("an unknown card id is refused", () => {
    assert.throws(() => board().engine.getActiveProtections("nope"));
  });
});

// ---------------------------------------------------------------------------
// B. rules-text suppression
// ---------------------------------------------------------------------------

/** A character with a keyword, an activated, a triggered and a continuous ability: every kind of printed text. */
function texty() {
  return character({
    name: "Texty",
    strength: 2,
    life: 3,
    behavior: {
      keywords: ["covert"],
      abilities: [
        { id: "act", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] },
        {
          id: "trig",
          type: "triggered",
          event: "cardDestroyed",
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        },
        {
          id: "cont",
          type: "continuous",
          modifiers: [{ target: "source", stat: "strength", operation: "add", value: 5 }]
        }
      ]
    }
  });
}

describe("rules-text suppression: an aura (Subversion Matrix / Heavy Fists) and a lasting effect (Inhibit, iDumb)", () => {
  test("Subversion Matrix switches off activated, triggered, continuous text AND the printed keyword", () => {
    const g = turnGame([
      { key: "host", def: texty(), owner: P1, zone: "play" },
      { key: "sm", def: printing(SUBVERSION_MATRIX), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "other", def: texty(), owner: P1, zone: "play" }
    ]);
    const host = g.id("host");
    assert.equal(g.engine.isAbilitySuppressed(host), true);
    for (const abilityId of ["act", "trig", "cont"]) {
      assert.equal(g.engine.isAbilitySuppressed(host, abilityId), true, abilityId);
    }
    assert.deepEqual(g.engine.getSuppressedAbilityIds(host).sort(), ["act", "cont", "trig"]);
    assert.equal(g.engine.hasKeyword(host, "covert"), false, "printed keywords go with the rules text");
    assert.equal(g.engine.getStat(host, "strength"), 2, "the continuous +5 is off");
    assert.deepEqual(g.engine.getAbilitySuppressionSources(host), [
      { kind: "aura", sourceId: g.id("sm"), abilityId: "mute" }
    ]);

    // The unmuted twin and the Matrix's own text are untouched.
    const other = g.id("other");
    assert.equal(g.engine.isAbilitySuppressed(other), false);
    assert.deepEqual(g.engine.getSuppressedAbilityIds(other), []);
    assert.deepEqual(g.engine.getAbilitySuppressionSources(other), []);
    assert.equal(g.engine.hasKeyword(other, "covert"), true);
    assert.equal(g.engine.isAbilitySuppressed(g.id("sm")), false);
  });

  test("Heavy Fists mutes its wearer but keeps its own +3/+3 (the suppressor's own ability is exempt)", () => {
    const g = turnGame([
      { key: "host", def: texty(), owner: P1, zone: "play" },
      { key: "hf", def: printing(HEAVY_FISTS), owner: P1, zone: "play", attachedToKey: "host" }
    ]);
    assert.equal(g.engine.isAbilitySuppressed(g.id("host"), "cont"), true);
    assert.equal(g.engine.getStat(g.id("host"), "strength"), 5, "2 + 3 from the Fists, the +5 is muted");
    assert.deepEqual(g.engine.getAbilitySuppressionSources(g.id("host")), [
      { kind: "aura", sourceId: g.id("hf"), abilityId: "heavy-fists-mute" }
    ]);
    assert.equal(g.engine.isAbilitySuppressed(g.id("hf"), "heavy-fists-buff"), false);
  });

  test("Inhibit: a runtime suppression with its duration and source", () => {
    const g = turnGame([
      { key: "inh", def: printing(INHIBIT), owner: P1, zone: "hand" },
      { key: "foe", def: texty(), owner: P2, zone: "play" },
      ...banks(3, P1)
    ]);
    play(g.engine, P1, g.id("inh"), { selected: { c: [g.id("foe")] } });
    assert.equal(g.engine.isAbilitySuppressed(g.id("foe")), true);
    assert.equal(g.engine.hasKeyword(g.id("foe"), "covert"), false);
    const [source] = g.engine.getAbilitySuppressionSources(g.id("foe"));
    assert.equal(source.kind, "runtime");
    assert.equal(source.sourceId, g.id("inh"));
    assert.equal(source.duration?.type, "untilStartOfNextTurn");
    assert.deepEqual(g.engine.getSuppressedAbilityIds(g.id("foe")).sort(), ["act", "cont", "trig"]);
  });

  test("iDumb De-Itemizer: the attached item has no text, and the Itemizer's own text stays on", () => {
    const g = turnGame([
      { key: "host", def: texty(), owner: P1, zone: "play" },
      { key: "idumb", def: printing(IDUMB), owner: P2, zone: "play", attachedToKey: "host" },
      ...banks(3, P2)
    ]);
    assert.equal(g.engine.isAbilitySuppressed(g.id("host")), true);
    const sources = g.engine.getAbilitySuppressionSources(g.id("host"));
    assert.deepEqual(sources, [{ kind: "aura", sourceId: g.id("idumb"), abilityId: "idumb-mute" }]);
    // The Itemizer's own text is on.
    assert.equal(g.engine.isAbilitySuppressed(g.id("idumb")), false);
    assert.deepEqual(g.engine.getSuppressedAbilityIds(g.id("idumb")), []);
  });

  test("what is not modelled: suppression is per whole card, so an unrelated unknown ability id reads like the rest", () => {
    const g = turnGame([
      { key: "host", def: texty(), owner: P1, zone: "play" },
      { key: "sm", def: printing(SUBVERSION_MATRIX), owner: P1, zone: "play", attachedToKey: "host" }
    ]);
    // There is no per-ability-kind switch: any ability id on a muted card reads as suppressed.
    assert.equal(g.engine.isAbilitySuppressed(g.id("host"), "no-such-ability"), true);
    assert.throws(() => g.engine.isAbilitySuppressed("nope"));
  });
});

// ---------------------------------------------------------------------------
// C. provenance
// ---------------------------------------------------------------------------

describe("getKeywordGrantSources / getRestrictionSources: printed vs aura vs runtime", () => {
  test("covert from the card, from a Big Hat aura and from nothing else; two causes list twice", () => {
    const g = turnGame([
      { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      { key: "hat", def: printing(BIG_HAT), owner: P1, zone: "play", attachedToKey: "plain" },
      { key: "hat2", def: printing(BIG_HAT), owner: P1, zone: "play", attachedToKey: "sneak" }
    ]);
    assert.deepEqual(g.engine.getKeywordGrantSources(g.id("plain")), [
      { keyword: "covert", kind: "aura", sourceId: g.id("hat"), abilityId: "hat-covert" }
    ]);
    const sneak = g.engine.getKeywordGrantSources(g.id("sneak"));
    assert.deepEqual(
      sneak.map(s => s.kind),
      ["printed", "aura"]
    );
    assert.equal(sneak[0].sourceId, g.id("sneak"));
    assert.equal(sneak[1].sourceId, g.id("hat2"));
  });

  test("a runtime grant: Hasty Pursuit is player-wide, I See You! switches a printed keyword off", () => {
    const g = turnGame([
      { key: "hp", def: printing(HASTY_PURSUIT), owner: P1, zone: "hand" },
      { key: "isy", def: printing(I_SEE_YOU), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert"] } }), owner: P1, zone: "play" },
      ...banks(3, P1)
    ]);
    play(g.engine, P1, g.id("hp"), {});
    const [grant] = g.engine.getKeywordGrantSources(g.id("mine"));
    assert.equal(grant.keyword, "aggro");
    assert.equal(grant.kind, "runtime");
    assert.equal(grant.playerWide, true);
    assert.equal(grant.sourceId, g.id("hp"));
    assert.deepEqual(grant.duration, { type: "untilEndOfTurn" });
    assert.deepEqual(
      g.engine.getKeywordGrantSources(g.id("mine")).map(s => s.keyword),
      g.engine.getKeywords(g.id("mine"))
    );

    // I See You! takes covert off Sneak: the printed source disappears with the keyword, the player-wide aggro stays.
    play(g.engine, P1, g.id("isy"), { selected: { c: [g.id("sneak")] } });
    assert.equal(g.engine.hasKeyword(g.id("sneak"), "covert"), false);
    assert.deepEqual(
      g.engine.getKeywordGrantSources(g.id("sneak")).map(s => s.keyword),
      ["aggro"]
    );
  });

  test("restrictions: an aura (Finger Trap), the card's own text (Defense Attorney) and a runtime grant", () => {
    const g = turnGame([
      { key: "worn", def: character({ name: "Worn" }), owner: P1, zone: "play" },
      { key: "ft", def: printing(FINGER_TRAP), owner: P1, zone: "play", attachedToKey: "worn" },
      { key: "da", def: printing(DEFENSE_ATTORNEY), owner: P1, zone: "play" }
    ]);
    assert.deepEqual(g.engine.getRestrictionSources(g.id("worn")), [
      { restriction: "cannotAttack", kind: "aura", sourceId: g.id("ft"), abilityId: "finger-trap-restrict" },
      { restriction: "cannotBlock", kind: "aura", sourceId: g.id("ft"), abilityId: "finger-trap-restrict" }
    ]);
    assert.deepEqual(g.engine.getRestrictionSources(g.id("da")), [
      { restriction: "mustBlock", kind: "printed", sourceId: g.id("da"), abilityId: "mustblk" }
    ]);

    g.engine.state.restrictions.push({
      id: "rg",
      sourceId: g.id("da"),
      targetId: g.id("worn"),
      restriction: "cannotAttack",
      duration: { type: "untilEndOfTurn" },
      createdTurn: g.engine.state.turn
    });
    const worn = g.engine.getRestrictionSources(g.id("worn"));
    assert.deepEqual(
      worn.filter(s => s.restriction === "cannotAttack").map(s => s.kind),
      ["runtime", "aura"]
    );
    assert.deepEqual(worn[0].duration, { type: "untilEndOfTurn" });
    assert.equal(g.engine.hasRestriction(g.id("worn"), "cannotAttack"), true);
  });

  test("the sources and getKeywords / getRestrictions never disagree, on every card of a mixed board", () => {
    const g = turnGame([
      { key: "sneak", def: character({ name: "Sneak", behavior: { keywords: ["covert", "aggro"] } }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      { key: "hat", def: printing(BIG_HAT), owner: P1, zone: "play", attachedToKey: "plain" },
      { key: "ft", def: printing(FINGER_TRAP), owner: P1, zone: "play", attachedToKey: "sneak" },
      { key: "da", def: printing(DEFENSE_ATTORNEY), owner: P2, zone: "play" },
      { key: "sm", def: printing(SUBVERSION_MATRIX), owner: P2, zone: "play", attachedToKey: "da" }
    ]);
    for (const card of Object.values(g.engine.state.cards)) {
      if (card.zone !== "play") continue;
      const kw = new Set(g.engine.getKeywordGrantSources(card.id).map(s => s.keyword));
      assert.deepEqual([...kw].sort(), [...g.engine.getKeywords(card.id)].sort(), `keywords of ${card.id}`);
      const rs = new Set(g.engine.getRestrictionSources(card.id).map(s => s.restriction));
      assert.deepEqual([...rs].sort(), [...g.engine.getRestrictions(card.id)].sort(), `restrictions of ${card.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// D. pending-choice facts
// ---------------------------------------------------------------------------

describe("pending choices carry what the engine already knew when it raised them", () => {
  test("deployForFree.resolvedMaxCost: Reality Shift's budget, then what is left after each deploy", () => {
    const g = turnGame([
      { key: "rs", def: printing(REALITY_SHIFT), owner: P1, zone: "hand" },
      { key: "c3", def: character({ name: "Three", cost: 3 }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "Two", cost: 2 }), owner: P1, zone: "play" },
      ...banks(8, P1)
    ]);
    play(g.engine, P1, g.id("rs"), {});
    const pc = g.engine.state.pendingChoice as never as {
      kind: string;
      resolvedMaxCost?: number;
      budgetRemaining?: number;
      perCardCap?: number;
      candidates: string[];
    };
    assert.equal(pc.kind, "deployForFree");
    assert.equal(pc.budgetRemaining, 5, "X = 3 + 2");
    assert.equal(pc.perCardCap, 99, "the literal per-card cap is still there");
    assert.equal(pc.resolvedMaxCost, 5, "min(99, budget)");
    assert.deepEqual([...pc.candidates].sort(), [g.id("c2"), g.id("c3")].sort());

    answer(g.engine, P1, { kind: "deployForFree", cardId: g.id("c3") });
    const next = g.engine.state.pendingChoice as never as typeof pc;
    assert.equal(next.kind, "deployForFree");
    assert.equal(next.budgetRemaining, 2);
    assert.equal(next.resolvedMaxCost, 2);
    assert.deepEqual(next.candidates, [g.id("c2")]);
  });

  test("chooseChosenBlockers.sourceId: Wyrmfang Deathskull", () => {
    const g = turnGame([
      { key: "wd", def: printing(WYRMFANG), owner: P1, zone: "play" },
      { key: "def", def: character({ name: "Def", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
    ]);
    g.engine.perform({
      type: "declareAttack",
      playerId: P1,
      attackerIds: [g.id("wd")],
      target: { type: "faction", playerId: P2 }
    } as never);
    resolvePendingResponses(g.engine);
    const pc = g.engine.state.pendingChoice as never as { kind: string; sourceId?: string; playerId: string };
    assert.equal(pc.kind, "chooseChosenBlockers");
    assert.equal(pc.playerId, P2);
    assert.equal(pc.sourceId, g.id("wd"));
  });

  test("coinFlipReplace carries the Coin, the flipping card and the (lost) result", () => {
    const flipper = tactic({
      name: "Flip",
      cost: 0,
      behavior: {
        abilities: [
          {
            id: "f",
            type: "activated",
            effects: [{ type: "flipCoin", winEffects: [], loseEffects: [{ type: "draw", player: "controller", amount: 0 }] }]
          }
        ]
      }
    });
    const g = turnGame(
      [
        { key: "coin", def: printing(TWO_HEADED_COIN), owner: P1, zone: "play" },
        { key: "flip", def: flipper, owner: P1, zone: "hand" },
        { key: "deckcard", def: character({ name: "Filler" }), owner: P1, zone: "deck" }
      ],
      { random: () => 0.9 }
    );
    play(g.engine, P1, g.id("flip"), {});
    const pc = g.engine.state.pendingChoice as never as {
      kind: string;
      sourceId?: string;
      flipSourceId?: string;
      won?: boolean;
      playerId: string;
    };
    assert.equal(pc.kind, "coinFlipReplace");
    assert.equal(pc.playerId, P1);
    assert.equal(pc.sourceId, g.id("coin"));
    assert.equal(pc.flipSourceId, g.id("flip"));
    assert.equal(pc.won, false);
  });
});

// ---------------------------------------------------------------------------
// E. getStatModifiers
// ---------------------------------------------------------------------------

/** printed base + the sum of every term, floored at 0, is what getStat reports. */
function assertStatBreakdownMatches(engine: Engine, cardId: string, stat: Stat): void {
  const def = engine.getDefinition(cardId);
  // A faction's influence is its owner's live pool, not a modified stat (getStatModifiers says so: no terms).
  if (stat === "influence" && def.type === "faction") {
    assert.deepEqual(engine.getStatModifiers(cardId, stat), []);
    return;
  }
  const base = stat === "influence" ? (def.influence ?? 0) : (def[stat] ?? 0);
  const terms = engine.getStatModifiers(cardId, stat);
  const sum = terms.reduce((n, t) => n + t.amount, 0);
  assert.equal(Math.max(0, base + sum), engine.getStat(cardId, stat), `${stat} of ${cardId}`);
}

const ALL_STATS: Stat[] = ["strength", "life", "speed", "influence", "structure"];

describe("getStatModifiers: the terms behind getStat, with cause and duration", () => {
  test("Heavy Fists (an aura) and a lasting +2 / set / multiply: kinds, durations and the exact sum", () => {
    const g = turnGame([
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "hf", def: printing(HEAVY_FISTS), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "src", def: character({ name: "Src" }), owner: P1, zone: "play" }
    ]);
    const host = g.id("host");
    const turn = g.engine.state.turn;
    const terms = g.engine.getStatModifiers(host, "strength");
    assert.equal(terms.length, 1);
    assert.equal(terms[0].kind, "aura");
    assert.equal(terms[0].sourceId, g.id("hf"));
    assert.equal(terms[0].abilityId, "heavy-fists-buff");
    assert.equal(terms[0].amount, 3);
    assert.deepEqual(terms[0].duration, { type: "whileSourceInPlay" });
    assert.equal(g.engine.getStat(host, "strength"), 5);

    g.engine.state.modifiers.push(
      { id: "m1", sourceId: g.id("src"), targetId: host, stat: "strength", operation: "add", value: 2, duration: { type: "untilEndOfTurn" }, createdTurn: turn },
      { id: "m2", sourceId: g.id("src"), targetId: host, stat: "strength", operation: "multiply", value: 2, duration: { type: "untilEndOfTurn" }, createdTurn: turn },
      { id: "m3", targetId: host, stat: "life", operation: "set", value: 9, duration: { type: "permanent" }, createdTurn: turn }
    );
    const strength = g.engine.getStatModifiers(host, "strength");
    assert.deepEqual(strength.map(t => t.kind), ["aura", "runtime", "runtime"]);
    assert.deepEqual(strength.map(t => t.amount), [3, 2, 7], "2 base + 3 + 2 = 7, doubled = +7");
    assert.deepEqual(strength[1].duration, { type: "untilEndOfTurn" });
    assert.equal(strength[1].sourceId, g.id("src"));
    assert.equal(g.engine.getStat(host, "strength"), 14);
    const life = g.engine.getStatModifiers(host, "life");
    assert.deepEqual(life.map(t => [t.kind, t.operation, t.amount]), [["aura", "add", 3], ["runtime", "set", 2]]);
    assert.equal(life[1].sourceId, undefined);

    for (const stat of ALL_STATS) {
      for (const card of Object.values(g.engine.state.cards)) assertStatBreakdownMatches(g.engine, card.id, stat);
    }
  });

  test("a card's own continuous text is 'printed'; a stat nothing touches has no terms; a faction's influence has none", () => {
    const self = character({
      name: "Self",
      strength: 1,
      behavior: { abilities: [{ id: "own", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 4 }] }] }
    });
    const g = turnGame([{ key: "self", def: self, owner: P1, zone: "play" }]);
    const [term] = g.engine.getStatModifiers(g.id("self"), "strength");
    assert.equal(term.kind, "printed");
    assert.equal(term.sourceId, g.id("self"));
    assert.deepEqual(g.engine.getStatModifiers(g.id("self"), "life"), []);
    const faction = g.engine.state.players[P1].factionId!;
    assert.deepEqual(g.engine.getStatModifiers(faction, "influence"), []);
  });

  test("the sum matches getStat on a real board: Fists, Subversion Matrix, a played tactic's lasting modifiers", () => {
    const g = turnGame([
      { key: "a", def: character({ name: "A", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "hf", def: printing(HEAVY_FISTS), owner: P1, zone: "play", attachedToKey: "a" },
      { key: "b", def: texty(), owner: P2, zone: "play" },
      { key: "sm", def: printing(SUBVERSION_MATRIX), owner: P2, zone: "play", attachedToKey: "b" },
      { key: "isy", def: printing(I_SEE_YOU), owner: P1, zone: "hand" },
      { key: "sneak", def: character({ name: "Sneak", speed: 3, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" },
      ...banks(4, P1),
      ...volition(3, P1)
    ]);
    play(g.engine, P1, g.id("isy"), { selected: { c: [g.id("sneak")] } });
    // I See You! with 3 volition: -1 speed on the picked character, a real runtime modifier from a played card.
    for (const stat of ALL_STATS) {
      for (const card of Object.values(g.engine.state.cards)) assertStatBreakdownMatches(g.engine, card.id, stat);
    }
    const speed = g.engine.getStatModifiers(g.id("sneak"), "speed");
    assert.equal(speed.length, 1);
    assert.equal(speed[0].kind, "runtime");
    assert.equal(speed[0].amount, -1);
    // I See You! re-enters play face-down, so a viewer is not told which card did it.
    assert.equal(g.engine.state.cards[g.id("isy")].faceDown, true);
    assert.equal(speed[0].sourceId, undefined);
    assert.deepEqual(speed[0].duration, { type: "untilEndOfTurn" });
    assert.equal(g.engine.getStat(g.id("sneak"), "speed"), 2);
  });
});
