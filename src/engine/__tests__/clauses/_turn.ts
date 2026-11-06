// Shared turn / setup helpers for clause tests (docs/TESTING.md), from
// the seed-3-03 pilot. Use them for turn-structure clauses ("At the start of
// your turn ..."), DEVELOP / RESTORE rules, and faction setup clauses
// (STARTING RESOURCES / STARTING DRAW), which only the real setup path runs.

import { createTwoPlayerFactionGame } from "../../../engine.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { bank, developFaction, isDevelopPrompt, P1, P2, resolvePendingResponses, settleStartFirst } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { developDraw as drawViaRule, developPlay as playViaRule, isDevelopChoice, openDevelop, settleTurnStart } from "../support/develop.js";
import { holdResourceFace, withoutDevelopChoices } from "./_hold.js";

export interface Seat {
  /** The player's faction card. */
  faction: CardDefinition;
  /** The rest of the deck, top to bottom before shuffling (the real setup shuffles with `seed`). */
  deck: CardDefinition[];
}

export interface SetupOptions {
  /** Who goes first (default P1). */
  first?: PlayerId;
  /** Per-player X for "X staple resources" style STARTING RESOURCES. */
  x?: Record<PlayerId, number>;
  /** Run the opt-in `chooseStartingResources` setup step. */
  choose?: boolean;
  /** RNG seed for the shuffle (default 7). */
  seed?: number;
}

/**
 * A game through the REAL setup path (`createTwoPlayerFactionGame`): faction
 * setup rules, starting resources, opening hands and mulligan state all come
 * from the faction cards. Use it for STARTING RESOURCES / STARTING DRAW and
 * anything else that happens during setup.
 */
export function setupGame(p1: Seat, p2: Seat, options: SetupOptions = {}): SpoilsEngine {
  const defs = new Map<string, CardDefinition>();
  for (const def of [p1.faction, p2.faction, ...p1.deck, ...p2.deck]) defs.set(def.id, def);
  return createTwoPlayerFactionGame(
    [...defs.values()],
    { id: P1, name: "Alice", deckDefinitionIds: [p1.faction.id, ...p1.deck.map((def) => def.id)] },
    { id: P2, name: "Bob", deckDefinitionIds: [p2.faction.id, ...p2.deck.map((def) => def.id)] },
    {
      firstPlayerId: options.first ?? P1,
      seed: options.seed ?? 7,
      startingResourceX: options.x,
      chooseStartingResources: options.choose
    }
  );
}

/**
 * `developFaction()` (same name, influence and setup) whose Develop Rule offers nothing, like
 * `trigger-ordering.test.ts`'s "barren" faction. For a test that runs REAL turn starts (`endTurnRaw`, a hand-made
 * `endTurn` action) and is about a card's own start-of-turn trigger: the Develop Rule cannot be skipped, so with a
 * drawing faction every such turn start would draw a card and shift the test's hand / deck counts.
 */
export function barrenFaction(overrides: Partial<CardDefinition> = {}): CardDefinition {
  const base = developFaction();
  return developFaction({
    faction: { ...base.faction!, turn: { ...base.faction!.turn, develop: { choices: [] } } },
    ...overrides
  });
}

/**
 * Ends `playerId`'s turn and drains the response window — the next turn's start-of-turn triggers are queued. The
 * incoming player's Restore Rule (and any other start-of-turn trigger) is then settled by `settleTurnStart`; a prompt
 * of anything else is left open. The Develop Rule cannot be skipped, so by default (`develop: "none"`) the factions
 * offer no Develop choices for this one turn start (as a faction with empty `develop.choices` would) and it neither
 * draws nor asks anything (`withoutDevelopChoices`): tests keep their hand and deck counts. `develop:
 * "draw"` leaves the rule alone, so it draws. Use `endTurnRaw` to stop at the turn start's own prompts.
 */
export function endTurn(engine: SpoilsEngine, playerId: PlayerId, develop: "none" | "draw" = "none"): void {
  if (develop === "none") withoutDevelopChoices(engine, () => endTurnRaw(engine, playerId));
  else endTurnRaw(engine, playerId);
  settleStartFirst(engine);
  resolvePendingResponses(engine);
}

/** Ends `playerId`'s turn and drains the response window, leaving whatever the new turn's start raised pending. */
export function endTurnRaw(engine: SpoilsEngine, playerId: PlayerId): void {
  engine.perform({ type: "endTurn", playerId });
  resolvePendingResponses(engine);
}

export function factionOf(engine: SpoilsEngine, playerId: PlayerId): CardInstanceId {
  return engine.state.players[playerId].factionId!;
}

/** Uses the faction's Develop Rule to draw (as its start-of-turn trigger would offer it). */
export const developDraw = (engine: SpoilsEngine, playerId: PlayerId): void => drawViaRule(engine, playerId);

/** Uses the faction's Develop Rule to play `cardId` as a resource. */
export const developResource = (engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, faceDown: boolean): void =>
  developPlay(engine, playerId, cardId, faceDown);

/**
 * `support/develop.ts`'s `developPlay`, with the suite's own "resource face-up" auto-answer held off so the face-up /
 * face-down prompt is left for the helper to answer (the clause harness otherwise answers it face-up).
 */
export function developPlay(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, faceDown = false): void {
  holdResourceFace(() => playViaRule(engine, playerId, cardId, faceDown));
}

/**
 * What the Develop Rule would offer `playerId` right now: the labels of its options ("Draw 1 card", "Play a resource"),
 * `[]` when it offers nothing (no Develop Rule, or an opponent's Pulling Strings). A look only: the rule is not opened
 * or used (its prompt cannot be dismissed, so opening it just to look would cost a draw), built from the engine's own
 * `getDevelopChoices` the way the prompt builds its options (a resource play needs a card in hand).
 */
export function developOffers(engine: SpoilsEngine, playerId: PlayerId): string[] {
  const hasHand = engine.state.players[playerId].hand.length > 0;
  const labels: string[] = [];
  for (const choice of engine.getDevelopChoices(playerId)) {
    if (choice.type === "draw") labels.push(`Draw ${choice.count} card${choice.count === 1 ? "" : "s"}`);
    else if (hasHand) labels.push(choice.count === 1 ? "Play a resource" : `Play ${choice.count} resources`);
  }
  return labels;
}

/**
 * Answers a real turn start's `orderTriggers` prompts (Restore Rule first) until the Develop Rule's option prompt is
 * open, and leaves it pending for `pickDevelopDraw` / `pickDevelopResource`.
 */
export function orderUntilDevelop(engine: SpoilsEngine): void {
  for (let guard = 0; guard < 20; guard++) {
    const pending = engine.state.pendingChoice;
    if (isDevelopChoice(pending)) return;
    if (pending?.kind !== "orderTriggers") throw new Error(`Expected the turn start's trigger order or Develop Rule, found ${pending?.kind ?? "nothing"}.`);
    const next = pending.triggers.find((trigger) => trigger.abilityId === "restoreRule") ?? pending.triggers[0];
    engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "orderTriggers", next } });
  }
  throw new Error("The Develop Rule's options never came up.");
}

/** Closes the Develop Rule if it re-offers itself (a `usesPerTurn: 2` rule after its first use): it cannot be skipped, so it draws what is left. */
export function developDrawLeft(engine: SpoilsEngine, playerId?: PlayerId): void {
  const pending = engine.state.pendingChoice;
  // (a rule opened by `openDevelop` carries no ability id in its context, so recognise it by its option labels)
  const isDevelopOptions = (labels: string[]): boolean => labels.length > 0 && labels.every((label) => /^(Draw \d+ cards?|Play (a resource|\d+ resources))$/.test(label));
  if (pending?.kind === "chooserSelectsOption" && isDevelopOptions(pending.options.map((o) => o.label ?? "")) && pending.options.some((o) => /^Draw /.test(o.label ?? ""))) {
    pickDevelopDraw(engine, playerId ?? pending.playerId);
  }
}

/** Picks "Draw" on an already-open Develop Rule prompt (the second offer of a `usesPerTurn: 2` rule, say). */
export function pickDevelopDraw(engine: SpoilsEngine, playerId: PlayerId): void {
  const pending = engine.state.pendingChoice;
  const index = pending?.kind === "chooserSelectsOption" ? pending.options.findIndex((o) => /^Draw /.test(o.label ?? "")) : -1;
  if (index < 0) throw new Error("No open Develop Rule prompt offering a draw.");
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsOption", index } });
}

/** Opens the Develop Rule and picks "Play a resource", leaving the pick of the card pending. */
export function openDevelopPlay(engine: SpoilsEngine, playerId: PlayerId): void {
  openDevelop(engine, playerId);
  const pending = engine.state.pendingChoice;
  const index = pending?.kind === "chooserSelectsOption" ? pending.options.findIndex((o) => /^Play /.test(o.label ?? "")) : -1;
  if (index < 0) throw new Error("The Develop Rule offers no resource play.");
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsOption", index } });
}

/** Uses a Develop Rule that plays several resources: opens it, picks the play option and plays each of `cardIds` in turn. */
export function developResources(engine: SpoilsEngine, playerId: PlayerId, cardIds: CardInstanceId[], faceDown = false): void {
  holdResourceFace(() => developResourcesHeld(engine, playerId, cardIds, faceDown));
}

function developResourcesHeld(engine: SpoilsEngine, playerId: PlayerId, cardIds: CardInstanceId[], faceDown: boolean): void {
  openDevelopPlay(engine, playerId);
  for (const cardId of cardIds) {
    if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
      engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected: [cardId], faceDown } });
    }
    if (engine.state.pendingChoice?.kind === "playResource") {
      engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "playResource", faceDown } });
    }
  }
}

/** Picks "Play a resource" on an already-open Develop Rule prompt and plays `cardId`, then leaves what comes next pending. */
export function pickDevelopResource(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, faceDown: boolean): void {
  holdResourceFace(() => pickDevelopResourceHeld(engine, playerId, cardId, faceDown));
}

function pickDevelopResourceHeld(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, faceDown: boolean): void {
  const pending = engine.state.pendingChoice;
  const index = pending?.kind === "chooserSelectsOption" ? pending.options.findIndex((o) => /^Play /.test(o.label ?? "")) : -1;
  if (index < 0) throw new Error("No open Develop Rule prompt offering a resource play.");
  engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsOption", index } });
  if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") {
    engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "chooserSelectsTarget", selected: [cardId], faceDown } });
  }
  if (engine.state.pendingChoice?.kind === "playResource") {
    engine.perform({ type: "resolvePendingChoice", playerId, choice: { kind: "playResource", faceDown } });
  }
}

/** Resources `playerId` has attached to (spent on) their faction. */
export const attachedCount = (engine: SpoilsEngine, playerId: PlayerId): number =>
  engine.state.players[playerId].play.filter(
    (id) => engine.isResource(id) && engine.state.cards[id].attachedTo === engine.state.players[playerId].factionId
  ).length;

/** Resources `playerId` can still spend. */
export const readyCount = (engine: SpoilsEngine, playerId: PlayerId): number => engine.getAvailableResourceCount(playerId);

/** `n` rage resources for `owner`, already attached to (spent on) `owner`'s faction. */
export function spentResources(owner: PlayerId, n: number): CardPlacement[] {
  return bank("rage", n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
}

export { isDevelopPrompt, P1, P2, openDevelop, settleStartFirst, settleTurnStart };
