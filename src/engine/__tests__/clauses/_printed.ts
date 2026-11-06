// Shared "printed cost / threshold / type / stats" checks for clause tests (T3c3, session 4).
// The caller passes the printed numbers as LITERALS; nothing is read from the card data.
// Call them inside your own `clause(...)` so coverage stays visible in the batch file.

import assert from "node:assert/strict";
import type { CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { bank, buildGame, developFaction, P1, play } from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { playRaw } from "./_battle.js";
import { printing, refused } from "./_clause.js";

const ICON_OF: Record<string, StapleIcon> = { r: "rage", g: "greed", d: "deception", e: "elitism", o: "obsession" };

export interface PrintedCostSpec {
  /** Printing id. */
  id: string;
  /** The printed numeric cost (literal). */
  cost: number;
  /** The printed threshold, e.g. "oo" (literal; one icon kind). */
  threshold: string;
  /** Supporting cards (targets, hosts, a deck to search, ...). */
  extra?: CardPlacement[];
  /** The picks the play needs, from the board's key lookup. */
  selected?: (id: (key: string) => CardInstanceId) => Record<string, CardInstanceId[]>;
  variables?: Record<string, number>;
  /** The answer to a "name a card / icon" cost prompt the play raises (E3a: naming is part of the cost). */
  name?: string;
  game?: { turn?: number };
}

/**
 * Deploys with exactly the printed cost and threshold (works, pays exactly the cost), is refused one
 * resource short (the missing resource is the only difference: spent icons keep the threshold met),
 * and is refused one threshold icon short (enough resources, a missing icon).
 */
export function printedCost(spec: PrintedCostSpec): void {
  const icon = ICON_OF[spec.threshold[0]!]!;
  const icons = spec.threshold.length;
  const wrong: StapleIcon = icon === "greed" ? "rage" : "greed";
  const board = (ready: number, rightTotal: number) => {
    const right = Math.min(rightTotal, ready);
    return buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      random: () => 0.5,
      ...(spec.game ?? {}),
      cards: [
        { key: "subject", def: printing(spec.id), owner: P1, zone: "hand" },
        ...(spec.extra ?? []),
        ...bank(icon, right, P1),
        ...bank(wrong, ready - right, P1),
        // icons already spent (attached to the faction) still count toward the threshold but cannot pay
        ...bank(icon, rightTotal - right, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
      ]
    });
  };
  const pick = (g: { id: (key: string) => CardInstanceId }) => ({ selected: spec.selected?.(g.id) ?? {}, variables: spec.variables ?? {} });
  const ready = (engine: SpoilsEngine) => engine.getAvailableResourceCount(P1);

  // exactly enough: works and pays exactly the printed cost
  const exact = board(spec.cost, icons);
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("subject"), pick(exact));
  if (spec.name !== undefined && exact.engine.state.pendingChoice?.kind === "nameValue") {
    exact.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "nameValue", value: spec.name } } as never);
  }
  assert.notEqual(exact.engine.state.cards[exact.id("subject")].zone, "hand", `deploys with exactly ${spec.cost} resources and ${icons} icon(s)`);
  assert.equal(before - ready(exact.engine), spec.cost, `the printed cost of ${spec.cost} is paid, no more and no less`);

  // one resource short of the cost (threshold still met)
  if (spec.cost > 0) {
    const short = board(spec.cost - 1, icons);
    refused(() => playRaw(short.engine, P1, short.id("subject"), pick(short)), `one resource short of ${spec.cost} (threshold still met)`, /resource|afford|cost|pay|enough/i);
    assert.equal(short.engine.state.cards[short.id("subject")].zone, "hand", "stays in hand when it cannot be paid for");
  }

  // one threshold icon short (cost still affordable)
  if (icons > 0) {
    const iconless = board(spec.cost, icons - 1);
    refused(() => playRaw(iconless.engine, P1, iconless.id("subject"), pick(iconless)), `one threshold icon short of ${icons}`, /threshold|icon/i);
    assert.equal(iconless.engine.state.cards[iconless.id("subject")].zone, "hand", "stays in hand when the threshold is not met");
  }
}

export interface PrintedStatsSpec {
  id: string;
  type: "character" | "item" | "location" | "tactic";
  subtype: string[];
  strength?: number;
  speed?: number;
  life?: number;
  structure?: number;
  /** Supporting cards, e.g. hand cards that switch a conditional bonus off. */
  extra?: CardPlacement[];
}

/** The printed type, subtype and (for characters / locations) stats, read from a card in play. */
export function printedStats(spec: PrintedStatsSpec): void {
  const inPlay = spec.type === "character" || spec.type === "location";
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    cards: [{ key: "subject", def: printing(spec.id), owner: P1, zone: inPlay ? "play" : "hand" }, ...(spec.extra ?? [])]
  });
  const subject = g.id("subject");
  const def = g.engine.getDefinition(subject);
  assert.equal(def.type, spec.type, `the printed card type is ${spec.type}`);
  assert.deepEqual([...def.subtype].sort(), [...spec.subtype].sort(), `the printed subtype is ${spec.subtype.join(", ") || "none"}`);
  if (spec.strength !== undefined) assert.equal(g.engine.getStat(subject, "strength"), spec.strength, `printed strength ${spec.strength}`);
  if (spec.speed !== undefined) assert.equal(g.engine.getStat(subject, "speed"), spec.speed, `printed speed ${spec.speed}`);
  if (spec.life !== undefined) assert.equal(g.engine.getStat(subject, "life"), spec.life, `printed life ${spec.life}`);
  if (spec.structure !== undefined) assert.equal(g.engine.getStat(subject, "structure"), spec.structure, `printed structure ${spec.structure}`);
}
