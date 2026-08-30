# SotDE authoring brief (shared by all authoring slices)

You are writing the `behavior` JSON for classified Shade of the Devoured
Emperor cards. Read this, then your slice file, then produce the output.

## Sources (read these)

- `BEHAVIORS.md` — the authoring vocabulary index + recipes. Authoritative.
- `src/types/{cards,costs,conditions,effects,expressions,ids}.ts` — the exact
  type shapes. When BEHAVIORS.md and the types disagree, the types win.
- `RULES.md` + `docs/*.pdf` (CR / FAQ) — for any ruling question.
- Existing authored cards in `data/cards.json` for sets "Seed 2" / "Seed 3"
  — copy their idioms (search: `grep -l` won't help; use the Read tool on
  `data/cards.json` around a card, or `node -e` to print one).

## New vocabulary added for this set (NOT yet in BEHAVIORS.md)

Conditions:
- `{ "type": "isActivePlayer", "player"?: PlayerRef }` — true when that
  player (default "controller") is the active player. "during your turn".
- `{ "type": "battleActive" }` — true while a battle is in progress. Wrap in
  `not` for "not during a battle".
- `{ "type": "cardSubtypeIs", "target": TargetRef, "subtype": string }` —
  target's printed subtype list includes `subtype` ("a 'dragon'", "a 'gear'
  card").
- `{ "type": "inPlaySinceTurnStart", "target"?: TargetRef }` — target
  (default source) has been in play under its controller since turn start.
- `{ "type": "uniqueIs", "target": TargetRef, "designations": string[] }` —
  target's `CardDefinition.unique` is one of `designations`.

Expressions:
- `{ "type": "sumStat", "selector": CardSelector, "stat": Stat }` — sum of a
  live stat over matching in-play cards.
- `{ "type": "thresholdIconCount", "target": TargetRef }` — number of
  threshold icons in a card's printed threshold.
- `{ "type": "eventDamageAmount" }` — the amount of the current `damageDealt`
  trigger's damage.

Refs:
- PlayerRef `{ "type": "controllerOf", "target": TargetRef }` — a card's
  current controller (parallel to `ownerOf`).
- TargetRef `{ "type": "damageSource" }` — the source card of the current
  `damageDealt` event (vs. `"eventCard"` = what was damaged).

Selector:
- `CardSelector.uniqueDesignation?: string | string[]` — match by Unique
  designation.

## Conventions

- Ability ids: kebab-case, unique within the card, stable
  (`<cardslug>-<clause>`), e.g. `"anxious-imp-obsess"`.
- `.js` import extension rule does not apply — this is JSON data.
- A **tactic**'s first `activated`-shaped ability in `behavior.abilities`
  carries play-time `targets` / `costs` / `condition` (EXTRA COST) +
  `effects`. Non-tactic permanents use `behavior.onPlay` for the same.
- FLIP UP → `card.flipUp: { cost, threshold, effects? }` as a sibling of
  `behavior` (patch it via the `cardPatch` field, see Output).
- `unique` / `attachTo` are also card-level siblings — set via `cardPatch`.
- Micromajig token: `{ "name": "Micromajig", "cardType": "character",
  "subtype": ["micromajig"], "strength": 0, "life": 1, "speed": 1 }`
  (matches Seed 3 authoring).
- "gains COVERT this turn" → `grantKeyword` untilEndOfTurn. Static bare
  keyword line → `behavior.keywords`.
- "[X][X][X][X][X][X]: gains ..." (Volition-era icon paragraph) →
  `continuous` with `condition` a `numberCompare` of `resourceIcons` vs a
  literal, `modifiers` the stat bumps.
- "enters play with N tokens" → a `triggered` `cardEnteredPlay` +
  `sourceIsEventCard` + `addCounter`.
- Prefer the classification `shapes` in your slice file — they are the
  intended design. If a shape looks wrong against the printed text or
  RULES.md, follow the text and note the deviation.

## Output

Write `.work/author-<N>.json` (N = your slice number), an object keyed by
card id:

```json
{
  "<card-id>": {
    "behavior": { ...the full behavior block... },
    "cardPatch": { "unique": "eustace", "flipUp": { "cost": 2, "threshold": "vvvv" } },
    "notes": "anything the merger should know; deviations from the shapes"
  }
}
```

- `behavior` is required (may be `{ "keywords": [...] }` only).
- `cardPatch` optional — only `unique`, `attachTo`, `flipUp`,
  `revealFromHand`, `selfDisposition` belong there.
- Do NOT edit `data/cards.json`, `data/card-coverage.json`, or any engine /
  test file. Your only write is `.work/author-<N>.json`.
- Every `type:` tag you use must exist in `src/types/*` (the integrity test
  enforces this). When unsure a tag exists, grep the types.

## Final message

Report: how many cards authored, any card you could NOT author faithfully
(and why), and any capability gap you hit that the classification missed.

## ROUND 2 — additional new vocabulary (all implemented, use freely)

Conditions:
- `assignedDamageThisTurn { target? }` — target has inflicted any damage this turn (wrap in `not`).
- `inflictedDamageToFactionThisTurn { player, target? }` — target damaged `player`'s faction this turn.

Effects:
- `grantProvides { target, icon: ResourceIcon | { fromNamed: string }, amount, duration }` — "this turn, this card gains PROVIDES: [X]".
- `reduceThreshold { player, icon: ResourceIcon | { fromNamed }, amount }` — reduce the NEXT deploy's threshold requirement by N of that icon this turn.
- `nameValue.valueKind` may be `"resourceIcon"` (name one of rage/greed/deception/elitism/obsession/volition), read by grantProvides/reduceThreshold `{ fromNamed }`.
- `removeCardType { target, cardType }` — clear a type added by setCardType.
- `restrictPlay { player, kind: "cardType" | "flipUp", cardType?, duration }` — "that player cannot play <type> / cannot FLIP UP this turn".
- `addToBattle { target, side: "attacking" | "blocking" }` — insert an in-play character into the current battle party (wrap 2 in a chooserSelectsOption for "attacking or blocking").
- `skipRestoreRule { player, turns? }` — skip `player`'s next N faction Restore Rules whole.
- `skipNextRestore { target }` — one-shot: that card misses its controller's next restore.
- `modifyNumericCost { target, delta, duration }` — "this turn, the character loses/gains N numeric cost".
- `modifyOutgoingDamage { source, delta, duration }` — reduce/boost damage dealt BY `source` this turn (Sockem Bot).
- `chooserSelectsNumber { chooser, storeAs, min?, max?, effects }` — a non-acting player picks X, bound into `effects`.
- `alternatingPayLoop { first, opponent, cost, maxRounds?, onEnd }` — alternately offer `cost`; tally into `context.variables["paid:"+playerId]`; `onEnd` reads them (Negotiation Ceremonies).
- `anyPlayerMayPay { costs, effects }` — first player (active first) to accept pays + runs `effects` (Recycling Scheme Facility).
- `createTokens.effects?` — per-created-token follow-up, token bound to `{selected id:"__candidate"}` (shield a made Micromajig).
- `putIntoPlay.borrowed?` — remove the card from the game if it would leave play, and at end of turn (Barracks GO TIME).
- `deployFromZone.free?: boolean | Condition` — pay the card's own cost unless the condition holds (Gang Weapon Dealer "cost 4 or less -> free": `free` = `numberCompare(cardCost of __candidate <= 4)`).

Continuous ability fields:
- `suppressAllAbilities?: { target?, selector? }` — target/selector cards lose every OTHER ability, keep only this one ("loses all other rules text"; Mittens' "has no rules text").
- `redirects?: [{ from, to }]` — all damage AND all leave-play of `from` happens to `to` instead (6r4wny 60dy9u4rd5: `from` a `{remembered}` pick, `to: "source"`).
- `damageModifiers[].sourceSelector?` — also require the damage DEALER to match (Enlightened Mau).
- `activeZone?: Zone` — the continuous ability (its `keywords` grants) is live while source is in that zone; `"hand"` for TACTICAL-in-hand (Parkour, Gloamspike aura with a `zone: "hand"` selector).
- `grantedAbilities` now also wires `activated` bodies (Jo Ciendeilio "each character you control gains 'RESEARCH — ...'").

Restrictions (via continuous `restrictions` / `grantRestriction`):
- `cannotBePicked` — removed from target-declaration candidate pools (not from forEach/count).
- `attackOncePerTurn` — declareAttack rejects a 2nd attack by that character this turn.
- `cannotBeTakenControl` — takeControl to a different controller fizzles.

Events (triggered `event`):
- `counterChanged` — fires when an addCounter/removeCounter changes a card's counter; gate with `counterCompare` on `source` + `sourceIsEventCard` ("when there are no tokens on this card, destroy it").
- `attackerBlocked` — "when this card is blocked"; `sourceIsEventCard` on the attacker. Party size via `count { zone play, type character, conditions:[inBattle role blocker] }`.

Card-def siblings:
- `behavior.modes: [{ label?, condition?, costs?, targets?, variables?, variableBounds?, effects? }]` — a modal tactic; the `playCard` action carries `mode: N`. Only that mode's block applies. Use for "Choose one of the following as this card's rules text".
- `behavior.onPlay.costAdjust?: NumberExpression` — add (negative) to the numeric cost paid, floored at 0, evaluated in the play context (Opportunistic Pirate: `multiply(selectionCount("removed"), -1)`).
- `behavior.noResponse?: true` — the tactic resolves with no opponent response window (Swindle).
- `revealFromHand.threshold?` + `revealFromHand.effects?` — an icon gate + rider effects for a FINE PRINT reveal deploy (Unexpected Codicil).

PlayerRef `{ type: "controllerOf", target }`; TargetRef `{ type: "damageSource" }`; NumberExpr `sumStat`/`thresholdIconCount`/`eventDamageAmount`; CardSelector `uniqueDesignation`; Conditions `isActivePlayer`/`battleActive`/`cardSubtypeIs`/`inPlaySinceTurnStart`/`uniqueIs` — as in round 1.
