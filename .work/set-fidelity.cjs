#!/usr/bin/env node
/* set-fidelity.cjs — mark the card-coverage entries whose engine behaviour
 * still carries a concession that materially changes a printed line, and
 * refresh the `notes` on cards the fidelity pass fixed. Everything not
 * listed here stays / becomes `fidelity: "full"`.
 *
 *   node .work/set-fidelity.cjs [--dry]
 *   then: node scripts/build-coverage.cjs
 */
const fs = require("fs");
const path = require("path");
const COV = path.join(__dirname, "..", "data", "card-coverage.json");
const DRY = process.argv.includes("--dry");

// name -> full replacement `notes` for cards still `partial` after the pass.
const PARTIAL = {
  "Gilda, Mother of Gideon":
    "At start of turn: look at the top 2 (fromTop:2 tactic target); you may send a tactic to the void; the rest go back on top in a chosen order (lookAndReorder). CONCESSION: SEDUCTIVE SUMMONS may deploy any tactic in your void, not only ones this card sent there.",
  "Study Disturbance":
    "restrictPlay (no characters this turn) + draw, as the elseEffects of a mayPay(player: picked). CONCESSION: the picked player's pay-2 buyout ('look at your top card, terminate this') is offered on resolution, not as a true pre-stack EXTRA COST.",
  "Tedious TriAdic Truculence":
    "mass-destroy of 3 picked characters with 3 strength or less, as the elseEffects of a mayPay(player: opponent); the buyout branch is lookAndReorder with chooser: opponent. CONCESSION: the pay-3 buyout is offered on resolution, not as a true pre-stack EXTRA COST."
};

// name -> replacement `notes` for cards the fidelity pass brought to `full`.
const FIXED_NOTES = {
  "Intellectual Reliquary":
    "Look at the top 3 (fromTop:3 tactic target); you may take a tactic to hand; the rest go to the bottom in a chosen order (lookAndReorder to:'bottom', count conditional on whether one was taken).",
  "Warmachine Smelder":
    "IN THE FIRE: destroy an item -> search for an item -> hand. LIFE'S WORK: destroy this + an item -> search for an item cost<=7 -> chooserSelectsOption deploy-for-free / put-into-hand.",
  "Ecto-Distillation":
    "EXTRA COST name a card. Take 1 matching copy to hand, rest to discard. An opponent may then pick any number of the remaining copies (chooserSelectsTarget) and those exact picks go to your discard. Deck shuffled after each search.",
  "Eccentric Inquisition":
    "Reveal the top 7 of an opponent's deck; ALL tactics among them go to the void (forced — count = number of matching tactics); the rest to the bottom in the caster's order; grantVoidPlay(persistent, ignoreThreshold) over the voided tactics.",
  "Confessions of Countless Souls":
    "EXTRA COST choose X, void X of your characters, pick X+1 characters -> owners' hands. Look at the top X+1; put any number on the bottom and the rest on top, each pile in a chosen order (lookAndReorder to:'split').",
  "A Death Fit for a King":
    "EXTRA COST: a UNIQUE character in play OR a character in an OPPONENT's discard (targetOwnedBy) -> void. RECUR from discard: pay 3 + remove self, search for a UNIQUE character -> hand.",
  "Surprise!":
    "EXTRA COST pick an attacker on your faction / a location you control; X = its cost. revealFromTopUntil a character with cost <= X: put it into play in the blocking party; shuffle all other revealed cards back.",
  "Cheats McGuillicutty":
    "UNIQUE PLUCK. A grantsReveal continuous makes the top card of your deck public (GameFlowView.revealed). BOTTOM DEAL: top -> bottom. CHEAT: deploy the top card paying its cost. CHANGE COSTUME: pay 3 + shuffle self in, search for a differently-named 'pluck' -> into play.",
  "Odious Diva":
    "A grantsReveal continuous makes each opponent's hand public (GameFlowView.revealed). DISAPPROVE: pay 2, name a card; the opponent bottoms a copy from hand if able and, if so, draws."
};

const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
const changed = [];
for (const e of cov.cards) {
  if (e.status === "wontImplement") continue;
  if (PARTIAL[e.name]) {
    if (e.fidelity !== "partial") changed.push(`partial  ${e.name} (${e.set})`);
    e.fidelity = "partial";
    e.notes = PARTIAL[e.name];
  } else if (FIXED_NOTES[e.name]) {
    if (e.fidelity !== "full") changed.push(`full     ${e.name} (${e.set})`);
    e.fidelity = "full";
    e.notes = FIXED_NOTES[e.name];
    if (e.confidence === "medium" || e.confidence === "low") e.confidence = "high";
  }
}

console.log(`${changed.length} entries changed:`);
for (const c of changed) console.log(`  ${c}`);
const unseen = [...Object.keys(PARTIAL), ...Object.keys(FIXED_NOTES)].filter(
  n => !cov.cards.some(e => e.name === n)
);
if (unseen.length) console.log("WARNING — names not found:", unseen);

if (DRY) console.log("(dry run — nothing written)");
else {
  fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
  console.log("wrote data/card-coverage.json");
}
