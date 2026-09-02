// Data-driven "authoring survives the engine" pass for every Open Beta
// card: instantiate it through the real catalog, play / activate / trigger
// it against a broad synthetic board, and auto-resolve every pending choice
// with a safe default. Asserts nothing throws an UNEXPECTED error (a missing
// effect handler, a bad selector, `undefined` deref, an infinite choice
// loop). Expected "needs a specific setup" assertions are ignored.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  createCardInstance,
  createTwoPlayerGame,
  SpoilsEngine
} from "../../engine.js";
import type {
  CardDefinition,
  CardInstance,
  GameState,
  PlayerId
} from "../../engine.js";
import { P1, P2 } from "./support/fixtures.js";

const CATALOG = cardsJson as CardDefinition[];
const OBSET = CATALOG.filter(c => c.set === "Open Beta" && c.behavior);

// Errors that just mean "this card needs a specific board/timing" — not a bug.
const EXPECTED = [
  /threshold requirements are not met/i,
  /Costs cannot be paid/i,
  /Not enough unattached resources/,
  /requires .*selection/i,
  /requires selecting exactly/i,
  /Illegal target/i,
  /must be resolved before/i,
  /Only the active player/i,
  /Cards may only be deployed/i,
  /can only be played when an effect instructs/i,
  /cannot be deployed right now/i,
  /No pending choice/i,
  /does not match the pending decision/i,
  /is not one of the/i,
  /must contain exactly the same cards/i,
  /piles together must be/i,
  /different names/i,
  /A COVERT/i,
  /can only be blocked/i,
  /must attack if it can/i,
  /must block if it can/i,
  /Activated ability not found/,
  /face-down card's abilities cannot be activated/,
  /abilities cannot be used/,
  /You do not control that card/,
  /You cannot deploy that card/,
  /Card must be in your hand/,
  /Missing .*target/i,
  /A non-empty value must be named/,
  /A resource icon must be named/,
  /A trade must be named/,
  /not a legal free-deploy candidate/i,
  /Source must be in zone/,
  /Response.*finish/i,
  /not accepting/i,
  /Only the defending player/i,
  /Battle is not/i,
  /Battles may target/i,
  /Shares must add up/i,
  /positive integer/i,
  /at most/i,
  /above its maximum/i,
  /below its minimum/i,
  /Ability condition is not satisfied/i,
  /cannot be deployed at this time/i,
  /not a legal/i,
  /already depleted/i,
  /already restored/i
];
const isExpected = (msg: string) => EXPECTED.some(re => re.test(msg));

const ICONS = ["rage", "greed", "deception", "elitism", "obsession", "volition"] as const;

function resDef(icon: string, i: number): CardDefinition {
  return {
    id: `ex-res-${icon}-${i}`,
    name: icon === "volition" ? "Volition" : icon[0].toUpperCase() + icon.slice(1),
    set: "Test",
    type: "resource",
    trade: "universal",
    rarity: "common",
    cost: 0,
    threshold: 0,
    subtype: [],
    text: "",
    resource: { provides: [icon as "rage"], staple: true }
  };
}
function bodyDef(id: string, type: "character" | "item" | "location", extra: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id, name: id, set: "Test", type, trade: "universal", rarity: "common", cost: 1, threshold: 0,
    subtype: type === "character" ? ["gear"] : [], text: "",
    ...(type === "character" ? { strength: 2, life: 4, speed: 3 } : {}),
    ...(type === "location" ? { structure: 5 } : {}),
    ...extra
  };
}

let uniq = 0;
function richGame(subject: CardDefinition, subjectZone: "hand" | "play"): { engine: SpoilsEngine; subjectId: string } {
  uniq++;
  const defs: CardDefinition[] = [subject];
  const instances: CardInstance[] = [];
  const add = (def: CardDefinition, owner: PlayerId, zone: CardInstance["zone"], faceDown = false) => {
    if (!defs.find(d => d.id === def.id)) defs.push(def);
    const inst = createCardInstance(def.id, owner, zone);
    inst.controllerId = owner;
    inst.faceDown = faceDown;
    if (zone === "play" && def.type === "character") inst.attackEligibleTurn = 1;
    instances.push(inst);
    return inst;
  };

  // faction cards
  const fA = { id: `ex-fac-a-${uniq}`, name: "FacA", set: "Test", type: "faction" as const, trade: "universal" as const, rarity: "common", cost: 0, threshold: 0, subtype: [], text: "", faction: { startingInfluence: 40, setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } }, turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "playResource" as const, count: 1 }] } } } };
  const fB = { ...fA, id: `ex-fac-b-${uniq}`, name: "FacB" };
  const fAi = add(fA, P1, "play");
  const fBi = add(fB, P2, "play");

  const subjInst = add(subject, subjectZone === "play" ? P1 : P1, subjectZone);

  // broad board, both sides
  for (const P of [P1, P2] as const) {
    for (const icon of ICONS) for (let i = 0; i < 6; i++) add(resDef(icon, uniq * 100 + i), P, "play");
    for (let i = 0; i < 3; i++) add(resDef("volition", uniq * 200 + i), P, "play", true); // face-down = Volition
    for (let i = 0; i < 3; i++) add(bodyDef(`ex-ch-${P}-${uniq}-${i}`, "character", { subtype: ["gear", "soldier", "node"], strength: 2, life: 4, speed: 3 }), P, "play");
    for (let i = 0; i < 2; i++) add(bodyDef(`ex-it-${P}-${uniq}-${i}`, "item", { subtype: ["gear"] }), P, "play");
    for (let i = 0; i < 2; i++) add(bodyDef(`ex-lo-${P}-${uniq}-${i}`, "location"), P, "play");
    for (let i = 0; i < 6; i++) add(bodyDef(`ex-dk-${P}-${uniq}-${i}`, "character", { subtype: ["soldier", "node", "gear"] }), P, "deck");
    for (let i = 0; i < 3; i++) add(bodyDef(`ex-di-${P}-${uniq}-${i}`, "character"), P, "discard");
    add(resDef("rage", uniq * 300), P, "discard");
    add(bodyDef(`ex-vd-${P}-${uniq}`, "character"), P, "void");
    add(bodyDef(`ex-hn-${P}-${uniq}`, "character"), P, "hand");
    add(resDef("volition", uniq * 400), P, "hand");
    add(bodyDef(`ex-mm-${P}-${uniq}`, "character", { name: "Micromajig", subtype: ["micromajig"] }), P, "play");
  }
  // a "gear" item attached to a P1 character so `hasAttachment` paths light up
  const attachHost = instances.find(i => i.ownerId === P1 && i.zone === "play" && defs.find(d => d.id === i.definitionId)?.type === "character");
  const attachGear = add(bodyDef(`ex-attach-${uniq}`, "item", { subtype: ["gear"], attachTo: "character" }), P1, "play");
  if (attachHost) attachGear.attachedTo = attachHost.id;

  const state: GameState = createTwoPlayerGame(
    { id: P1, name: "P1", influence: 40 },
    { id: P2, name: "P2", influence: 40 },
    instances
  );
  state.players[P1].factionId = fAi.id;
  state.players[P2].factionId = fBi.id;
  state.turn = 1;
  state.activePlayerId = P1;
  state.priorityPlayerId = P1;
  state.setup = { phase: "complete" };
  state.started = true;

  const engine = new SpoilsEngine(defs, state, () => 0.5);
  return { engine, subjectId: subjInst.id };
}

function settle(engine: SpoilsEngine, budget = 60): string[] {
  const notes: string[] = [];
  let n = 0;
  while (engine.state.pendingChoice) {
    if (++n > budget) throw new Error(`PENDING-CHOICE LOOP (${engine.state.pendingChoice.kind})`);
    const pc: any = engine.state.pendingChoice;
    const who = pc.playerId as PlayerId;
    const legal = (): string[] => {
      // best-effort legal id list for target-style choices
      const decl = pc.declaration;
      if (!decl) return [];
      try {
        // ask the engine indirectly: just try the first in-play / zone card of the right owner
        const ids = Object.values(engine.state.cards)
          .filter(c => c.zone === (Array.isArray(decl.selector?.zone) ? decl.selector.zone[0] : decl.selector?.zone ?? "play"))
          .map(c => c.id);
        return ids;
      } catch { return []; }
    };
    try {
      switch (pc.kind) {
        case "selectTargets": {
          const sel: Record<string, string[]> = {};
          for (const d of pc.declarations ?? []) sel[d.id] = [];
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "selectTargets", selected: sel } });
          break;
        }
        case "chooserSelectsTarget":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsTarget", selected: pc.declaration?.optional ? [] : [legal()[0]].filter(Boolean) } });
          break;
        case "chooserSelectsOption":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooserSelectsOption", index: 0 } });
          break;
        case "chooseNumber":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooseNumber", value: pc.min ?? 0 } });
          break;
        case "mayPay":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "mayPay", pay: false } });
          break;
        case "alternatingPay":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "alternatingPay", pay: false } });
          break;
        case "anyPlayerMayPay":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "anyPlayerMayPay", pay: false } });
          break;
        case "replacementChoice":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "replacementChoice", apply: false } });
          break;
        case "nameValue":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "nameValue", value: pc.valueKind === "resourceIcon" ? "volition" : pc.valueKind === "trade" ? "warlord" : "gear" } });
          break;
        case "distributeAmong":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "distributeAmong", shares: {} } });
          break;
        case "deployForFree":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "deployForFree" } });
          break;
        case "reorderDeck":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "reorderDeck", order: pc.to === "split" ? [] : [...(pc.cardIds ?? [])], bottom: pc.to === "split" ? [...(pc.cardIds ?? [])] : undefined } });
          break;
        case "pileAssignment":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "pileAssignment", pile1: [...(pc.cardIds ?? [])], pile2: [] } });
          break;
        case "useAnyAbility":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "useAnyAbility", cardId: undefined } as any });
          break;
        case "useTargetAbility":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "useTargetAbility" } as any });
          break;
        case "orderTriggers":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "orderTriggers", next: (pc.triggers ?? [])[0] } as any });
          break;
        case "uniqueSurvivor":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "uniqueSurvivor", keep: (pc.groups?.[0]?.cardIds ?? [])[0] } as any });
          break;
        case "partitionCards":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "partitionCards", piles: [[...(pc.cardIds ?? [])]] } as any });
          break;
        case "pickPile":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "pickPile", pileIndex: 0 } as any });
          break;
        case "takeFromPile":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "takeFromPile", cardIds: [] } as any });
          break;
        case "auctionBid":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "auctionBid", bid: 0 } as any });
          break;
        case "coinFlipReplace":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "coinFlipReplace", reflip: false } as any });
          break;
        case "chooseChosenBlockers":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "chooseChosenBlockers", cardIds: [] } as any });
          break;
        case "spendCountersMenu":
          engine.perform({ type: "resolvePendingChoice", playerId: who, choice: { kind: "spendCountersMenu", optionIndex: null } as any });
          break;
        default:
          notes.push(`UNHANDLED pendingChoice kind: ${pc.kind}`);
          engine.state.pendingChoice = undefined;
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (!isExpected(msg)) notes.push(`settle(${pc.kind}): ${msg}`);
      // force-clear so we don't loop forever on an unanswerable choice
      if (engine.state.pendingChoice === pc) engine.state.pendingChoice = undefined;
    }
  }
  return notes;
}

function tryAct(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return isExpected(msg) ? null : msg;
  }
}

describe("Open Beta exercise: every authored card survives the engine", () => {
  const failures: string[] = [];

  for (const card of OBSET) {
    test(card.name, () => {
      const local: string[] = [];
      const abilities = card.behavior?.abilities ?? [];
      const isTactic = card.type === "tactic";

      if (isTactic) {
        for (const mode of card.behavior?.modes ? card.behavior.modes.map((_, i) => i) : [undefined]) {
          const { engine, subjectId } = richGame(card, "hand");
          const err = tryAct(() =>
            engine.perform({ type: "playCard", playerId: P1, cardId: subjectId, selected: {}, variables: { x: 1, y: 2, n: 1 }, ...(mode !== undefined ? { mode } : {}) } as any)
          );
          if (err) local.push(`play(mode=${mode}): ${err}`);
          local.push(...settle(engine));
        }
      } else {
        // 1) card sits in play — force continuous / replacement recompute
        {
          const { engine, subjectId } = richGame(card, "play");
          tryAct(() => {
            engine.getFlowView();
            engine.getStat(subjectId, "strength");
            engine.getStat(subjectId, "life");
            engine.getStat(subjectId, "structure");
            engine.getKeywords(subjectId);
            engine.getThresholds(P1);
          });
          // fire common events
          tryAct(() => engine.perform({ type: "endTurn", playerId: P1 }));
          local.push(...settle(engine));
          tryAct(() => engine.perform({ type: "endTurn", playerId: P2 }));
          local.push(...settle(engine));
        }
        // 2) each activated ability, fresh board
        for (const ab of abilities) {
          if ((ab as any).type !== "activated") continue;
          const zone = ((ab as any).activationZone ?? "play") as "play" | "discard" | "hand" | "void";
          const { engine, subjectId } = richGame(card, "play");
          if (zone !== "play") {
            const c = engine.state.cards[subjectId];
            engine.state.players[P1].play = engine.state.players[P1].play.filter(x => x !== subjectId);
            (engine.state.players[P1] as any)[zone].push(subjectId);
            c.zone = zone;
          }
          const err = tryAct(() =>
            engine.perform({ type: "activateAbility", playerId: P1, cardId: subjectId, abilityId: (ab as any).id, selected: {}, variables: { x: 1, y: 2, n: 1 } } as any)
          );
          if (err) local.push(`activate(${(ab as any).id}): ${err}`);
          local.push(...settle(engine));
        }
        // 3) trigger exercise: play a resource + a body, deal damage, destroy, mini turn
        {
          const { engine, subjectId } = richGame(card, "play");
          const vHand = engine.state.players[P1].hand.find(id => engine.getDefinition(id).type === "resource");
          if (vHand) {
            tryAct(() => engine.perform({ type: "chooseDevelop", playerId: P1, choice: { type: "playResource", cards: [{ cardId: vHand, faceDown: false }] } } as any));
            local.push(...settle(engine));
          }
          const p2char = engine.state.players[P2].play.find(id => engine.getDefinition(id).type === "character" && !engine.state.cards[id].faceDown);
          if (p2char) {
            tryAct(() => (engine as any).emit({ type: "damageDealt", sourceId: subjectId, targetId: p2char, amount: 1 }));
            local.push(...settle(engine));
          }
        }
      }

      if (local.length) {
        for (const l of local) failures.push(`${card.name} :: ${l}`);
        assert.fail(local.join("\n  "));
      }
    });
  }
});
