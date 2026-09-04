import { buildGame, cardDef, developFaction, bank, P1, P2, character, play, resolvePendingResponses } from "../src/engine/__tests__/per-card/_harness.ts";
const def = (n) => cardDef("Seed", n);
console.log("TW:", JSON.stringify(def("Thabbashite Wizard").behavior));
const { engine, id } = buildGame({
  playerA: { faction: developFaction() }, playerB: { faction: developFaction() },
  cards: [
    { key: "tw", def: def("Thabbashite Wizard"), owner: P1, zone: "hand" },
    ...Array.from({ length: 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: P1, zone: "deck" })),
    ...bank("obsession", 4, P1),
  ],
});
try {
  engine.perform({ type: "playCard", playerId: P1, cardId: id("tw"), selected: {} });
  resolvePendingResponses(engine);
  console.log("pc:", JSON.stringify(engine.state.pendingChoice));
  let n=0;
  while(engine.state.pendingChoice && n++<10){
    const pc = engine.state.pendingChoice;
    console.log("  pc", pc.kind, "player", pc.playerId, "min/max", pc.min, pc.max);
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooseNumber", value: 0 } });
    resolvePendingResponses(engine);
  }
  console.log("done. tw zone:", engine.state.cards[id("tw")].zone);
} catch(e){ console.log("ERR:", e.message, "\n", e.stack.split("\n").slice(0,6).join("\n")); }
