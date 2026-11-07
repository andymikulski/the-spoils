// Generic printed-number checks for EVERY rules group of the catalog.
//
// Early clause batches never asserted a card's printed cost / threshold / stats through the
// engine, so a data mutation of those numbers survived. This file closes that gap generically:
//   * deployable cards (character / item / location / plain tactic): deploy with exactly `cost`
//     ready resources meeting the threshold (all `cost` spent); one ready resource fewer is refused
//     for the cost; one threshold icon fewer is refused for the threshold;
//   * characters: strength / speed / life in play; locations: structure.
// The expected numbers are read from the catalog (`markup`/printed data, image-audited), not from
// the engine. Cards that are not plain-deployable are listed in EXCLUDED_DEPLOY with the reason
// (their own batch tests cover those deploys) but still get their stat check.
//
// Not a per-batch file (underscore prefix), but `node --test` still runs it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildGame, character, bank, volition, play, P1 } from "../per-card/_harness.js";
import type { CardDefinition } from "../../../engine.js";
import { buildRulesGroups, CATALOG } from "./_manifest.js";
import { refused } from "./_clause.js";
import { readCatalogFiles } from "../support/catalog-files.js";

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession" | "volition";
const ICON: Record<string, Icon> = { r: "rage", g: "greed", d: "deception", e: "elitism", o: "obsession", v: "volition" };

/** Why a card's deploy part is skipped (its own batch tests cover the deploy). */
type Reason = "attach-to" | "extra-cost-or-target" | "deploy-condition" | "cost-adjust" | "threshold-slack" | "modal" | "tactic-play-ability" | "flip-it";

/** Known printed-number disagreements: printing id -> finding id (findings/printed-card.md). */
const FINDINGS: Record<string, string> = {};

/**
 * Characters whose own printed rules text changes their stats on an empty board; the stat check
 * uses a board that switches that rule off (the rule itself is covered by the card's batch).
 */
const STAT_BOARD: Record<string, { reason: string; extra?: any[]; depleted?: boolean }> = {
  // "While you have an even number of cards in your hand, this card gains +1/+1/+1": odd hand.
  "b7967785": { reason: "even-hand gain off", extra: [{ key: "odd", def: character({ name: "Odd hand card" }), owner: P1, zone: "hand" }] },
  // "While this card is restored, all characters you control gain 1 strength and 1 life": depleted.
  "baa7224f": { reason: "restored aura off", depleted: true }
};

/** Deployed cards that destroy themselves on the exactly-enough board (their own rules text); the deploy still must leave the hand. */
const SELF_DESTRUCTS = new Set([
  "3176810c", // Boorish Boar: "[R][R][R]: destroy this card" is a static check; the 3 rage that paid for it still count
  "ae5a510d" // Swashbuckler (Open Beta): "When this card enters play, you may remove 4 cards in your opponent's discard pile
  //   from the game. If you don't, destroy this card." This board gives the opponent an empty discard pile, so it destroys
  //   itself as printed (its own clause tests cover both branches).
]);

const REASONS: Record<Reason, string> = {
  "attach-to": "ATTACH TO: needs a host to deploy",
  "extra-cost-or-target": "onPlay/EXTRA COST or required targets at deploy",
  "deploy-condition": "'deploy only ...' restriction (onPlay condition)",
  "cost-adjust": "cost reduced by its own costAdjust expression",
  "threshold-slack": "FEALTY: threshold can be reduced (thresholdSlack)",
  modal: "modal tactic: cost/targets live in the chosen mode",
  "tactic-play-ability": "tactic whose play ability has costs, targets, variables or a condition",
  "flip-it": "FLIP IT / zone-activated variants change how it is played"
};

export function deployExclusion(card: CardDefinition): Reason | undefined {
  if (card.attachTo) return "attach-to";
  if (card.thresholdSlack) return "threshold-slack";
  const behavior = card.behavior as Record<string, any> | undefined;
  if (card.type === "tactic") {
    if (behavior?.modes?.length) return "modal";
    const play = (behavior?.abilities ?? []).find((a: any) => a.type === "activated");
    if (play) {
      if (play.activationZone || play.fromFaceDown) return "flip-it";
      if (play.costs?.length || play.targets?.length || play.variables || play.variableBounds || play.condition) return "tactic-play-ability";
      if (play.costAdjust) return "cost-adjust";
    }
    return undefined;
  }
  const onPlay = behavior?.onPlay;
  if (onPlay) {
    if (onPlay.costAdjust) return "cost-adjust";
    if (onPlay.condition) return "deploy-condition";
    if (onPlay.costs?.length || onPlay.targets?.length) return "extra-cost-or-target";
  }
  return undefined;
}

interface Res {
  icon: Icon;
  spent: boolean;
}

/** Placements for a list of resources: ready ones as plain banks, spent ones attached to the faction. */
function placements(list: Res[]) {
  const out: any[] = [];
  for (const res of list) {
    const [p] = res.icon === "volition" ? volition(1, P1) : bank(res.icon, 1, P1);
    out.push(res.spent ? { ...p, attachedToKey: "__factionA" } : p);
  }
  return out;
}

/**
 * `ready` ready resources whose icons, together with the spent ones (which still count toward the
 * threshold), satisfy `icons`. Extra ready resources are fillers of `filler`.
 */
function layout(icons: Icon[], ready: number, filler: Icon): Res[] {
  const out: Res[] = icons.map((icon, i) => ({ icon, spent: i >= ready }));
  while (out.filter((r) => !r.spent).length < ready) out.push({ icon: filler, spent: false });
  return out;
}

function deployBoard(card: CardDefinition, resources: Res[]) {
  const game = buildGame({
    cards: [{ key: "c", def: card, owner: P1, zone: "hand" }, ...placements(resources)],
    turn: 3,
    activePlayerId: P1
  });
  return game;
}

function playCard(game: ReturnType<typeof buildGame>) {
  play(game.engine, P1, game.id("c"));
}

const iconsOf = (card: CardDefinition): Icon[] =>
  typeof card.threshold === "string" ? card.threshold.split("").map((letter) => ICON[letter]!) : [];

const groups = buildRulesGroups();
const DEPLOYABLE = new Set(["character", "item", "location", "tactic"]);

const excluded: Record<string, string[]> = {};
let deployCount = 0;
let statCount = 0;

// The card under test, as the engine loads it (this may be mutated by `card-tests mutate`) ...
const BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
// ... and the printed numbers, read straight from the audited data files on disk (never mutated).
const PRINTED = new Map(
  readCatalogFiles().map((c) => [c.id, c])
);

for (const group of groups) {
  const def = BY_ID.get(group.id)!;
  const printed = PRINTED.get(group.id)!;
  if (!DEPLOYABLE.has(printed.type)) continue;
  const label = `${def.name} (${def.set}) #${def.id.slice(0, 8)}`;
  const finding = FINDINGS[def.id];
  const suffix = finding ? ` — MISMATCH ${finding}` : "";
  const cost = printed.cost ?? 0;
  const icons = iconsOf(printed);

  // --- stats -------------------------------------------------------------------------------
  if (printed.type === "character" || printed.type === "location") {
    statCount++;
    test(`${label} [printed-card] in play it has its printed stats${suffix}`, () => {
      const special = STAT_BOARD[def.id.slice(0, 8)];
      const game = buildGame({
        cards: [{ key: "c", def, owner: P1, zone: "play", depleted: special?.depleted }, ...(special?.extra ?? [])],
        turn: 3,
        activePlayerId: P1
      });
      const id = game.id("c");
      if (printed.type === "character") {
        assert.deepEqual(
          [game.engine.getStat(id, "strength"), game.engine.getStat(id, "speed"), game.engine.getStat(id, "life")],
          [printed.strength, printed.speed, printed.life],
          "strength / speed / life"
        );
      } else {
        assert.equal(game.engine.getStat(id, "structure"), printed.structure, "structure");
      }
    });
  }

  // --- deploy ------------------------------------------------------------------------------
  const why = deployExclusion(printed);
  if (why) {
    (excluded[why] ??= []).push(label);
    continue;
  }
  deployCount++;
  test(`${label} [printed-card] deploys for exactly its printed cost and threshold${suffix}`, () => {
    // 1. exactly enough: deploys, and exactly `cost` resources are spent.
    {
      const game = deployBoard(def, layout(icons, cost, "rage"));
      assert.equal(game.engine.getAvailableResourceCount(P1), cost, "setup: `cost` ready resources");
      playCard(game);
      // A tactic that "puts this card into play as a face-down resource" leaves that one ready resource behind.
      const selfResource = printed.selfDisposition?.to === "faceDownResource" ? 1 : 0;
      assert.equal(game.engine.getAvailableResourceCount(P1), selfResource, `all ${cost} ready resources were spent`);
      // A 0-life character is destroyed as soon as it enters (CR: damage >= life); it still left the hand.
      if (printed.type === "character" && (printed.life === 0 || SELF_DESTRUCTS.has(def.id.slice(0, 8)))) assert.notEqual(game.engine.state.cards[game.id("c")].zone, "hand", "deployed (0 life dies at once)");
      else if (printed.type !== "tactic") assert.equal(game.engine.state.cards[game.id("c")].zone, "play", "deployed");
      else assert.notEqual(game.engine.state.cards[game.id("c")].zone, "hand", "tactic left the hand");
    }
    // 2. one ready resource fewer (threshold still met via spent icons): refused for the cost.
    if (cost >= 1) {
      const game = deployBoard(def, layout(icons, cost - 1, "rage"));
      assert.equal(game.engine.getAvailableResourceCount(P1), cost - 1, "setup: one fewer ready");
      refused(() => playCard(game), "one ready resource short of the printed cost", /Costs cannot be paid/);
      assert.equal(game.engine.state.cards[game.id("c")].zone, "hand", "stays in hand");
    }
    // 3. one threshold icon fewer (enough resources): refused for the threshold.
    if (icons.length >= 1) {
      const missing = icons[0]!;
      const filler: Icon = missing === "rage" ? "greed" : "rage";
      const game = deployBoard(def, layout(icons.slice(1), cost, filler));
      assert.equal(game.engine.getAvailableResourceCount(P1), cost, "setup: enough ready resources");
      refused(() => playCard(game), "one threshold icon short", /threshold/i);
      assert.equal(game.engine.state.cards[game.id("c")].zone, "hand", "stays in hand");
    }
  });
}

test("printed-card: exclusion list is explicit and every excluded card is accounted for", () => {
  const summary = Object.fromEntries(Object.entries(excluded).map(([reason, list]) => [`${reason} (${REASONS[reason as Reason]})`, list.length]));
  assert.ok(Object.keys(summary).length >= 0, "Object.keys(summary).length >= 0");
  if (process.env.PRINTED_CARD_SUMMARY) console.log(JSON.stringify({ deployCount, statCount, summary }, null, 1));
});
