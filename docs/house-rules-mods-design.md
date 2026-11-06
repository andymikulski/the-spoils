# House Rules / Mods — Design Proposal

**Status:** Draft. Not yet implemented. Captured 2026-09-09 for later work.

**Scope:** A game-agnostic, data-focused way to plug runtime-loadable "house
rules" / mods into the engine. The engine is a published library, so the
design must not assume any particular consumer.

---

## Goals

- **Serializable.** A mod is plain JSON — no functions, no class instances —
  so it round-trips through `localStorage`, a `jsonb` column, a file, or a
  URL, and travels with a save.
- **Runtime-loadable.** A player (or a UI) authors a mod and applies it when
  starting a game; no rebuild, no code deploy.
- **Flexible enough to get weird.** Must cover things like "blockers work
  1:1 like MTG" and "2× every number on every card", not just cosmetic
  toggles.
- **Guard-railed.** A consumer decides how much power to expose. Unknown /
  disallowed constructs are rejected at load, not at play time.
- **Deterministic.** Every mod construct is a pure function of
  `(state, action)`. This is what protects the package's existing
  save / replay / affordability-probe guarantees.

## Non-goals

- Arbitrary user code running in the engine process (see Tier 4 for the
  bounded exception).
- Mid-game mutation of the active rule set. Mods are frozen at setup.
- A deck-construction / ban-list system. That belongs in the deck layer
  (`validateDeck` already takes an options bag); a mod may *reference* a
  ban list but does not define one.

---

## The core tension

Two requirements pull against each other:

- **Serializable + safe + replay-deterministic** wants a *closed data
  vocabulary* — which is exactly the engine's existing philosophy (card
  behavior is a fixed vocabulary of costs / conditions / selectors /
  expressions / effects; no card-authored code).
- **"Flexible enough to get weird"** wants *arbitrary computation*, which
  pushes toward scripting.

Resolution: keep the same north star the engine already chose for card
behavior — push as much as possible into a declarative vocabulary, and make
the scripting escape hatch a last resort with hard walls (Tier 4). House
rules differ from card behavior only in *altitude*: they change how the
engine itself behaves, not what one card does.

---

## Engine seams this design hooks

Line numbers are as of 2026-09-09 and will drift; treat the symbol names as
authoritative.

| Seam | Location | What flows through it |
|---|---|---|
| `SpoilsEngine.perform(action)` | `src/engine/SpoilsEngine.ts` (~L321) | the **only** mutation entry point |
| `SpoilsEngine.getFlowView()` | `src/engine/SpoilsEngine.ts` (~L427) | the **only** UI query surface — structural mods must surface here so a renderer can adapt |
| `SpoilsEngine.getStat(cardId, stat)` | `src/engine/SpoilsEngine.ts` (~L2021) | every live card-stat read; already folds `add` / `set` / `multiply` modifiers |
| `SpoilsEngine.evaluateNumber(expr, ctx)` | `src/engine/SpoilsEngine.ts` (~L4908) | every expression-driven number (costs, counts, damage amounts, `X`) |
| `SpoilsEngine.forEachActiveContinuous()` | `src/engine/SpoilsEngine.ts` (~L4102) | how continuous abilities are discovered; a game-attached ability piggybacks here |
| `emit()` + `GameEventMap` | `src/types/events.ts` | the trigger / reaction bus |
| `GameState` | `src/types/state.ts` (~L769) | `saveGame` deep-clones this (`src/engine/persistence.ts` ~L41), so anything stored here travels through save / load / replay for free |
| `declareBlockers` / `assignBattleDamage` / `finishBattle` | `src/engine/SpoilsEngine.ts` | party-vs-party combat algorithm — the target for structural combat mods |
| `createTwoPlayerFactionGame` + `FactionGameSetupOptions` | `src/engine/factionSetup.ts` | the real game entry point; natural place to accept `mods` |
| `TOURNAMENT_FACTION_DEFAULTS` | `src/engine/utilities.ts` (~L149) | the hardcoded setup constants Tier 0 overlays |

Reusable shapes already in the type model:

- `TriggeredAbility` / `ReplacementAbility` / `ContinuousAbility`
  (`src/types/cards.ts` ~L428 / L463 / L517) — already the right shape for
  reactive rules; currently always attached to a card.
- `NumberExpression` (`src/types/expressions.ts` ~L100),
  `CardSelector` (~L306), `Condition` (`src/types/conditions.ts`) — the
  vocabulary Tier 1 / Tier 2 rules compose from.
- `RuntimeModifier` with `ModifierOperation` (`add` | `set` | `multiply`)
  already exists and defines the stat-layering mental model.

There is **no** existing `variant` / `config` / `houseRule` / `mod` concept
to reconcile with. Green field.

---

## The `GameMod` envelope

Store `mods: GameMod[]` on `GameState`, set at setup and treated as
immutable after `state.started` (assert on any attempt to mutate). Because
`saveGame` structuredClones `state`, mods automatically travel through
save / load / replay, and `getSaveSummary` can surface "this game uses mods
X, Y" without deserializing the whole blob.

```ts
interface GameMod {
  id: string;
  name: string;
  description?: string;

  config?: Partial<RulesConfig>;       // Tier 0 — parameters
  numericRules?: NumericRule[];         // Tier 1 — global value transforms
  triggerRules?: GameAttachedRule[];    // Tier 2 — reactive rules
  policyOverrides?: PolicyOverride[];   // Tier 3 — named strategy swaps
  // Tier 4 (scripting) intentionally omitted until proven necessary.
}
```

A mod is a *bundle*; rules within it come in tiers of escalating power.
Ship the tiers in order — each is independently useful and independently
shippable.

`createTwoPlayerFactionGame` accepts `mods: GameMod[]` in its options and
writes them onto the initial `GameState`.

---

## Tier 0 — `RulesConfig` (parameters)

**Ship first.** A flat, JSON-schema'd object of constants the engine
currently hardcodes or reads from faction setup:

- starting influence
- opening-hand size (going first / going second)
- mulligan count + mode
- develops per turn + the develop choice menu
- restore-rule flags (detach resources, restore non-resources)
- max hand size (if/when enforced)
- turn / priority timings that are safe to parameterize

These already live semi-structured in `TOURNAMENT_FACTION_DEFAULTS`
(`src/engine/utilities.ts`). Merge order:

```
engine defaults  ←  faction `setup`  ←  mods (in array order)
```

Covers the large majority of what players actually ask for ("hand size 10,
2 develops, no mulligan"), with essentially zero engine risk and trivial
serialization. This tier also establishes the `GameMod` envelope,
`validateMod`, and capability gating that every later tier slots into.

**Design first (interface-first, per CLAUDE.md):** the `RulesConfig` shape
in `src/types/`, then fixtures, then wire the readers.

---

## Tier 1 — `NumericRule[]` (global value transforms)

**This is "2× all numbers".** A transform over a **closed enum of numeric
channels**, applied at the existing choke points (`getStat`,
`evaluateNumber`, printed-cost reads, damage application).

```ts
interface NumericRule {
  channels: NumericChannel[];
  filter?: CardSelector;       // reuse existing selector vocabulary
  when?: Condition;            // reuse existing condition vocabulary
  op: "add" | "multiply" | "set" | "min" | "max";
  value: NumberExpression;     // reuse existing expression vocabulary
  order?: number;              // tie-break; see layering below
}

type NumericChannel =
  | "printedStrength" | "printedLife" | "printedSpeed" | "printedStructure"
  | "printedInfluence" | "printedCost"
  | "thresholdIconCount"
  | "damageDealt"
  | "influenceDelta"
  | "drawCount"
  | "counterCount"
  | /* ... fixed, engine-owned list ... */;
```

Examples:

- **2× all numbers** — one rule, every channel, `op: "multiply", value: 2`.
- **All characters +1 strength** —
  `channels: ["printedStrength"], filter: { type: "character" }, op: "add", value: 1`.
- **Halve all costs, rounded up** —
  `channels: ["printedCost"], op: "multiply", value: 0.5` (plus a rounding
  rule, or a dedicated `divide`-style op).

Because it reuses `CardSelector` + `Condition` + `NumberExpression`, a
`NumericRule` is testable through the **same synthetic-fixture path as
everything else**.

**Layering (must be specified explicitly):**

- Global numeric rules are the **outermost layer, applied after** all
  card-level `RuntimeModifier`s. "2×" doubles the *effective* stat, not the
  printed one, unless the channel is a `printed*` channel read directly
  (e.g. `cardCost` / `printedStat` expressions).
- Within the global layer: stable sort by `(modIndex, ruleIndex, order)`.
  All `add`s accumulate; `multiply`s compose; last `set` wins; `min` / `max`
  clamp last. Same semantics as the existing `getStat` modifier loop.

**Performance:** `getStat` is hot and already does a `.filter()` per call.
Precompute the applicable-rule list once per frozen mod-set; do not re-scan
`state.mods` per read.

---

## Tier 2 — `GameAttachedRule[]` (reactive rules)

**Almost free — reuses the trigger / replacement / continuous machinery.**

A `GameAttachedRule` is literally a `TriggeredAbility`, `ReplacementAbility`,
or `ContinuousAbility`, except `source` binds to a synthetic "the rules"
pseudo-permanent (or, where "whose rule" matters, to each player's faction
card). `forEachActiveContinuous` and the trigger finder learn to also walk
`state.mods`.

Gets you, as pure data:

- "Whenever you play a tactic, draw a card" — triggered on `cardPlayed`.
- "Whenever a character is destroyed, its controller loses 1 influence."
- "First player to gain 25 total influence wins" — triggered on
  `influenceChanged`, accumulate on a game-scoped counter, end the game.
- Global auras — "all characters have AGGRO" (continuous `keywords` grant
  with an all-matching selector).
- Replacement-style reworks — "if a card would be discarded, void it
  instead."

No new evaluation surface; the effects, conditions, and events already
exist.

---

## Tier 3 — `PolicyOverride` (named strategy swaps)

**This is "blockers like MTG".** Some rules are not a parameter or a
modifier — they are a different *algorithm*. The Spoils uses party-vs-party
combat; MTG-style is per-attacker blocker assignment with damage ordering.
That distinction lives in `declareBlockers` / `assignBattleDamage` /
`finishBattle`, not in any value.

Expose a **fixed registry of policy points**, each with a small set of
engine-shipped implementations:

```ts
interface PolicyOverride {
  policy: PolicyPoint;
  impl: string;          // one of the engine-shipped impls for that point
  params?: Json;
}

type PolicyPoint =
  | "blocking"                 // "party" (default) | "oneToOne"
  | "battleDamageAssignment"   // "speedGroup" (default) | "orderedPerAttacker"
  | "winCondition"             // "influenceZero" (default) | "influenceGained" | ...
  | "priorityModel"
  | "drawForTurn"
  | "deckOut"
  | /* ... engine-owned ... */;
```

`{ policy: "blocking", impl: "oneToOne" }` +
`{ policy: "battleDamageAssignment", impl: "orderedPerAttacker" }` gets the
MTG-style block.

**Consequences:**

- `getFlowView().battle` grows a `model` field so the renderer picks the
  right blocking UI. Additive / optional so it does not break the consumer's
  exhaustive switches.
- New impls are **documented rules** — they must be added to `RULES.md` in
  the same change (per CLAUDE.md).
- **Honest guard rail:** you get the implementations the engine ships. You
  cannot invent a genuinely novel combat structure as pure data. Adding a
  new impl is an engine change, not a mod.

Prove this tier with **one** policy point end-to-end (`blocking`), including
the `getFlowView` surface and a consumer UI adaptation, before generalizing.

---

## Tier 4 — sandboxed expression escape hatch

**Deferred, possibly never. Only if Tiers 0–3 prove insufficient.**

If it happens: not raw JS. Extend `NumberExpression` / `Condition` with a
small formula sub-language (stack machine / spreadsheet-style), evaluated as
a pure `(ctx) => value | boolean`, step-limited, no I/O, RNG only via
`state.rngState`. It computes *values and conditions*, never restructures
control flow.

Why the restriction matters: closures do not survive `structuredClone`,
which both `canPayCosts` (simulate-on-a-clone affordability probe) and
`saveGame` rely on. Staying declarative is what keeps those correct.

---

## Example → tier

| House rule | Tier | Shape |
|---|---|---|
| Hand 10 / 2 develops / no mulligan | 0 | `config` |
| 2× all numbers | 1 | one `NumericRule`, all channels, `multiply 2` |
| All characters +1 strength | 1 | `NumericRule` + `filter: { type: "character" }` |
| Halve all costs | 1 | `NumericRule` on `printedCost` + rounding |
| Play a tactic → draw a card | 2 | `TriggeredAbility` on `cardPlayed` |
| Destroyed character → controller loses 1 influence | 2 | `TriggeredAbility` on `cardDestroyed` |
| First to +25 gained influence wins | 2 or 3 | trigger on `influenceChanged`, or `winCondition` policy |
| Blockers 1:1 like MTG | 3 | `blocking` + `battleDamageAssignment` policies; UI adapts via `getFlowView` |
| Ban list | deck layer | extend `validateDeck` options; not a `GameMod` construct |

---

## Cross-cutting concerns

- **Determinism.** Every tier is a pure function of `(state, action)`. No
  wall clock, no `Math.random`, no fetch. RNG only via `state.rngState`.
- **Guard rails / capabilities.** The consumer passes a capability set —
  e.g. `{ allowPolicyOverrides, allowScript, allowedChannels,
  allowedPolicyPoints }`. `validateMod(mod, capabilities): Diagnostic[]`
  runs at load and rejects unknown enum members / disallowed tiers. An
  invariant no mod below Tier 3 can touch: state-based actions and the win
  check always run.
- **Ordering across mods.** Total order is `(modIndex, ruleIndex, order?)`.
  Documented per op class (accumulate / compose / last-wins).
- **UI discoverability.** Ship a manifest so a consumer can render an
  editor: `MOD_NUMERIC_CHANNELS`, `MOD_POLICY_POINTS` (each with a
  description + allowed impls), per-tier JSON schema, and
  `describeMod(mod): string` (parallels the existing `describeCost`).
- **Consumer breakage.** Consumers may have exhaustive `switch`es over
  engine discriminated unions; a new `PendingChoice` kind or a new
  *required* `GameFlowView` field breaks its typecheck. Keep `GameMod`
  additive and make new `getFlowView` fields optional.
- **RULES.md.** Tier 3 impls are documented rules (update same change).
  Tier 0–2 mods are player-authored deviations — document the *vocabulary*
  in a dedicated "House rules" section, not as inline `(card-verified)`
  claims.
- **Tests.** `buildGame(..., { mods })` fixture parameter. A fixture test
  per numeric channel and per built-in policy impl, checked against
  `RULES.md` where a documented rule is involved.

---

## Recommended build order

1. **MVP = Tier 0 + Tier 1** plus the envelope, `validateMod`, the
   manifest, a `RULES.md` "House rules" section, and fixture support.
   Design `RulesConfig` and `NumericChannel` in `src/types/` first, write
   fixtures, then wire `getStat` / `evaluateNumber` / setup.
2. **Tier 2** as a fast follow — mostly teaching `forEachActiveContinuous`
   and the trigger finder to also walk `state.mods`, plus the "the rules"
   pseudo-source.
3. **Tier 3** only when a structural combat change is actually needed.
   Prove it with `blocking` alone, end-to-end, including `getFlowView` and a
   consumer UI change.
4. **Tier 4** deferred; revisit only if a concrete, worth-it mod is
   impossible under 0–3.

---

## Open questions

- Exact membership of `NumericChannel` — enumerate every numeric read site
  in `SpoilsEngine` and decide which are mod-addressable.
- Whether `winCondition` is better as a Tier 2 reactive rule or a Tier 3
  policy (leaning: policy, so the default is swappable rather than
  additive).
- Whether `RulesConfig` should also be reachable without a full `GameMod`
  (e.g. a bare `setupOverrides` on `FactionGameSetupOptions`) for the
  common "just change hand size" case.
- Per-player vs. global mods — all examples so far are global; confirm
  nothing needs "player A plays with mod X, player B without."
