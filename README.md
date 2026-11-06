# the-spoils

A rules engine and complete card database for **The Spoils**, the out-of-print
collectible card game.

- **The whole catalog**: 2,257 printings (1,320 distinct cards) across all 12
  sets, from Seed through Decade of Deckadence, with printed rules text,
  structured markup, subtitles, flavor text, artist credits and a scan of
  every card.
- **A data-driven engine**: every card's behavior is plain JSON built from a
  closed vocabulary of costs, conditions, effects and expressions. There is no
  per-card code. The engine owns all state; you feed it actions and read its
  state back. It has no UI, no DOM, and no I/O.
- **Checked against the printed cards and the official rules**: 2,255 of
  2,257 printings play exactly as printed. The other two are the Showdown
  factions, whose multiplayer-only text isn't supported. Roughly 43,000 tests
  cover every printed clause of every card and every rule in the
  Comprehensive Rules v2.5 and the Rules FAQ v2.0.

> This is an unofficial fan project, not affiliated with or endorsed by the
> owners of The Spoils. The code is MIT-licensed; the card text, artwork and
> rules documents are not. See [LEGAL.md](LEGAL.md).

## Install

```
npm install the-spoils
```

The package ships ESM with TypeScript declarations and has no runtime
dependencies. It works with TypeScript's `nodenext`, `node16` and `bundler`
module resolution. Legacy `node10` resolution is also supported via
`typesVersions`. CommonJS projects can `require()` it on Node 20.19+ / 22.12+.

## Entry points

| Import | What you get |
|---|---|
| `the-spoils` | The engine: `SpoilsEngine`, game setup, deck construction checks, save / load, hidden-information redaction, and every type (`GameState`, `GameAction`, `CardDefinition`, …). Contains no card data. |
| `the-spoils/data` | The real catalog (`CARD_CATALOG`), preconstructed decks (`ARCANIST_DECK`, `WARLORD_DECK`, `SEED3_SAMPLER_DECK`) and per-card fidelity (`CARD_FIDELITY`, `cardFidelity`). Several MB; import it only if you need the real cards. |
| `the-spoils/card-text` | `parseCardText` / `cardTextToPlain`: turn a card's `markup` into a typed tree or plain text for rendering. |
| `the-spoils/assets` | Image URL conventions (`DEFAULT_ASSET_ROOT`, `CARD_BACK_ASSET_ID`, `resolveCardBackUrl`). No image files; see [Card images](#card-images). |

## Quick start

```ts
import { createTwoPlayerFactionGame, saveGame, loadGame } from "the-spoils";
import { CARD_CATALOG, ARCANIST_DECK, WARLORD_DECK } from "the-spoils/data";

const game = createTwoPlayerFactionGame(
  CARD_CATALOG,
  { id: "p1", name: "Player 1", deckDefinitionIds: ARCANIST_DECK },
  { id: "p2", name: "Player 2", deckDefinitionIds: WARLORD_DECK }
);

// Setup has already run: factions are in play, decks shuffled, hands drawn.
// Both players keep their opening hands.
while (game.state.setup.phase === "mulligan") {
  const { order, currentIndex } = game.state.setup;
  game.perform({ type: "mulligan", playerId: order[currentIndex], cardIds: [] });
}

console.log(game.getFlowView().mode); // "main", "pendingChoice", …
console.log(game.formatLog());

// Saves are plain JSON. Reload with the same catalog.
const resumed = loadGame(JSON.parse(JSON.stringify(saveGame(game))), CARD_CATALOG);
```

A runnable version is in [`examples/basic.ts`](examples/basic.ts)
(`npx tsx examples/basic.ts`).

## Driving a game

- **`engine.perform(action)`** is the only way to change the game. Actions
  are plain objects (`playCard`, `activateAbility`, `declareAttack`,
  `declareBlockers`, `passPriority`, `flipUp`, `endTurn`,
  `resolvePendingChoice`, …; see `GameAction`). An illegal action throws with
  the engine's reason and leaves the game unchanged.
- **`engine.getFlowView()`** tells a UI what the game is waiting for: `mode`
  (`setup`, `main`, `response`, `battleChoice`, `pendingChoice`, `gameOver`,
  …), who has priority, and who must decide.
- **When the engine needs a decision** (ordering simultaneous triggers,
  picking targets, a "you may" prompt), it sets `state.pendingChoice` and
  accepts only `resolvePendingChoice` until that is answered.
- **Read-only queries** let a client offer only legal moves without
  re-deriving the rules: `checkAction` (dry run), `getCardPlayability`,
  `getPlayRequirements`, `getPickCandidates`, `getAvailableActivatedAbilities`,
  `getFlipUpPlayability`, `getStat`, and more.
- **Hidden information**: `redactStateFor`, `redactFlowViewFor` and
  `redactLogFor` produce a per-player view for networked play.
- **Your own cards**: the engine takes any `CardDefinition[]`, so you can run
  it against custom or synthetic cards without importing the catalog.

The rules the engine implements, with citations, are in [RULES.md](RULES.md).
The card-behavior vocabulary is documented in [BEHAVIORS.md](BEHAVIORS.md).

## Card images

`data/assets/<card id>.jpg` holds one scan per printing, plus the shared card
back at `data/assets/card-back.jpg`. The images are in this repository, not
in the npm package. To show them, serve that directory yourself and build
URLs as `<root>/<id>.jpg`.

## Repository layout

| Path | Contents |
|---|---|
| `src/engine/`, `src/types/` | The engine and its data model |
| `src/engine.ts`, `src/data.ts`, `src/cardText.ts`, `src/assets.ts` | The package entry points |
| `data/cards.json` | The card catalog (source of truth; `src/data/cards.js` is generated from it) |
| `data/assets/` | Card images |
| `data/card-tests/`, `data/rule-tests/` | Manifests and rulings for the clause and rules test suites |
| `docs/` | The official rules PDFs, [card data](docs/CARD-DATA.md) and [testing](docs/TESTING.md) guides |
| `lore/` | Every scrap of world lore the cards contain, organized by topic |
| `examples/` | Runnable usage example |
| `scripts/` | Test runner, data sync, coverage and test-manifest tooling |
| `types-test/` | Compiles the published type declarations as a strict downstream project would |
| `RULES.md`, `BEHAVIORS.md`, `COVERAGE.md` | Rules reference, behavior vocabulary, per-set implementation status |

## Development

```
yarn install            # also builds build/ via the prepare script
npm test                # every *.test.ts under src/ (node:test + tsx)
npm run typecheck       # tsc against the library and test configs
npm run typecheck:consumer   # the built .d.ts compile in a strict consumer project
npm run build           # emit build/ (JS + .d.ts)
npm run sync-cards      # regenerate src/data/cards.js after editing data/cards.json
```

To run a single test file:
`node --import tsx --test src/engine/__tests__/battle.test.ts`.

A few rules for changes:

- New behavior goes into the shared vocabulary (a new variant of a cost,
  condition, effect or expression union in `src/types/`), never into per-card
  code.
- Tests use the synthetic fixtures in `src/engine/__tests__/support/`, so they
  fail for engine reasons rather than data gaps.
- When a test fails, check the engine against `RULES.md` and the printed
  card, not against its own previous behavior.

See [docs/TESTING.md](docs/TESTING.md) for how the suites and their coverage
gates work.

## License

Code: [MIT](LICENSE). Game material (card text, artwork, rules documents) is
not covered; see [LEGAL.md](LEGAL.md).
