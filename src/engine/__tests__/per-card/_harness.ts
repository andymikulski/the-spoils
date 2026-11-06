// Shared helpers for the per-card correctness suite (per-card/<set>.test.ts).
//
// Goal of that suite: for every catalog card, seed a small mid-game board,
// take the acting player's turn, actually trigger / activate / play the card
// with concrete target picks, and assert the concrete outcome (damage,
// zone moves, counters, stat/keyword/influence deltas) AND that the right
// cards are/aren't offered as targets. These are deliberately tiny and
// data-driven — one board, a few `perform` calls, a few asserts.
//
// Built on `../support/fixtures.ts` (`buildGame`), so it shares the same
// "instances placed directly, setup already complete" model.

import {
  buildGame,
  character,
  item,
  location,
  tactic,
  resourceCard,
  factionCard,
  noDevelopFaction,
  P1,
  P2,
  resolvePendingResponses,
  autoResolveBattle
} from "../support/fixtures.js";
import { readFileSync } from "node:fs";
import { isDevelopChoice } from "../support/develop.js";
import cardsJson from "../../../data/cards.js";
import type {
  CardDefinition,
  CardInstanceId,
  PlayerId,
  SpoilsEngine
} from "../../../engine.js";

export {
  buildGame,
  character,
  item,
  location,
  tactic,
  resourceCard,
  factionCard,
  noDevelopFaction,
  P1,
  P2,
  resolvePendingResponses,
  autoResolveBattle
};

const CATALOG = cardsJson as CardDefinition[];

/** Whether the engine's pending choice is the Develop Rule's option prompt (a real turn start raises it). */
export function isDevelopPrompt(engine: SpoilsEngine): boolean {
  return isDevelopChoice(engine.state.pendingChoice);
}

/** Same as `isDevelopPrompt`; kept for callers that named it so. */
export function isDevelopPromptPending(engine: SpoilsEngine): boolean {
  return isDevelopPrompt(engine);
}

/**
 * The answer that takes the Develop Rule's draw option, when `pending` is its option prompt (else undefined) � for
 * `drain`-style loops that answer every pending choice. The Develop Rule cannot be skipped: it draws or plays a resource.
 */
export function developDrawChoice(pending: unknown): { kind: "chooserSelectsOption"; index: number } | undefined {
  const pc = pending as SpoilsEngine["state"]["pendingChoice"];
  if (!isDevelopChoice(pc) || pc?.kind !== "chooserSelectsOption") return undefined;
  const index = pc.options.findIndex(option => /^Draw /.test(option.label ?? ""));
  return index < 0 ? undefined : { kind: "chooserSelectsOption", index };
}

/**
 * Answers a real turn start's faction rules: the Restore Rule first, then the Develop Rule (a draw: it cannot be skipped), and leaves
 * every other start-of-turn trigger — the cards' own prompts, or an order prompt of nothing but their triggers — to the test.
 */
export function settleStartFirst(engine: SpoilsEngine, _develop: "draw" = "draw"): void {
  for (let guard = 0; guard < 20; guard++) {
    const pending = engine.state.pendingChoice;
    if (pending?.kind === "orderTriggers") {
      const next =
        pending.triggers.find(trigger => trigger.abilityId === "restoreRule") ??
        pending.triggers.find(trigger => trigger.abilityId === "developRule");
      if (!next) return;
      engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "orderTriggers", next } });
    } else if (pending?.kind === "chooserSelectsOption" && isDevelopChoice(pending)) {
      const index = pending.options.findIndex(option => /^Draw /.test(option.label ?? ""));
      engine.perform({ type: "resolvePendingChoice", playerId: pending.playerId, choice: { kind: "chooserSelectsOption", index } });
    } else {
      return;
    }
  }
}

/**
 * A minimal faction whose Develop Rule offers BOTH "draw a card" and "play a
 * resource" — so a per-card test can drive the Develop Rule (`support/develop.ts`) down either path.
 * `buildGame`'s default faction only offers draw.
 */
export function developFaction(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return factionCard({
    id: `pc-dev-faction-${uid++}`,
    name: "DevelopFaction",
    faction: {
      startingInfluence: 30,
      setup: {
        startingResources: { count: 0 },
        openingHand: { goingFirst: 0, goingSecond: 0 }
      },
      turn: {
        restore: { detachResources: true, restoreNonResources: true },
        develop: {
          choices: [
            { type: "draw", count: 1 },
            { type: "playResource", count: 1 }
          ]
        }
      }
    },
    ...overrides
  });
}

/**
 * Each printing plays exactly as printed on its own card (docs/CARD-DATA.md),
 * so reprints may differ. A printing's printed rules text is its entry in
 * data/card-audit/corrections.json (by printing id), else its catalog `text`.
 */
const PRINTED_CORRECTIONS: Record<string, { text: string }> = JSON.parse(
  readFileSync(new URL("../../../../data/card-audit/corrections.json", import.meta.url), "utf8")
);

export function printedRules(card: CardDefinition): string {
  return PRINTED_CORRECTIONS[card.id]?.text ?? card.text;
}

/** True when two printings print the same rules words (case, punctuation and separators ignored). */
export function samePrintedRules(a: CardDefinition, b: CardDefinition): boolean {
  const words = (card: CardDefinition) => printedRules(card).toLowerCase().replace(/[^a-z0-9[\]]+/g, " ").trim();
  return words(a) === words(b);
}

/** Look up a real catalog card by set + name; returns a deep clone (safe to mutate). */
export function cardDef(set: string, name: string): CardDefinition {
  const d = CATALOG.find(c => c.set === set && c.name === name);
  if (!d) throw new Error(`per-card harness: no card '${name}' in set '${set}'`);
  return structuredClone(d);
}

/** Every behaviour-bearing card in a set, catalog order — the driver list for a set file. */
export function setCards(set: string): CardDefinition[] {
  return CATALOG.filter(c => c.set === set);
}

export const STAPLE_ICONS = [
  "rage",
  "greed",
  "deception",
  "elitism",
  "obsession"
] as const;
export type StapleIcon = (typeof STAPLE_ICONS)[number];

let uid = 0;

function resDefFor(icon: StapleIcon): CardDefinition {
  return resourceCard({
    id: `pc-res-${icon}-${uid++}`,
    name: icon[0].toUpperCase() + icon.slice(1),
    trade: "universal",
    resource: { provides: [icon], staple: true }
  });
}

/** `n` face-up staple resources of one icon, in play, for `owner`. */
export function bank(
  icon: StapleIcon,
  n: number,
  owner: PlayerId = P1
): Array<{ key: string; def: CardDefinition; owner: PlayerId; zone: "play" }> {
  return Array.from({ length: n }, () => {
    const k = `bank-${icon}-${owner}-${uid++}`;
    return { key: k, def: resDefFor(icon), owner, zone: "play" as const };
  });
}

/** `n` face-up resources of EACH staple icon, in play, for `owner` (5*n cards). */
export function banks(n: number, owner: PlayerId = P1) {
  return STAPLE_ICONS.flatMap(icon => bank(icon, n, owner));
}

/** `n` face-down resources (each provides Volition) in play for `owner`. */
export function volition(n: number, owner: PlayerId = P1) {
  return Array.from({ length: n }, () => {
    const k = `vol-${owner}-${uid++}`;
    return {
      key: k,
      def: resDefFor("obsession"),
      owner,
      zone: "play" as const,
      faceDown: true
    };
  });
}

/**
 * Assert a pending choice is open for `playerId`, then answer it. `choice`
 * is the `resolvePendingChoice` payload (kept loose — the per-card tests
 * spell out the exact shape at the call site).
 */
export function answer(
  engine: SpoilsEngine,
  playerId: PlayerId,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  choice: any
): void {
  const pc = engine.state.pendingChoice;
  if (!pc) throw new Error(`answer(): expected an open pendingChoice`);
  engine.perform({ type: "resolvePendingChoice", playerId, choice });
  resolvePendingResponses(engine);
}

/** IDs a selector-less "everything in play `owner` controls of `type`" board scan. */
export function inPlay(
  engine: SpoilsEngine,
  owner: PlayerId,
  type?: CardDefinition["type"]
): CardInstanceId[] {
  return Object.values(engine.state.cards)
    .filter(
      c =>
        c.zone === "play" &&
        c.controllerId === owner &&
        (type === undefined || engine.getDefinition(c.id).type === type)
    )
    .map(c => c.id);
}

// --- Shared synthetic cards used across set files ------------------------

/** A character carrying a Unique designation. */
export function uniqueChar(over: Partial<CardDefinition> = {}): CardDefinition {
  return character({ name: "UniqueGuy", unique: "uniqueguy", strength: 2, life: 3, ...over });
}

/** A character with a free "draw 1" activated ability (id `draw1`). */
export function drawerChar(over: Partial<CardDefinition> = {}): CardDefinition {
  return character({
    name: "Drawer",
    strength: 1,
    life: 3,
    behavior: {
      abilities: [
        {
          id: "draw1",
          name: "Study",
          type: "activated",
          costs: [],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    },
    ...over
  });
}

/** A free tactic that moves one chosen character to its owner's hand (id `b`, decl `t`). */
export function bounceTactic(over: Partial<CardDefinition> = {}): CardDefinition {
  return tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    },
    ...over
  });
}

/** A free tactic that destroys one chosen character (id `k`, decl `t`). */
export function killTactic(over: Partial<CardDefinition> = {}): CardDefinition {
  return tactic({
    name: "Kill",
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
    },
    ...over
  });
}

/** Convenience: run an activated ability and drain any follow-up response window. */
export function activate(
  engine: SpoilsEngine,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  opts: {
    selected?: Record<string, CardInstanceId[]>;
    variables?: Record<string, number>;
  } = {}
): void {
  engine.perform({
    type: "activateAbility",
    playerId,
    cardId,
    abilityId,
    selected: opts.selected ?? {},
    variables: opts.variables ?? {}
  });
  resolvePendingResponses(engine);
}

/** Convenience: play a card from hand and drain any follow-up response window. */
export function play(
  engine: SpoilsEngine,
  playerId: PlayerId,
  cardId: CardInstanceId,
  opts: {
    selected?: Record<string, CardInstanceId[]>;
    variables?: Record<string, number>;
    mode?: number;
  } = {}
): void {
  engine.perform({
    type: "playCard",
    playerId,
    cardId,
    selected: opts.selected ?? {},
    variables: opts.variables ?? {},
    ...(opts.mode !== undefined ? { mode: opts.mode } : {})
  } as never);
  resolvePendingResponses(engine);
}
