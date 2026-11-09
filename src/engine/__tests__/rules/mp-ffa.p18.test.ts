// Multiplayer (free-for-all) rules, part 18: a duplicate of a tactic that says "your opponent" (Ectypal Stave, Voidal
// Replication) has all the original's rules text, so its opponent is selected anew by the duplicator, like its other
// play-time picks, and is not the opponent the original selected. Found by the bystander replay
// (`npm run test:seats`): the copy read an opponent nobody had selected. Every case runs at three and at four seats.
// Atoms: CR 307.1, MPX-select.

import { describe } from "node:test";
import assert from "node:assert/strict";
import { P1, resolvePendingResponses, tactic } from "../support/fixtures.js";
import { rule } from "./_rule.js";
import { ACTIVATED, answerPlayer, baseline, board, DRAIN_THEIRS, lost, pending, play, seatsFor, TABLES } from "./_mpTable.js";

/** "Duplicate the last tactic deployed this turn." */
const replicate = () =>
  tactic({
    name: "Replicate",
    cost: 0,
    behavior: ACTIVATED({ effects: [{ type: "duplicate", target: { type: "lastDeployedTactic" } }] })
  });

describe('CR 307.1 / MPX-select — a duplicate selects "your opponent" anew', () => {
  for (const count of TABLES) {
    const seats = seatsFor(count);
    for (const first of seats.slice(1)) {
      for (const second of seats.slice(1)) {
        rule(
          ["CR 307.1", "MPX-select"],
          `${count} seats: the original drains ${first}; the duplicator is asked who the copy drains and chooses ${second}`,
          () => {
            const t = board(count, tactic({ name: "Drain", cost: 0, behavior: DRAIN_THEIRS }), [
              { key: "rep", def: replicate(), owner: P1, zone: "hand" }
            ]);
            const before = baseline(t);
            t.engine.perform(play(t, { players: { opponent: first } }));
            resolvePendingResponses(t.engine);
            assert.equal(lost(t, before, first), 3, "the original drains the opponent it selected");

            t.engine.perform({ type: "playCard", playerId: P1, cardId: t.id("rep") });
            resolvePendingResponses(t.engine);
            const asked = pending(t);
            assert.equal(asked?.kind, "choosePlayer", "the copy asks for its own opponent");
            assert.equal((asked as unknown as { playerId: string }).playerId, P1, "the duplicator selects");
            assert.deepEqual([...(asked as unknown as { candidates: string[] }).candidates].sort(), seats.slice(1), "every opponent is a choice");
            answerPlayer(t, P1, second);
            resolvePendingResponses(t.engine);

            assert.equal(pending(t), undefined);
            const expected = first === second ? 6 : 3;
            assert.equal(lost(t, before, second), expected, `${second} loses what the copy and the original together took`);
            for (const seat of seats.slice(1)) {
              if (seat !== first && seat !== second) assert.equal(lost(t, before, seat), 0, `${seat} is untouched`);
            }
            assert.equal(lost(t, before, P1), 0);
          }
        );
      }
    }
  }
});

