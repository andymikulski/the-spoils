import { buildGame, cardDef, developFaction, P1, P2, character, resolvePendingResponses } from "../src/engine/__tests__/per-card/_harness.ts";
const def = (n) => cardDef("Seed", n);
console.log("CP behavior:", JSON.stringify(def("Courageous Paladin").behavior));
const { engine, id } = buildGame({
  playerA: { faction: developFaction() },
  cards: [
    { key: "cp", def: def("Courageous Paladin"), owner: P1, zone: "play" },
    { key: "ally", def: character({ name: "Ally", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" },
    { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" },
  ],
  turn: 2, activePlayerId: P2,
});
engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("atk")], target: { type: "faction", playerId: P1 } });
resolvePendingResponses(engine);
engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [id("cp"), id("ally")] });
resolvePendingResponses(engine);
const view = engine.getBattleView();
console.log("phase:", engine.state.battle && engine.state.battle.phase);
console.log("damageSources:", JSON.stringify(view && view.damageSources && view.damageSources.map(s=>({card:s.cardId===id("atk")?"atk":s.cardId, str:s.strength, legal:s.legalTargets.map(t=>t===id("cp")?"cp":t===id("ally")?"ally":t)}))));
