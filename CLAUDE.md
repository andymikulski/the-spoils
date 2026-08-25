# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A data-driven rules engine for **The Spoils** CCG, plus the card database that
drives it. The engine (`src/engine`, `src/types`) is intentionally UI-free:
it owns all state mutation, exposes `GameState` for inspection and accepts
`GameAction` objects — no callbacks, no card-authored code. Card behavior is
JSON-serializable data built from a fixed vocabulary of costs, conditions,
selectors, expressions, and effects (see `src/types/{costs,conditions,effects,expressions}.ts`).

This package is published/imported as a library (`npm run build` emits
declarations to `build/`; see `package.json`'s `exports` map) — a separate
project (e.g. a web game-runner UI) is expected to `import` from it rather
than live in this repo. That's the reason for the `src/engine.ts` /
`src/data.ts` split below: keep growing the pure-engine surface without ever
letting UI concerns leak into it.

`RULES.md` is the authoritative rules reference the engine is tested against.
It cites its sources per claim (`(card-verified)` against real card text,
`(engine-derived)` where the implementation resolves an ambiguity). **When a
test fails, check whether the engine matches RULES.md — not whether it
matches itself.** If you change engine behavior in a way that affects a
documented rule, update RULES.md in the same change.

## Development approach

Work interface-first, test-driven:

- Before implementing a new rule, ability variant, or engine feature, design
  its shape in `src/types/` first (the discriminated-union member, the field
  on `GameState`, etc.) — get the data model right before writing the logic
  that interprets it.
- Write the test(s) against that interface (in `src/engine/__tests__/`,
  using the synthetic fixtures, not `data/cards.json`) before or alongside
  the `SpoilsEngine` implementation, and check them against `RULES.md`
  rather than against the engine's current behavior.
- Prefer extending the closed cost/condition/effect/expression vocabulary
  over one-off, per-card logic — that keeps card behavior representable as
  data and testable through the same fixture-driven path as everything else.

## Commands

```
npm test        # runs every src/**/*.test.ts via node:test + tsx
npm run typecheck   # tsc --noEmit against tsconfig.json and tsconfig.test.json
npm run sync-cards   # regenerate src/data/cards.js from data/cards.json
npm run build        # tsc -p tsconfig.json; emits build/ (declarations + JS)
```

Run a single test file directly (faster than the full suite):

```
node --import tsx --test src/engine/__tests__/battle.test.ts
```

There is no lint script. There is no bundler/dev-server wired into
`package.json` — `build/` is produced by running `tsc` (not `--noEmit`)
against `tsconfig.json` (`outDir: ./build`, `rootDir: ./`, so output lands
under `build/src/...`); `index.html` loads `/build/src/index.js` as a
module. `build/` is gitignored and regenerated on install via the
`prepare` script — never hand-edit anything under it. `tsconfig.json`
excludes `**/__tests__/**` so test-only helpers never end up in `build/`
(and therefore never ship in the package).

## Architecture

### Layout

- `src/types/` — the data model: card definitions, game state, actions,
  events, and the ability-authoring vocabulary (costs/conditions/effects/
  expressions). Pure types, no logic. `src/types/index.ts` re-exports all of it.
- `src/engine/SpoilsEngine.ts` — the rules engine itself. One `SpoilsEngine`
  instance wraps a `definitions` map (`CardDefinitionId -> CardDefinition`)
  and a mutable `GameState`. All rules logic lives here.
- `src/engine/setup.ts` / `src/engine/factionSetup.ts` — game bootstrapping.
  `createTwoPlayerFactionGame` is the real entry point: it resolves each
  player's faction card, builds `CardInstance`s, shuffles, deals starting
  resources/opening hands per the faction's `setup` rules, and queues
  mulligans (or starts turn 1 directly if the faction has none).
- `src/engine/utilities.ts` — small pure helpers (`assert`, `compare`,
  `nextId`, threshold parsing, built-in faction defaults).
- `src/engine.ts` — the package's main entry point (`package.json`'s
  `"."` export) and the public re-export surface (`export * from "./types"`
  plus the engine/setup exports). Import from here, not from files inside
  `src/engine/` or `src/types/` directly. Pure: no data, no DOM/Node
  globals — only `src/types/` and `src/engine/`.
- `src/data.ts` — the package's `"./data"` export: the real card catalog
  (`CARD_CATALOG`) and preconstructed decklists (`ARCANIST_DECK`,
  `WARLORD_DECK`). Deliberately separate from `src/engine.ts` — a consumer
  that only wants the rules engine (e.g. to run it against synthetic cards)
  never pulls in the ~1.2MB card database.
- `src/index.ts` — a runnable usage example, not application code, and not
  part of the package's public exports.
- `data/cards.json` — source of truth for the real card database (2101+
  cards). `src/data/cards.js` is a **generated** copy (`npm run sync-cards`);
  never hand-edit it. `data/raw-database.json`, `scripts/process-db.cjs`,
  `scripts/fix-ids.cjs` are the (mostly one-off) pipeline that produced
  `data/cards.json` and `data/assets/*.jpg` from an external source dump.
  `data/assets/` (card images, ~370MB) is not part of the published package —
  it's a repo-local static asset, not something a library consumer imports.
- `src/data/decks/*.json` / `*-ids.js` — preconstructed decklists (e.g.
  `arcanist`, `warlord`), each a list of `CardDefinitionId`s including one
  copy of the faction card.

### Engine control flow

`SpoilsEngine.perform(action: GameAction)` is the single mutation entrypoint.
It dispatches to private handlers (`playCard`, `activateAbility`,
`passPriority`, `declareAttack`, ...), and `getFlowView()` is the single
query surface intended for a renderer/UI — it derives a `mode`
(`"main" | "develop" | "response" | "battleChoice" | "pendingChoice" |
"gameOver" | ...`) from state rather than storing it directly.

Key mechanisms, all built on top of each other:

- **Response stack** (`RULES.md` §7): playing a card or activating an
  ability pushes a `StackItem` onto `state.responseStack` and opens a
  `responseWindow` giving the opponent priority. Two consecutive passes flip
  the window to `"resolving"`; `advanceFlow()` then pops and resolves one
  stack item (or, once the stack is empty, resumes whatever the window's
  `continuation` was — back to main, finishing a turn, entering battle
  blocking, etc).
- **Event/trigger system**: engine mutations call `emit(event)`, which finds
  matching triggered abilities and queues them (`immediateQueue`). Triggers
  from the same event are resolved in an order that may require a player
  choice (`pendingChoice.kind === "orderTriggers"`) when their controllers
  differ. `beginEventBatch`/`endEventBatch` defer trigger processing across
  a batch of simultaneous mutations (e.g. all battle damage in one speed
  group) so one triggered ability can't interrupt a sibling mutation.
- **Pending choices**: whenever the engine needs player input it can't
  resolve itself (ordering simultaneous triggers, picking a Unique
  survivor, selecting ambiguous targets), it sets `state.pendingChoice` and
  `perform()` refuses any action except `resolvePendingChoice` until it's
  cleared.
- **State-based actions** (`checkStateBasedActions`, RULES.md §11): run after
  every effect resolution — lethal damage, invalid "Attach to X" targets,
  Unique conflicts, and the win condition (a faction at 0 influence) are all
  checked here in a loop until nothing changes.
- **Ability vocabulary**: activated/triggered/continuous abilities are built
  from `Cost[]`, `Condition`, `Effect[]`, `TargetDeclaration[]`, and
  `NumberExpression` — all closed discriminated unions in `src/types/`.
  Extending card behavior generally means adding a new variant to one of
  these unions (and its `switch` in `SpoilsEngine`), not writing per-card
  code. `canPayCosts` checks affordability by simulating costs against a
  `structuredClone`d state on a throwaway `SpoilsEngine` instance.

### Tests

`src/engine/__tests__/*.test.ts`, using Node's built-in `node:test` +
`node:assert/strict` (no Jest/Vitest). `support/fixtures.ts` builds small
synthetic card definitions and games (`character()`, `item()`, `location()`,
`tactic()`, `resourceCard()`, `buildGame(...)`) — deliberately independent of
`data/cards.json`, so engine-rules tests fail for engine reasons, not data
gaps. Import engine types/exports via `../../../engine.js` (the public
surface), matching how real consumers would. Test files are matched purely
by the `*.test.ts` suffix anywhere under `src/` (`scripts/run-tests.cjs`
walks the tree itself, since npm-script glob expansion isn't reliable across
shells).

## Conventions

- Source files use `.js` extensions in relative imports even though the
  files are `.ts` (`moduleResolution: "bundler"` + ESM output) — follow this
  existing pattern for new files.
- `strict: true`; keep new code strict-clean.
- Prettier is a devDependency but there's no configured `format` script or
  checked-in config — match surrounding style rather than assuming a
  specific Prettier ruleset applies.
- Both `yarn.lock` and `package-lock.json` are present; `node_modules/.yarn-integrity`
  indicates yarn is the one actually used to install.
