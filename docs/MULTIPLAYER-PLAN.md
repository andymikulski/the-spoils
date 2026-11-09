# Multiplayer (free-for-all) plan

Goal: the engine runs a free-for-all game for any number of players (2 or more).
Every player plays against every other player. A player whose faction reaches 0
influence loses, and the last player left wins. Every rule and every printed
card behaves exactly as written at every table size, and two-player behavior
stays exactly as it is now.

Out of scope for now: Showdown (Villain/Hero, Allegiance, Hero deck,
Temptation Pile) and epic deck rules. Both are in `docs/rules/`, but nothing
below depends on them.

## Ground rules

1. **The spec comes before the engine.** Expected behavior comes from the
   printed card text, the CR v2.5 / FAQ v2.0, `docs/rules/multiplayer-guidelines.md`
   (atoms MP 1–5) and user rulings recorded in `data/rule-tests/rulings.md`.
   Nothing else counts. If the sources are silent, the question goes to
   `QUESTIONS.md` and nothing is assumed until the user rules on it.
2. **Two-player behavior is frozen.** No existing test file is modified. With
   exactly one opponent left, the engine adds no choice, no action field and no
   priority step. Every "select opponent" step binds itself automatically, so
   a two-player game is played exactly as it is today.
3. **No hidden two-player assumptions survive.** `getOpponent()` (which
   asserts "exactly two players") is deleted, not wrapped. Every call site is
   rewritten to say what it actually means. A static guard test keeps it out.
4. **Table size is not a special case.** Code paths are written for N players.
   Two players is just N = 2, not a separate branch.
5. **Engine and type edits stay in the lead session.** Subagents (Sonnet only,
   at most 8 at once) work only on files no other agent touches: one set's data
   patches and that set's multiplayer test files.

## What the investigation found

- **Seats.** `GameState.players` is a record with no seat or turn order.
  `passTurn` hands the turn to `getOpponent(active)`.
- **`getOpponent`** has about 30 call sites in `SpoilsEngine.ts`, plus about
  15 two-player scans of `Object.values(state.players)`. They fall into three
  groups:
  - **Selectors and player refs.** `"opponent"` is resolved to one player in
    three places: `scopeMatchesPlayer`, `selectorPlayerMatch` and
    `resolvePlayerRef`.
  - **Priority.** `afterStackAction`, `reopenOrCloseResponseWindow`, `endTurn`,
    `playCard`, `resumeEffectFrames` and `clearFinishedBattle` all hand
    priority to the "opponent of whoever acted".
  - **Everything else.** Win check (`checkStateBasedActions`: winner =
    opponent of the loser), auction start, seat swap (`exchangeFactionSeats`
    destructures exactly two players), develop choices, cost modifiers,
    play/return restrictors, and the text of delayed-effect durations.
- **Card data.** About 674 distinct `"opponent"` paths across the 12 set
  files. Each one was authored against a two-player reading, where these
  printed phrases all meant the same thing:

  Counts are from the generated inventory (`data/card-tests/mp-inventory.md`).
  It reads the printed markup, which is the spec; the archival `text` field
  is reworded and under-counts. The counts are distinct rules groups.

  | Printed phrase | Groups | Multiplayer meaning (source) |
  |---|---|---|
  | "your opponent" | 171 | One opponent, chosen for the current block of rules text by that block's controller (MP 2, MP 4) |
  | "both players" | 19 | You and the opponent chosen for that block (MP 3); The Knitting Coalition is ruled "every opponent" (RQ-mp-6) |
  | "that opponent", "their opponent" | 19 / 3 | Refers back to an opponent already named in the block |
  | "an opponent", "any opponent" | 113 / 6 | Any one opponent; the pick or choice the sentence implies decides which (plain English, MP 2 does not apply) |
  | "each opponent", "your opponents", "opponents" | 52 | Every opponent still in the game |
  | "each player", "all players", "each other player", "each of you" | 16 | Every player (or every other player), active player first, then clockwise (CR 402.2) |
  | "any player", "a player", "another player", bare "players" | ~31 | As written |
  | "that player", "the picked player", … | 55 | Refers back to a player already named |
  | bare "opponent" | 2 | Classified by hand (Meat of the Mountain, I Drink Your Milkshake!) |

  Some cards were already written with three or more players in mind:
  Temple of Rantzigore ("your opponents"), Lockbox of the Aeons ("your
  opponents"), and Emergency Obfuscation ("each player moves 1 seat to the
  left").
- **Already N-player.** The rules for trigger and replacement ordering
  (503.4, 506.4), bidding (413), the clockwise mulligan (601.1g),
  `forEachPlayer`, `getAttackOptions` and `pendingResponders`. Each still gets
  multiplayer tests.

## Phase 0 — Baseline and tools (no behavior change)

Work happens on branch `ffa`. Status:

- [x] 1. Tag `mp-baseline` (`8e1c87e`, main after the RQ-r11-2/4 fix).
- [x] 2. Random play driver (`src/engine/__tests__/support/driver.ts`). It found six two-player engine bugs
  (a crashing target query, two soft-locks, actions mutated by `perform`, save/load losing state mid-resolution,
  a deck validation gap). They are fixed at the root before Phase 3 continues.
- [x] 3. Two-player replay digests: 102 games in `data/replays/2p/`, checked by `replay-2p.test.ts`.
- [x] 4. Freeze gate.
- [x] 5. Phrase inventory.

1. Tag `mp-baseline` on the current `main`.
2. **Random play driver** (`src/engine/__tests__/support/driver.ts`). Plays
   seeded games of random legal actions using only the public query surface
   (`getFlowView`, playability, attack options, pending-choice options). It
   finds no bugs at this stage; it is the base for the next item and for
   Phase 6.
3. **Two-player replay digests.** Play a few hundred seeded two-player games
   against the baseline engine with real catalog decks. Commit each game's
   action log and a digest of the state after every action. A test then
   replays them against the current engine and requires the digests to match
   exactly. This checks the whole engine, beyond what the hand-written tests
   cover. A digest may change only with an explicit, explained update.
4. **Freeze gate.** A test fails if any test file that existed at
   `mp-baseline` has been modified or deleted. New files are allowed.
   - `data/test-freeze.json` records a SHA-256 of every `*.test.ts`, with
     line endings normalized. `scripts/test-freeze.cjs` re-records it and
     checks it; `test-freeze.test.ts` is the gate.
   - Test helpers (`support/`, `_clause.ts`, …) are not frozen, because they
     must grow seat options. The frozen tests that use them still have to
     pass.
5. **Phrase inventory** (`npm run card-tests -- mp-inventory`, written to
   `data/card-tests/mp-inventory.json`). For every printing it lists:
   - every printed player phrase, its category from the table above, and the
     block it sits in;
   - every player word in the behavior data, with its path.
   It is generated and checked by the gate, like `clauses.json`.

## Phase 1 — Spec (stop and wait for rulings)

1. `data/rule-tests/source/multiplayer.txt`: MP 1–5, plus one **MPX atom**
   for each CR rule whose wording assumes two players. Each MPX atom records
   its reading and its source. The atoms that follow directly from the rules:
   - **MPX-seat.** Players sit in seat order. "Clockwise" (402.2, 413.1a,
     601.1g) means seat order. The turn passes to the next seat still in the
     game.
   - **MPX-win.** A faction at 0 influence makes its owner lose (102.1); the
     game goes on. The game ends when at most one player is left: that player
     wins. If every remaining player loses at the same moment, the game is a
     draw.
   - **MPX-attack.** You may attack any faction or location you don't control
     (608.1a). The defending player is that card's controller, and only they
     form the blocking party (608.1d).
   - **MPX-respond.** Anyone except the controller of the action may respond
     to it (607.1: you cannot respond to your own actions).
   - **MPX-select.** The controller of a block chooses its opponent (MP 2).
     The choice is skipped and bound automatically when only one opponent is
     left.
   - **MPX-vocab.** The phrase meanings in the table above.
   - **MPX-loop.** Every player involved in an action loop chooses a repeat
     count, active player first and then clockwise. The loop repeats the
     smallest count chosen (414.3b).
   - **MPX-setup.** One player is chosen at random from all players and picks
     who goes first (601.1c).
   - **MPX-swap.** Emergency Obfuscation's printed text ("both players switch
     seats") swaps seats and sides between the controller and one selected
     opponent (MP 3). The archival "moves 1 seat to the left" wording is a later
     rewording and is not the spec (MPQ-P1).
2. **Open questions** go into `QUESTIONS.md` as RQ-mp-n, each with a
   `ruleOpen` test. Remove the "multiplayer is out of scope" line there. These
   are the places where the rules are silent:
   - **RQ-mp-1: response order.** CR 607.2b avoids a priority system because
     there are only two players. With N players, who may respond to the top
     item, in what order, and when does it resolve? Recommendation: offer it
     clockwise starting left of its controller; it resolves only after every
     non-controller has passed in a row on that item. After it resolves, the
     player who made it may respond again first (607.2), then the rest
     clockwise.
   - **RQ-mp-2: battle and end-of-turn windows.** In 608.1c and 609.1a ("then
     your opponent / the defending player may do the same") and 610.1 ("their
     opponent has had a chance to respond"), can players other than the
     attacker and defender act? Recommendation: in battle, the attacker, then
     the defender, then the other players clockwise; at end of turn, every
     other player clockwise.
   - **RQ-mp-3: elimination.** What happens to a player who loses?
     Recommendation:
     - every card they own leaves the game;
     - every card they control but don't own goes back to its owner's control;
     - their unresolved stack items and pending choices are removed;
     - their lasting effects end;
     - if it was their turn, the turn ends at once, without end-of-turn
       responses or triggers.
   - **RQ-mp-4: opening draw from the third seat on.** Factions print "N
     going first, M going second". Recommendation: every seat after the first
     uses the "going second" number.
   - **RQ-mp-5: lasting "your opponent".** Continuous or static text (Underdog,
     Mud Prison, Silencer, Escort Ally, Foreclosure Overseer, and others): when
     is the opponent chosen, and what happens if that player is eliminated?
     Recommendation: the controller chooses when the effect starts applying
     (the card enters play, or the effect is created). The choice lasts as long
     as the effect does. If the chosen player is eliminated, the controller
     chooses again.
   - **RQ-mp-6: "Both players may use this ability" (The Knitting Coalition).**
     Is that one chosen opponent, or every opponent? HIDDEN INFLUENCE / PULLING
     STRINGS ("Your opponent ignores their faction's …") also need their
     opponent chosen at setup time. Recommendation: by MP 3, you plus one
     opponent, chosen at setup.
   - **RQ-mp-7: RQ-r11-2 becomes urgent.** That existing question asks
     whether "each player loses N" is one simultaneous loss. With more
     players, it decides whether several players drop out at once or one at a
     time (and so who is left to win).
3. Record the rulings in `rulings.md` and turn the `ruleOpen` tests into
   `rule` tests. Write RULES.md §"Multiplayer". **Phases 2 and 3 do not start
   until RQ-mp-1, 2, 3 and 5 are answered.**

### Rulings (user, 2026-11-07)

- **RQ-mp-1:** as recommended. The response is offered clockwise, starting
  left of the item's controller. The item resolves only after every other
  player has passed on it in a row. After it resolves, the player who made it
  may respond again first, then the rest clockwise.
- **RQ-mp-2:** yes. In battle the attacker acts first, then the defender, then
  the other players clockwise. At end of turn, every other player may respond
  clockwise.
- **RQ-mp-3:** yes. When a player loses:
  - the cards they own leave the game;
  - the cards they control but don't own go back to their owners;
  - their stack items and pending choices are removed;
  - their lasting effects end;
  - if it was their turn, the turn ends at once.
- **RQ-mp-4:** yes. Every seat after the first uses the "going second"
  opening draw.
- **RQ-mp-5:** yes. The "your opponent" for lasting text is chosen when the
  effect starts applying and lasts as long as the effect. If that player is
  eliminated, the controller chooses again.
- **RQ-mp-6:** every opponent. "Both players may use this ability" (The
  Knitting Coalition) means the controller and every opponent may use it.
  HIDDEN INFLUENCE and PULLING STRINGS ("Your opponent ignores their
  faction's …") likewise apply to every opponent. This ruling covers this card
  only. Elsewhere "your opponent" keeps the MP 2 selection.
- **RQ-mp-7 (settles RQ-r11-2):** a player loses when their faction hits 0
  from something that hits only them. When one card or ability, or one batch
  of battle damage, brings several factions to 0 together, they lose at the
  same time. If that is everyone still in the game, the game is a draw (CR
  102.2).
  - A unit is one resolving card or ability's own effects, one triggered
    ability's own effects, or one batch of battle damage. A trigger set off
    during a unit is a later, separate unit.
  - The first unit in which any faction reaches 0 decides who is out.
  - Reaching 0 is final: a later raise in the same unit does not save the
    player (RQ-r11-4).
  - Applied to two-player play before the multiplayer work starts, as its own
    change. Converting the `ruleOpen` tests to `rule` is part of the baseline,
    so the freeze gate needs no exception for it.
- **Elimination timing (multiplayer extension of RQ-mp-7 / RQ-r11-4):** a
  player who reaches 0 is eliminated as soon as the unit that brought them to
  0 ends. That happens before any trigger it set off and before any response
  window. From then on they take no further actions or responses.
  - User's words: "if a player hits 0 faction they basically shouldn't be able
    to respond or anything".
  - The rest of the table plays on per RQ-mp-3.

### Later rulings (user, 2026-11-07: "all recommended")

- RQ-mp-8 to RQ-mp-11 (battle-window order after the defender, pending
  triggers of an eliminated player, re-selecting on a control change, and
  loops the active player isn't part of) are ruled as recommended. They are
  recorded in `data/rule-tests/rulings.md`.
- RQ-mp-12 to RQ-mp-14 (user, 2026-11-08), recorded in `rulings.md`:
  - an elimination sets off no trigger;
  - losses from nested units are processed in the order the factions first
    reached 0;
  - when the active player is eliminated, everything in progress on their turn
    is dropped.
- Card pattern rulings MPQ-P1 to MPQ-P11 are in
  `data/card-tests/mp-spec/README.md` ("Pattern rulings") and in
  `rulings.md`. They cover:
  - printed text over archival wording;
  - trigger conditions, which any opponent's action satisfies;
  - "either deck";
  - "any opponent may pay" offers, which go clockwise;
  - battle text, where "your opponent" is the other side of the battle;
  - superlatives and totals over "an opponent", evaluated within one
    opponent;
  - other-player point-of-view text;
  - Mercenary's Creed;
  - Gideon's Legacy.

## Phase 2 — Types (lead session)

Implemented on branch `ffa-engine` (worktree `../spoils-db-engine`), merged
into `ffa` once the two-player replays are recorded.

### State

- **`GameState.seats: PlayerId[]`**: the clockwise seat order. It is set at
  setup from the order the players are given. Emergency Obfuscation's swap
  exchanges two entries while it lasts.
- **`PlayerState.eliminated?: { turn: number }`**: set when the unit that
  brought the player to 0 ends (MPX-elim-timing). "Players still in the game"
  means every seat without it.
- **`GameState.pendingLoss`** (RQ-r11-2) keeps its shape. At the end of the
  unit, the listed players are eliminated. The game ends only when one player
  is left (that player wins) or none (a draw).
- **Bindings.**
  - `ResolutionContext.opponentId?`: the block's opponent.
  - `ResolutionContext.chosenPlayers?: Record<string, PlayerId>`: named player
    choices.
  - Lasting abilities keep their binding on the card instance, in
    `CardInstance.boundOpponents?: Record<AbilityId, PlayerId>`.
  - Every lasting record a block creates (delayed effect, modifier, area
    modifier, player effect, restriction) copies `opponentId` from its
    context. The record keeps reading the same player after the block
    finishes.

### Player vocabulary

| Printed meaning (spec) | Data |
|---|---|
| `chosenOpponent` | `"opponent"` (same spelling, now the block's opponent) |
| `anyOneOpponent`, settled by a pick | `{ type: "controllerOf" / "ownerOf", target }` of that pick (existing) |
| `anyOneOpponent`, nothing settles it | a player choice `{ id, from: "opponents" }` plus `{ type: "chosenPlayer", id }` |
| selector or scope over any opponent | `"opponents"` (new value next to `"self" / "opponent" / "any"`) |
| `eachOpponent`, `eachPlayer`, `eachOtherPlayer`, `chosenPair`, `selfAndEachOpponent` | `forEachPlayer` with `players: "opponents" / "all" / "others" / "pair" / "selfAndOpponents"` and an optional `except: PlayerRef` (Gideon's Legacy) |
| `refersBack` | `{ type: "chosenPlayer", id }` or the existing card-relative refs |

- **How the block's opponent is bound.** Each ability gets
  `opponentFrom?: "choose" | "event" | "battle" | "respondedTo" | "acting"`.
  The default is `"choose"`. The other values cover MPQ-P5, MPQ-P8, MPQ-P4 and
  MPQ-P10.
- **When `"choose"` happens.**
  - Played cards and activated abilities choose with the action
    (`players.opponent`), before targets.
  - Triggers and replacements choose through a `choosePlayer` pending choice
    when they resolve or apply.
  - Lasting abilities choose when they start applying. With one opponent left,
    nobody is asked.
- **Player choices.**
  - An ability's `playerChoices?: { id, from, chooser?, condition? }[]` are
    made at play or activation time, through the action's `players` record.
  - A `choosePlayer` effect makes the same choice at resolution.
  - A player choice is not a pick (CR 405): it does not target cards and does
    not trigger "picked" abilities.
- **`noResponse?: true | "opponent"`.** `true` means nobody may respond;
  `"opponent"` means the block's opponent may not.
- **Offers (MPQ-P7).** "Any opponent may pay" is `mayPay` with `offerTo:
  "opponents"`; "any player may pay" is `anyPlayerMayPay`. The offer goes
  clockwise, and the first payer settles it.

### As built (Phase 3 step 5)

The design above stands, with these differences:

- **`playerChoices`** are `{ id, from: "opponents" | "players", condition? }`, always made by the controller with the
  action. The `chooser` of the plan lives on the `choosePlayer` effect instead, where a block written from
  another player's point of view needs it (`from` is read relative to that chooser).
- **`{ type: "choosePlayer" }` is an effect** (`id`, `from`, `chooser?`); the pending choice has a `bind` that says
  what the answer writes (the block's opponent, a trigger's, a named player, a lasting ability's, a replacement's,
  a lasting record's).
- **`"acting"`** is also a `PlayerRef` (the acting player of an `opponentFrom: "acting"` block) and
  `ResolutionContext.actingPlayerId` carries it; `forEachPlayer players: "pair"` is the acting player (else the
  controller) plus the block's opponent.
- **`anyPlayerMayPay`** also gets `elseEffects` (the "Otherwise" branch).
- **`players`** is typed `PlayerAnswers`; the `deployForFree`, `resourceReveal` and `useTargetAbility` answers
  carry it too, because they start plays. `getPlayRequirements` lists a `{ kind: "players" }` requirement first.
- The opponent is stored only at tables of three or more, so nothing new appears in a two-player state.

### Choices, actions and setup

- **`PendingChoice` kind `choosePlayer`**: `{ playerId, id, candidates,
  sourceId, abilityId }`.
- **`players?: Record<string, PlayerId>`** on `playCard`, `activateAbility`
  and `flipUp`. It is validated against the ability's player choices and the
  implicit `opponent`, and refused if a player is yourself where an opponent is
  required, or has been eliminated.
- **`createFactionGame({ players: FactionPlayerSetup[] })`**, where array order
  is seat order. `createTwoPlayerFactionGame` stays as its 2-seat form.

### Response windows

- **`ResponseWindowState.passed: PlayerId[]`**: the players who have passed in
  a row on the current offer. The window still has a single
  `priorityPlayerId` cursor.
- **How the cursor moves.**
  - It moves clockwise and skips the item's controller and anyone already in
    `passed`.
  - The item resolves once every other living player is in `passed`
    (MPX-priority).
  - `pendingResponders` keeps the top-level order for battle and end-of-turn
    windows (MPX-battle-window, MPX-endturn).

### Replay digest

These fields are new in every game, two-player included:

- `seats` (one possible order at two seats, set once);
- `eliminated` (set only when a game ends, at two seats);
- the new `ResponseWindowState.passed` bookkeeping.

They are excluded from the two-player digest in `projectForDigest`, each with
its reason. No other field may be excluded.

## Phase 3 — Engine core (lead session; rules-suite tests written alongside)

In order. Each step is green on the full existing suite, the freeze gate and
the two-player replay digests before the next one starts.

Status: all eight steps are done (`mp-ffa.p1` to `p17`). `getOpponent` is
gone and a static test keeps two-player helpers out of the engine. The
vocabulary the card data needed (filtered player choices, any-opponent offers,
every-opponent taxes, per-opponent conditions and restrictions, text from
another player's point of view, per-opponent setup) is built and documented in
RULES.md §15.

1. **Seats.** Seat helpers (`opponentsOf`, `nextSeat`, `playersFrom`) and turn
   passing.
2. **Elimination.** Win, loss and draw (MPX-win, RQ-mp-3) in
   `checkStateBasedActions`.
3. **N-player setup.** First-player decider, opening draws (RQ-mp-4),
   mulligans and staple choices in seat order.
4. **Response windows.** Action, battle and end-of-turn windows
   (RQ-mp-1/2).
5. **Opponent binding.** Binding, the `chooseOpponent` choice, the action
   field and keeping the binding on everything a block creates.
6. **Remaining call sites.** Every other `getOpponent` site, rewritten to its
   real meaning: auction, loops, seat swap rotation, develop choices, cost
   modifiers, restrictors, delayed-duration text, logs.
7. **Remove `getOpponent`.** Add the static guard.
8. **Public queries.** Flow view, queries, redaction (every viewer),
   persistence (save and load at N seats) and log vantage.

Every MP and MPX atom gets `rule` tests at 3 **and** 4 seats in
`src/engine/__tests__/rules/mp-*.test.ts`. The rules gate requires them.

## Phase 4 — Card data (parallel, one set per agent)

Status: done. Every spec site of all twelve sets is converted
(`data/card-tests/mp-worklist.json` is empty; the gate also accepts moved
sites and new nodes). Two-player replay games whose in-flight card-data copies
changed were re-recorded after checking that every recorded action is still
accepted and the final state is unchanged (three games differ only in fresh
id counters, from effect lists that now pause in printed order).

- **Lint gate** (`card-data-integrity`, driven by the inventory):
  - In each block, every player word in the behavior must match a printed
    phrase of the same category, and the reverse.
  - A mismatch fails the gate unless it is a listed exception with a written
    reason (for example, a phrase in reminder text).
  - Run against today's data, the lint lists every site to reclassify. That
    list is the work queue. Nobody has to hunt for sites by hand.
- **Agents.** One agent per set file (12 sets, at most 8 at once). Each
  agent:
  - edits only through `scripts/patch-cards.cjs` patches, touching only its
    own `data/cards/<set>.json`;
  - runs `sync-cards` plus that set's per-card and clause tests;
  - must not edit engine or types. A vocabulary gap is reported back to the
    lead, not worked around in data.
- **Review.** The lead reviews each set's diff against the inventory, then
  rebuilds coverage and fidelity.

## Phase 5 — Multiplayer clause tests (parallel, one set per agent)

- **Manifest.** Each clause in `clauses.json` gets an `mp` flag, taken from
  the inventory:
  - set if the clause has a printed player phrase, or player words in its
    data;
  - set to `"quantified"` for each opponent / opponents / each player / all
    players.
- **Gate.** `clauses/_coverage.test.ts` requires an `mpClause(printingId, key,
  seats, title, fn)` test for every `mp` clause:
  - every `mp` clause: at 3 seats;
  - `"quantified"` clauses: at 4 seats as well.
- **What each test asserts.**
  - The chosen or affected opponent is affected.
  - The **other opponent is not** (or is, for quantified text).
  - The `chooseOpponent` step appears exactly when the text says "your
    opponent" and two or more opponents are left.
  - Picks are limited to the chosen opponent's cards wherever the text ties
    them to "your opponent".
- **Files.** Files are new (`clauses/mp/<set>.test.ts`). Existing clause files
  are frozen.
- **Mutation testing.** `card-tests mutate` gets player-word mutations (for
  example, swap "opponent" for "each opponent", or "an opponent" for "your
  opponent"). Every mutation of an `mp` clause must be detected.

## Phase 6 — Running the existing tests at 3 and 4 seats

1. **Bystander replay.**
   - Run the whole existing per-card, clause and engine suite with
     `SPOILS_TEST_EXTRA_SEATS=1` and `=2`.
   - The fixtures add inert seats. The harness passes every priority a
     bystander gets, and picks the original opponent whenever a
     `chooseOpponent` step comes up.
   - Under those rules, the result must equal the two-player result for every
     test except those touching `"quantified"` clauses. That list of expected
     differences is generated from the inventory, not picked by hand.
   - Any other failure is an engine bug and gets fixed at its root.
   - This turns all ~4,700 existing two-player tests into 3- and 4-seat
     regression tests without editing them.
2. **Fuzz.** The random driver plays real catalog decks at 2–6 seats. It
   checks invariants after every action:
   - no internal assertion fires;
   - every card is in exactly one zone;
   - a player who has lost owns or controls nothing, per RQ-mp-3;
   - turns skip players who have lost;
   - a finished game has exactly one winner or a draw;
   - priority is never given to a player who has lost or to the controller of
     the top item;
   - a mid-game save and load replays to the same digest;
   - no viewer's redacted view leaks hidden cards.

   CI runs a fixed set of seeds. Bigger sweeps run locally, and every seed
   that fails is kept as a regression test.

## Phase 7 — Docs

- `RULES.md`: §Multiplayer, citing MP/MPX atoms and rulings.
- `BEHAVIORS.md`: the player vocabulary and block binding.
- `docs/TESTING.md`: the freeze gate, replay digests, the `mp` clause gate,
  the bystander replay and the fuzz.
- `docs/CARD-DATA.md`: the phrase categories.
- `README.md`: `createFactionGame`, `chooseOpponent`, the `opponentId` action
  field, seats and elimination.

## Done when

- Every MP/MPX atom has tests at 3 and 4 seats, and no RQ-mp question is
  open.
- Every `mp` clause of every distinct card has its 3-seat test (and 4-seat for
  quantified clauses). Mutations are detected.
- The vocabulary lint passes with no exceptions left unexplained.
- The freeze gate and the two-player replay digests match `mp-baseline`
  exactly.
- The bystander replay passes at +1 and +2 seats, with no differences beyond
  the generated list.
- The fuzz is clean at 2–6 seats, and `getOpponent` is gone.
- `npm test`, `typecheck`, `build` and `typecheck:consumer` are green.
