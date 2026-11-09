// Multiplayer clause tests for the 2nd Edition set (3 and 4 seats), part 1: the clauses whose data changed for free-for-all
// play. Expectations come from each card's PRINTED text, the multiplayer atoms (data/rule-tests/source/multiplayer.txt)
// and data/card-tests/mp-spec/2nd-edition.json.

import assert from "node:assert/strict";
import { bank, character, tactic } from "../../per-card/_harness.js";
import { mpClause, printing } from "../_clause.js";
import { COUNTS, handCards, others, pinger, respondToAbility, silencedFlow, type Silenced } from "./_seats2ndEdition.js";
import { P1, resolvePendingResponses, seatsOf, P2, P3 } from "./_seatsSeed2ndFirstP2.js";

// =================================================================================
// "Your opponent cannot respond to this card." (noResponse: "opponent")
//   Voidal Replication, Subsection 5, Paragraph 12, Exploding Sock Puppet!, Tactician Vacation, Degenerate Molestation
// The block's opponent is chosen with the play, before targets; that one player is never offered a response, every other
// player (never the controller, CR 607.1) is, clockwise from the controller's left.
// =================================================================================

const TVAC = "4181e922-7ffb-4c71-aef6-17adf4f006c7";
const VOIDAL = "63369e53-e89b-4b7d-beb0-7110cb1290ce";
const SUBSECTION = "23fe59c9-9bf1-49d1-bfc4-084c556aca80";
const PUPPET = "300ab3d1-3214-4fa5-9000-d657e6e7816d";
const MOLEST = "12cfc4e1-e8f7-431e-a37a-593210181b0c";

const TVAC_SPEC: Silenced = { cards: () => [{ key: "card", def: printing(TVAC), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)] };
const VOIDAL_SPEC: Silenced = {
  cards: () => [
    { key: "card", def: printing(VOIDAL), owner: P1, zone: "hand" },
    { key: "first", def: tactic({ name: "First tactic" }), owner: P1, zone: "hand" },
    ...bank("obsession", 5, P1)
  ],
  prepare: (t) => {
    t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("first") } as never);
    resolvePendingResponses(t.engine);
  }
};
const SUBSECTION_SPEC: Silenced = {
  cards: () => [{ key: "card", def: printing(SUBSECTION), owner: P1, zone: "hand" }, pinger(), ...bank("greed", 4, P1)],
  active: P2,
  prepare: respondToAbility
};
const PUPPET_SPEC: Silenced = {
  cards: () => [{ key: "card", def: printing(PUPPET), owner: P1, zone: "hand" }, pinger(), ...bank("elitism", 4, P1)],
  active: P2,
  prepare: respondToAbility
};
const MOLEST_SPEC: Silenced = {
  cards: (count) => [
    { key: "card", def: printing(MOLEST), owner: P1, zone: "hand" },
    ...seatsOf(count).slice(1).flatMap((seat) => handCards(seat, [character({ name: `Hand of ${seat}` })])),
    ...bank("obsession", 10, P1)
  ]
};

for (const count of COUNTS) {
  const text = `${count} seats: your opponent cannot respond; the chosen opponent is skipped and the others are offered the card`;
  mpClause(MOLEST, "0:rule", count, text, () => silencedFlow(MOLEST_SPEC, count));
  // The opponent is only asked for (and bound) when the play block names "opponent"; for these cards only `noResponse` does.
  mpClause(TVAC, "0:rule", count, text, () => silencedFlow(TVAC_SPEC, count));
  mpClause(VOIDAL, "0:rule", count, text, () => silencedFlow(VOIDAL_SPEC, count));
  mpClause(SUBSECTION, "0:rule", count, text, () => silencedFlow(SUBSECTION_SPEC, count));
  mpClause(PUPPET, "0:rule", count, text, () => silencedFlow(PUPPET_SPEC, count));
}

