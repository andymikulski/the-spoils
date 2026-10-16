// CR §201.5d / §405.4: a paragraph of rules text that begins with threshold
// icons is only active while its controller is meeting that threshold. Such a
// paragraph is authored as a continuous ability gated on `meetsThreshold`, never
// as an activated ability (these fixtures gate on a raw `resourceIcons` count,
// which the destroysSource semantics do not care about; the OMNIPOTENCE-aware
// gate is covered in omnipotence-thresholds.test.ts).
// `ContinuousAbility.destroysSource` is the "[icons]: Destroy this card." form
// (RULES.md §4).

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGame,
  character,
  factionCard,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard
} from "./support/fixtures.js";
import type { CardDefinition, Condition } from "../../engine.js";

const rageIcons = (min: number): Condition => ({
  type: "numberCompare",
  left: { type: "resourceIcons", player: "controller", icon: "rage" },
  operator: ">=",
  right: min
});

const rageResource = (): CardDefinition =>
  resourceCard({ id: `tp-rage-${Math.random()}`, name: "Rage", resource: { provides: ["rage"], staple: true } });

/** A develop rule that lets the test put a resource into play, like a real turn. */
const developFaction = (): CardDefinition =>
  factionCard({
    id: "tp-develop-faction",
    name: "TpDevelopFaction",
    faction: {
      startingInfluence: 30,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
      turn: {
        restore: { detachResources: true, restoreNonResources: true },
        develop: { choices: [{ type: "playResource", count: 1 }] }
      }
    }
  });

const developResource = (engine: ReturnType<typeof buildGame>["engine"], cardId: string) => {
  engine.perform({
    type: "chooseDevelop",
    playerId: P1,
    choice: { type: "playResource", cards: [{ cardId, faceDown: false }] }
  } as never);
  resolvePendingResponses(engine);
};

describe("threshold paragraphs: ContinuousAbility.destroysSource", () => {
  const fuse = (extra: CardDefinition["behavior"] = { abilities: [] }) =>
    character({
      name: "Fuse",
      strength: 2,
      life: 3,
      behavior: {
        abilities: [
          { id: "pop", type: "continuous", condition: rageIcons(2), modifiers: [], destroysSource: true },
          ...(extra?.abilities ?? [])
        ]
      }
    });

  test("the card is destroyed the moment its controller meets the threshold", () => {
    const rage = rageResource();
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fuse", def: fuse(), owner: P1, zone: "play" },
        { key: "r1", def: rage, owner: P1, zone: "play" },
        { key: "r2", def: rage, owner: P1, zone: "hand" }
      ]
    });
    assert.equal(engine.state.cards[id("fuse")].zone, "play");
    developResource(engine, id("r2"));
    assert.equal(engine.state.cards[id("fuse")].zone, "discard");
  });

  test("only the controller's icons count", () => {
    const rage = rageResource();
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fuse", def: fuse(), owner: P1, zone: "play" },
        { key: "r1", def: rage, owner: P1, zone: "play" },
        { key: "t1", def: rage, owner: P2, zone: "play" },
        { key: "t2", def: rage, owner: P2, zone: "play" },
        { key: "t3", def: rage, owner: P2, zone: "play" },
        { key: "r2", def: rage, owner: P1, zone: "hand" }
      ]
    });
    // P1 has 1 icon (the opponent's three do not count) and stays under the threshold.
    assert.equal(engine.state.cards[id("fuse")].zone, "play");
    developResource(engine, id("r2"));
    assert.equal(engine.state.cards[id("fuse")].zone, "discard");
  });

  test("a card that enters play already meeting the threshold is destroyed on entering", () => {
    const rage = rageResource();
    const { engine, id } = buildGame({
      cards: [
        { key: "fuse", def: { ...fuse(), cost: 0 }, owner: P1, zone: "hand" },
        { key: "r1", def: rage, owner: P1, zone: "play" },
        { key: "r2", def: rage, owner: P1, zone: "play" }
      ]
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("fuse"), selected: {} } as never);
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("fuse")].zone, "discard");
  });

  test("an unmet threshold never destroys it", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "fuse", def: fuse(), owner: P1, zone: "play" },
        { key: "r1", def: rageResource(), owner: P1, zone: "play" }
      ]
    });
    assert.equal(engine.state.cards[id("fuse")].zone, "play");
  });

  test("a replacement that keeps the card in play does not hang the state-based check", () => {
    const rage = rageResource();
    const warded = fuse({
      abilities: [{ id: "ward", type: "replacement", replaces: { event: "destroy" }, effects: [] }]
    });
    const { engine, id } = buildGame({
      playerA: { faction: developFaction() },
      cards: [
        { key: "fuse", def: warded, owner: P1, zone: "play" },
        { key: "r1", def: rage, owner: P1, zone: "play" },
        { key: "r2", def: rage, owner: P1, zone: "hand" }
      ]
    });
    developResource(engine, id("r2"));
    assert.equal(engine.state.cards[id("fuse")].zone, "play");
  });
});
