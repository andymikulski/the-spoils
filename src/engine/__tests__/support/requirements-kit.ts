// Shared board and answer-driver for the read-only client queries (getPlayRequirements, checkAction, ...).
//
// `richBoard` is a settled mid-game position with something of every kind in every zone, so a real catalog card
// placed on it usually has what it needs. `completePlay` walks `getPlayRequirements` to the end, answering each
// requirement from what the engine offered, and returns the action it built.

import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { answerPlayRequirement } from "../../../engine.js";
import type { PickStep, PlayAction, PlayRequirement } from "../../../engine.js";
import { bank, banks, developFaction } from "../per-card/_harness.js";
import { buildGame, character, item, location, resourceCard, tactic, P1, P2 } from "./fixtures.js";
import type { CardPlacement } from "./fixtures.js";

export { P1, P2 };

const staple = (name: string) => resourceCard({ name });

/** Everything a real card could want, on both sides, in every zone. Keys: `a1..a3` (P1 characters), `gear`, `fort`, `b1..b2`, `h*` hand, `d*` discard, `k*` deck. */
export function richBoardCards(): CardPlacement[] {
  return [
    ...banks(4, P1),
    ...bank("obsession", 4, P2),
    { key: "a1", def: character({ name: "Ann", trade: "rogue", strength: 3, life: 4, cost: 2 }), owner: P1 },
    { key: "a2", def: character({ name: "Bo", trade: "banker", strength: 2, life: 4, cost: 4 }), owner: P1 },
    { key: "a3", def: character({ name: "Cy", trade: "arcanist", strength: 1, life: 4, cost: 1 }), owner: P1 },
    { key: "gear", def: item({ name: "Ring", subtype: ["gear"], cost: 1 }), owner: P1 },
    { key: "fort", def: location({ name: "Fort" }), owner: P1 },
    { key: "b1", def: character({ name: "Dee", trade: "warlord", strength: 2, life: 4, cost: 3 }), owner: P2 },
    { key: "b2", def: character({ name: "Eve", trade: "gearsmith", strength: 2, life: 4, cost: 5 }), owner: P2 },
    { key: "bgear", def: item({ name: "Foe Ring", subtype: ["gear"] }), owner: P2 },
    { key: "bfort", def: location({ name: "Foe Fort" }), owner: P2 },
    { key: "h1", def: character({ name: "Hand One", trade: "rogue" }), owner: P1, zone: "hand" },
    { key: "h2", def: tactic({ name: "Hand Two" }), owner: P1, zone: "hand" },
    { key: "h3", def: staple("Hand Three"), owner: P1, zone: "hand" },
    { key: "d1", def: character({ name: "Dis One", trade: "rogue" }), owner: P1, zone: "discard" },
    { key: "d2", def: character({ name: "Dis Two", trade: "banker" }), owner: P1, zone: "discard" },
    { key: "d3", def: item({ name: "Dis Gear", subtype: ["gear"] }), owner: P1, zone: "discard" },
    { key: "d4", def: tactic({ name: "Dis Tactic" }), owner: P1, zone: "discard" },
    { key: "k1", def: character({ name: "Deck One" }), owner: P1, zone: "deck" },
    { key: "k2", def: character({ name: "Deck Two", trade: "banker" }), owner: P1, zone: "deck" },
    { key: "k3", def: item({ name: "Deck Item" }), owner: P1, zone: "deck" },
    { key: "bh1", def: character({ name: "Foe Hand" }), owner: P2, zone: "hand" },
    { key: "bd1", def: character({ name: "Foe Dis" }), owner: P2, zone: "discard" },
    { key: "bk1", def: character({ name: "Foe Deck" }), owner: P2, zone: "deck" }
  ];
}

/** A settled position with `extra` cards added (the real card under test goes there). */
export function richBoard(extra: CardPlacement[] = [], options: { playerA?: { faction?: CardDefinition } } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), ...(options.playerA ?? {}) },
    cards: [...richBoardCards(), ...extra]
  });
}

type Strategy = "min" | "max";

/** Greedily picks cards from `step.candidates`, skipping any that would break a distinct-names / trades / types rule. */
export function chooseCards(engine: SpoilsEngine, step: PickStep, strategy: Strategy): CardInstanceId[] {
  const want = strategy === "max" ? Math.min(step.max, step.candidates.length) : step.min;
  const taken: CardInstanceId[] = [];
  const seen = { name: new Set<string>(), trade: new Set<string>(), type: new Set<string>() };
  for (const id of step.candidates) {
    if (taken.length >= want) break;
    const definition = engine.getDefinition(id);
    if (step.distinctNames && seen.name.has(definition.name)) continue;
    if (step.distinctTrades && seen.trade.has(String(definition.trade))) continue;
    if (step.distinctTypes && seen.type.has(definition.type)) continue;
    seen.name.add(definition.name);
    seen.trade.add(String(definition.trade));
    seen.type.add(definition.type);
    taken.push(id);
  }
  return taken;
}

/** Answers one requirement the way a player who always takes the first thing offered would. */
export function answerFirst(engine: SpoilsEngine, action: PlayAction, requirement: PlayRequirement, strategy: Strategy): PlayAction {
  switch (requirement.kind) {
    case "mode":
      return answerPlayRequirement(action, { kind: "mode", index: requirement.options[0].index });
    case "flipUpOption": {
      const option = requirement.options.find((entry) => entry.available) ?? requirement.options[0];
      return answerPlayRequirement(action, { kind: "flipUpOption", index: option.index });
    }
    case "opponent":
      return answerPlayRequirement(action, { kind: "opponent", playerId: requirement.candidates[0] });
    case "variables":
      return answerPlayRequirement(action, {
        kind: "variables",
        values: Object.fromEntries(requirement.variables.map((variable) => [variable.id, variable.min]))
      });
    case "pick": {
      const cardIds = chooseCards(engine, requirement, strategy);
      return answerPlayRequirement(action, {
        kind: "pick",
        id: requirement.requirement.id,
        cardIds,
        declined: requirement.declinable && cardIds.length === 0
      });
    }
  }
}

/** Walks `getPlayRequirements` to the end. Returns the finished action and every requirement it was asked, in order. */
export function completePlay(
  engine: SpoilsEngine,
  start: PlayAction,
  strategy: Strategy = "max"
): { action: PlayAction; asked: PlayRequirement[] } {
  let action = start;
  const asked: PlayRequirement[] = [];
  for (let step = 0; step < 24; step++) {
    const next = engine.getPlayRequirements(action)[0];
    if (!next) return { action, asked };
    asked.push(next);
    const answered = answerFirst(engine, action, next, strategy);
    if (JSON.stringify(answered) === JSON.stringify(action)) {
      throw new Error(`Answering ${JSON.stringify(next).slice(0, 200)} changed nothing.`);
    }
    action = answered;
  }
  throw new Error("getPlayRequirements did not converge in 24 answers.");
}

export const playOf = (playerId: PlayerId, cardId: CardInstanceId): PlayAction => ({ type: "playCard", playerId, cardId });
export const abilityOf = (playerId: PlayerId, cardId: CardInstanceId, abilityId: string): PlayAction => ({
  type: "activateAbility",
  playerId,
  cardId,
  abilityId
});
