// Smoke test for Ungodly Mess: drives the AUTHORED behavior in
// data/cards/ end-to-end through the public engine API (not synthetic
// fixtures) to prove the JSON the coverage effort wrote actually works.
// One scenario per representative shape / capability.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import cardsJson from "../../data/cards.js";
import {
  buildGame,
  factionCard,
  resourceCard,
  P1,
  P2,
  resolvePendingResponses
} from "./support/fixtures.js";
import type { CardDefinition } from "../../engine.js";

const CATALOG = cardsJson as CardDefinition[];
const def = (name: string): CardDefinition => {
  const d = CATALOG.find(c => c.set === "Ungodly Mess" && c.name === name);
  assert.ok(d, `Ungodly Mess card '${name}' not found`);
  return structuredClone(d);
};
let uid = 0;
const res = (icon: string, trade: string): CardDefinition =>
  resourceCard({
    name: icon[0].toUpperCase() + icon.slice(1),
    id: `um-smoke-${icon}-${uid++}`,
    trade: trade as CardDefinition["trade"],
    resource: { provides: [icon as "rage"], staple: true }
  });
const rage = () => res("rage", "warlord");
const greed = () => res("greed", "banker");
const elitism = () => res("elitism", "gearsmith");
const deception = () => res("deception", "rogue");
const obsession = () => res("obsession", "arcanist");

const drainToStack = (engine: any) => {
  let guard = 0;
  while ((engine.state.responseStack.length > 0 || engine.state.responseWindow) && !engine.state.pendingChoice) {
    if (++guard > 200) throw new Error("drain loop");
    if (engine.state.responseWindow) resolvePendingResponses(engine);
    else engine.perform({ type: "advanceFlow" });
  }
};

describe("Ungodly Mess smoke: authored behavior drives the engine", () => {
  test("FEALTY (Eustace) — threshold slack lets a hand card deploy while 3 icons short", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "eus", def: def("Eustace, Sensible Glutton"), owner: P1, zone: "hand" },
        { key: "g", def: greed(), owner: P1, zone: "play" },
        { key: "r", def: rage(), owner: P1, zone: "play" },
        { key: "e", def: elitism(), owner: P1, zone: "play" },
        { key: "d", def: deception(), owner: P1, zone: "play" }
      ]
    });
    // 4 staples of 4 different trades, but only 1 Greed vs "gggg" -> 3 short.
    assert.equal(engine.getCardPlayability(P1, id("eus")).thresholdMet, true);
  });

  test("distinctCount (Elite Acrolos Engineer) — +1/+1 per distinct staple name", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "eng", def: def("Elite Acrolos Engineer"), owner: P1, zone: "play" },
        { key: "g1", def: greed(), owner: P1, zone: "play" },
        { key: "g2", def: greed(), owner: P1, zone: "play" },
        { key: "r1", def: rage(), owner: P1, zone: "play" }
      ]
    });
    // 2 distinct names (Greed, Rage) -> base 1 + 2.
    assert.equal(engine.getStat(id("eng"), "strength"), 3);
    assert.equal(engine.getStat(id("eng"), "life"), 3);
  });

  test("Gosche's Retained Earnings Vault — token-bearer leaving play gives +2 influence", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "vault", def: def("Gosche's Retained Earnings Vault"), owner: P1, zone: "play" },
        { key: "ch", def: def("Micromajig"), owner: P1, zone: "play", counters: { token: 1 } }
      ],
      activePlayerId: P1
    });
    const before = engine.state.players[P1].influence;
    (engine as any).destroyCard(id("ch"));
    resolvePendingResponses(engine);
    assert.equal(engine.state.players[P1].influence, before + 2);
  });

  test("God's Blessing of Transfiguration — attached char's team gets +1 str / -1 life", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "host", def: def("Unfortunate Fortune Hunter"), owner: P1, zone: "play" },
        { key: "ally", def: def("Unfortunate Fortune Hunter"), owner: P1, zone: "play" },
        { key: "bless", def: def("God's Blessing of Transfiguration"), owner: P1, zone: "hand" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, def: deception(), owner: P1, zone: "play" as const }))
      ]
    });
    const baseStr = engine.getStat(id("ally"), "strength");
    const baseLife = engine.getStat(id("ally"), "life");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bless"), selected: { attachTo: [id("host")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.getStat(id("ally"), "strength"), baseStr + 1);
    assert.equal(engine.getStat(id("ally"), "life"), baseLife - 1);
  });

  test("Silencer — a token-bearing character cannot be declared as a blocker", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "sil", def: def("Silencer"), owner: P1, zone: "play" },
        { key: "clean", def: def("Micromajig"), owner: P2, zone: "play" },
        { key: "toked", def: def("Micromajig"), owner: P2, zone: "play", counters: { token: 1 } }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("sil")], target: { type: "faction", playerId: P2 } });
    resolvePendingResponses(engine);
    assert.throws(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("toked")] }));
    engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("clean")] });
  });

  test("Limited Liability — all inflicted damage is reduced to 0 this turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "ll", def: def("Limited Liability"), owner: P1, zone: "hand" },
        { key: "gun", def: def("Efficacious Gunslinger"), owner: P1, zone: "play" },
        { key: "victim", def: def("Micromajig"), owner: P2, zone: "play" },
        { key: "g1", def: greed(), owner: P1, zone: "play" },
        { key: "g2", def: greed(), owner: P1, zone: "play" }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("ll") });
    drainToStack(engine);
    (engine as any).emit({ type: "damageDealt", sourceId: id("gun"), targetId: id("victim"), amount: 5 });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("victim")].damage, 0);
  });

  test("Geldale, City-Fortress — opponent cannot play a tactic during your turn", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "gel", def: def("Geldale, City-Fortress"), owner: P1, zone: "play" },
        { key: "bait", def: def("Micromajig"), owner: P1, zone: "hand" },
        { key: "trick", def: def("Quotidian Assassination"), owner: P2, zone: "hand" },
        { key: "o1", def: obsession(), owner: P2, zone: "play" }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("bait") });
    assert.throws(() => engine.perform({ type: "playCard", playerId: P2, cardId: id("trick") }));
  });

  test("Quotidian Assassination — returns a character to its owner's hand", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "qa", def: def("Quotidian Assassination"), owner: P1, zone: "hand" },
        { key: "tgt", def: def("Micromajig"), owner: P2, zone: "play" },
        { key: "o1", def: obsession(), owner: P1, zone: "play" },
        { key: "o2", def: obsession(), owner: P1, zone: "play" }
      ],
      activePlayerId: P1
    });
    engine.perform({ type: "playCard", playerId: P1, cardId: id("qa"), selected: { c: [id("tgt")] } });
    drainToStack(engine);
    assert.equal(engine.state.cards[id("tgt")].zone, "hand");
  });

  test("Thabbashite Penumbra — pays 6 minus the opponent's distinct staple count", () => {
    const { engine, id } = buildGame({
      cards: [
        { key: "pen", def: def("Thabbashite Penumbra"), owner: P1, zone: "play" },
        ...Array.from({ length: 6 }, (_, i) => ({ key: `o${i}`, def: obsession(), owner: P1, zone: "play" as const })),
        { key: "og", def: greed(), owner: P2, zone: "play" },
        { key: "or", def: rage(), owner: P2, zone: "play" }
      ],
      activePlayerId: P1
    });
    // opponent controls 2 distinct staples -> pay 6-2 = 4; P1 has 6 obsession.
    const before = engine.getStat(id("pen"), "life");
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pen"), abilityId: "veil" });
    drainToStack(engine);
    assert.equal(engine.getStat(id("pen"), "life"), before + 1);
    assert.ok(engine.getKeywords(id("pen")).includes("covert"), "engine.getKeywords(id(\"pen\")).includes(\"covert\")");
    // 4 of the 6 obsession resources are now attached (spent).
    assert.equal(engine.getAvailableResourceCount(P1), 2);
  });

  test("Soulsearcher — an icon-led paragraph is a static condition, not an ability", () => {
    const soulsearcher = def("Soulsearcher");
    const { engine, id } = buildGame({
      cards: [
        { key: "ss", def: soulsearcher, owner: P1, zone: "play" },
        { key: "r", def: rage(), owner: P1, zone: "play" }
      ],
      activePlayerId: P1
    });
    // "[R]: This card gains 2 strength." holds while the controller has an [R] icon...
    assert.equal(engine.getStat(id("ss"), "strength"), (soulsearcher.strength ?? 0) + 2);
    // ...and there is nothing to activate, so it cannot be repeated.
    assert.throws(() =>
      engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ss"), abilityId: "r" })
    );
    assert.equal(engine.getStat(id("ss"), "strength"), (soulsearcher.strength ?? 0) + 2);
  });
});
