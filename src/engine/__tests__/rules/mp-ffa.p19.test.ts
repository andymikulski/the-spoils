// Multiplayer (free-for-all) rules, part 19: two bugs found by the bystander replay (`npm run test:seats`, the checked list
// of differences in data/card-tests/seat-differences.json). Every case runs at three and at four seats.
//  * A deploy offered while a resource is played ("reveal this card as you play a resource") is rehearsed before it
//    changes anything; the rehearsal read "your opponent" without the opponent the answer names, so a play that names
//    its opponent was refused as if nobody had been selected.
//  * A destroy replacement scoped to the cards of "an opponent" (`bySource: { controller: "opponent" }`) judged the
//    cause without the opponent the replacement had selected, so with two or more opponents it never applied.
// Atoms: MPX-select, MPX-lasting.

import { describe } from "node:test";
import assert from "node:assert/strict";
import type { CardDefinition, Effect } from "../../../engine.js";
import { buildGame, character, P1, P2, P3, resolvePendingResponses } from "../support/fixtures.js";
import { bank } from "../per-card/_harness.js";
import { rule } from "./_rule.js";
import { ACTIVATED, plainSeats, seatsFor, TABLES } from "./_mpTable.js";

const answer = (engine: { perform(action: never): void }, playerId: string, choice: Record<string, unknown>) =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);

describe("MPX-select — a reveal-from-hand deploy names its opponent", () => {
  for (const count of TABLES) {
    for (const chosen of seatsFor(count).slice(1)) {
      rule("MPX-select", `${count} seats: the deploy offered while a resource is played is accepted with the opponent ${chosen}, and its pick lands on that opponent's character`, () => {
        const picky: CardDefinition = character({
          name: "Picky",
          cost: 4,
          threshold: "gg" as never,
          revealFromHand: { cost: 1 },
          behavior: { onPlay: { targets: [{ id: "t", selector: { type: "character", controller: "opponent" }, count: 1 }] } } as never
        });
        const player: CardDefinition = character({
          name: "Player",
          behavior: ACTIVATED({ effects: [{ type: "playResource" } as Effect] })
        });
        const { engine, id } = buildGame({
          ...plainSeats(count),
          cards: [
            { key: "pl", def: player, owner: P1, zone: "play" },
            { key: "w", def: picky, owner: P1, zone: "hand" },
            { key: "res", def: character({ name: "Resource" }), owner: P1, zone: "hand" },
            ...bank("greed", 3, P1),
            ...seatsFor(count)
              .slice(1)
              .map(owner => ({ key: `foe-${owner}`, def: character({ name: `Foe ${owner}` }), owner }))
          ]
        });
        engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pl"), abilityId: "go" } as never);
        resolvePendingResponses(engine);
        answer(engine, P1, { kind: "chooserSelectsTarget", selected: [id("res")] });
        assert.equal((engine.state.pendingChoice as { kind: string }).kind, "resourceReveal", "the reveal is offered");
        // A pick missing: refused, and the offer stays open (the rehearsal names the same opponent the deploy does).
        assert.throws(
          () => answer(engine, P1, { kind: "resourceReveal", cardId: id("w"), players: { opponent: chosen } }),
          /pick|select|target/i,
          "the missing pick is what is refused, not the opponent"
        );
        assert.equal((engine.state.pendingChoice as { kind: string }).kind, "resourceReveal", "the same offer is still open");
        answer(engine, P1, { kind: "resourceReveal", cardId: id("w"), selected: { t: [id(`foe-${chosen}`)] }, players: { opponent: chosen } });
        resolvePendingResponses(engine);
        assert.equal(engine.state.cards[id("w")]!.zone, "play", "the revealed card was deployed");
      });
    }
  }
});

describe("MPX-lasting — a destroy replacement scoped to an opponent's cards keeps the opponent it selected", () => {
  const shielder = (): CardDefinition =>
    character({
      name: "Shielder",
      behavior: {
        abilities: [
          {
            id: "shield",
            type: "activated",
            effects: [
              {
                type: "installReplacement",
                replaces: { event: "destroy", cardType: "character", controlledBy: "self", bySource: { controller: "opponent", zone: "any" } },
                duration: { type: "untilEndOfTurn" },
                effects: []
              } as never
            ]
          }
        ]
      }
    });
  const killer = (name: string): CardDefinition =>
    character({
      name,
      behavior: {
        abilities: [
          {
            id: "kill",
            type: "activated",
            targets: [{ id: "t", selector: {}, count: 1 }],
            effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
          }
        ]
      }
    });

  for (const count of TABLES) {
    for (const selected of seatsFor(count).slice(1)) {
      for (const killerSeat of seatsFor(count).slice(1)) {
        const kept = selected === killerSeat;
        rule(
          ["MPX-select", "MPX-lasting"],
          `${count} seats: P1 selects ${selected}; a character of P1 destroyed by ${killerSeat}'s ability is ${kept ? "kept" : "destroyed (not the selected opponent's card)"}`,
          () => {
            const { engine, id } = buildGame({
              ...plainSeats(count),
              cards: [
                { key: "shield", def: shielder(), owner: P1 },
                { key: "mine", def: character({ name: "Mine" }), owner: P1 },
                ...seatsFor(count)
                  .slice(1)
                  .map(owner => ({ key: `kill-${owner}`, def: killer(`Killer ${owner}`), owner }))
              ]
            });
            engine.perform({ type: "activateAbility", playerId: P1, cardId: id("shield"), abilityId: "shield", players: { opponent: selected } } as never);
            resolvePendingResponses(engine);
            // The killer's controller may act on any turn only by responding; make it their turn.
            engine.state.activePlayerId = killerSeat;
            engine.perform({ type: "activateAbility", playerId: killerSeat, cardId: id(`kill-${killerSeat}`), abilityId: "kill", selected: { t: [id("mine")] } } as never);
            resolvePendingResponses(engine);
            assert.equal(engine.state.cards[id("mine")]!.zone, kept ? "play" : "discard");
          }
        );
      }
    }
  }
  void P2;
  void P3;
});
