#!/usr/bin/env node
/* Merge .work/classify-um-all.json into data/card-coverage.json:
 *  - flip each Ungodly Mess card to its classified/vanilla/wontImplement entry
 *  - register every referenced engine capability in `capabilities`
 * Re-runnable. Writes JSON.stringify(_, null, 2) + "\n". */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const COV = path.join(ROOT, "data", "card-coverage.json");

const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
const covById = new Map(cov.cards.map(e => [e.id, e]));
const entries = JSON.parse(
  fs.readFileSync(path.join(ROOT, ".work", "classify-um-all.json"), "utf8")
);

// --- capability registry: id -> {kind, spec}. All start `unimplemented`; the
//     engine pass flips each to `implemented` as it lands. ------------------
const CAPS = {
  "conditional-threshold-slack": {
    kind: ["cards"],
    spec: "CardDefinition.thresholdSlack?: { condition: Condition; amount: number }. FEALTY (blade of questionable morality cycle): while `condition` holds (evaluated with the card in hand, controller = its holder), meetsThreshold for THIS card is satisfied if the holder is at most `amount` icons short summed across all icon types — 'reduce this card's threshold requirement by any N resource icons' as pure count slack. Threaded through deployCard / getCardPlayability. Abram Ka-darbo Alkazin (x2), Eustace Sensible Glutton, Ignatious Tactician Crafter, Jo Ciendeilio Iron Born, Rudo Mangod Fightful Adonis.",
  },
  "distinct-count-expression": {
    kind: ["expression"],
    spec: "NumberExpression { type:'distinctCount', selector: CardSelector, by:'name'|'trade'|'subtype'|'type' } = the number of DISTINCT values of `by` among cards matching `selector` (in-play by default; respects selector.zone). 'for each different staple resource you control' (Elite Acrolos Engineer, Zenobia's Intervention, Whistleblower Policy — by:name), 'different trades among cards you control' (Wary Reunion — by:trade), 'different staple resources that player controls' (Thabbashite Penumbra, Flesh Deliquesce, Wasted Wickedness). Also composes the FEALTY threshold-slack condition.",
  },
  "resource-attachment-selector": {
    kind: ["selector"],
    spec: "CardSelector.attachedToFaction?: boolean — true matches resources whose CardInstance.attachedTo points at a faction card; false matches detached resources (attachedTo unset). 'the number of detached resources that player controls' (Flesh Deliquesce — false), 'detach up to 2 resources from their faction' target pools (Quotidian Quagmire, Extremely Tiny Bonnet — true).",
  },
  "granted-continuous-ability": {
    kind: ["ability"],
    spec: "Gather the continuous / restriction / keyword / modifier members of a ContinuousAbility.grantedAbilities block in the continuous recompute, sourced on the RECIPIENT card (so 'All your characters gain 1 strength' inside the granted text scopes to the recipient's controller, and the aura dies with the recipient or the grantor). Parallel to the existing granted-triggered and granted-activated paths (getEffectiveContinuousAbilities helper feeding getContinuousModifiers / getContinuousKeywordGrants / getContinuousRestrictionGrants / getContinuousKeywordSuppressions). God's Blessing of Boost / Foresight / Moola / Readiness / Transfiguration.",
  },
  "blocker-selector-restriction": {
    kind: ["ability", "battle"],
    spec: "ContinuousAbility.blockRestriction gains blockerMustNotMatch?: CardSelector — a character matching that selector is not a legal blocker against the source (enforced in declareBlockers alongside the existing minBlockingPartySize / minBlockerSpeed). 'cannot be blocked by characters with a [V] icon in its rules text' (Feckless Chronicler — conditions:[textMentionsIcon volition]), 'Characters with a token on them cannot block this card' (Silencer — conditions:[counterCompare token >= 1]).",
  },
  "continuous-void-play": {
    kind: ["ability", "state"],
    spec: "ContinuousAbility.voidPlay?: { selector: CardSelector; ignoreThreshold?: boolean } — while the source is in play and `condition` holds, the controller may deploy cards matching `selector` (e.g. {zone:'void', type:'tactic', owner:'self'}) as though from hand; consulted in deployCard's void-grant lookup. The continuous / conditional form of the one-shot grantVoidPlay effect. 'While this card is depleted, you may deploy tactics in the void as though they were in your hand without meeting their threshold' (Voidal Tactician).",
  },
  "continuous-play-restriction": {
    kind: ["ability", "state"],
    spec: "ContinuousAbility.playRestrictions?: Array<{ player:'self'|'opponent'|'any'; kind:'flipUp' | { cardType: CardType }; timing?:'notActivePlayer' }> — the standing / conditional form of the one-shot restrictPlay effect, consulted by assertCanDeployAtCurrentTiming / the flipUp action while the source is in play. 'Your opponents cannot use FLIP UP' (Lockbox of the Aeons), 'Your opponents may only play tactics during their own turn' (Geldale City-Fortress — kind:{cardType:'tactic'}, timing:'notActivePlayer').",
  },
  "continuous-return-to-hand-restriction": {
    kind: ["ability", "state"],
    spec: "ContinuousAbility.restrictReturnToHand?: { player:'self'|'opponent'|'any'; fromZones: Zone[] } — while the source is in play, a card owned by `player` cannot be moved to a hand from any zone in `fromZones` (the moveCard / terminate to:'hand' path checks it and the move simply fails). 'cards cannot be put into your opponents' hands from the void, discard pile or play' (Lockbox of the Aeons).",
  },
  "prevent-all-damage-window": {
    kind: ["effect", "state"],
    spec: "Effect { type:'preventAllDamage', duration: Duration } + a GameState runtime window list consulted in every damage-inflict path (reduce the amount to 0). 'This turn ... all inflicted damage is reduced to 0.' (Limited Liability). Distinct from per-source modifyOutgoingDamage and per-card preventDamage.",
  },
  "restrict-destruction-window": {
    kind: ["effect", "state"],
    spec: "Effect { type:'restrictDestruction', duration: Duration } + a GameState runtime window — while active, the `destroy` effect is a no-op (destruction paid as a COST still goes through, per 'can only be destroyed by costs'). 'This turn, cards in play and cards deployed can only be destroyed by costs.' (Limited Liability).",
  },
};

const capCards = {};
for (const e of entries) {
  for (const id of e.engineCapability ?? []) (capCards[id] ??= []).push(e.id);
}

let flipped = 0;
for (const e of entries) {
  const cur = covById.get(e.id);
  if (!cur) throw new Error(`coverage has no entry for ${e.id} (${e.name})`);
  cur.status = e.status;
  cur.rulesAudited = true;
  cur.behavior = e.behavior;
  cur.metadata = e.metadata;
  cur.engineCapability = e.engineCapability ?? [];
  cur.parityGaps = e.parityGaps ?? [];
  cur.confidence = e.confidence ?? null;
  cur.notes = e.notes ?? "";
  if (!cur.display) cur.display = {};
  flipped++;
}

for (const [id, meta] of Object.entries(CAPS)) {
  const existing = cov.capabilities[id];
  cov.capabilities[id] = {
    status: existing?.status ?? "unimplemented",
    kind: meta.kind,
    spec: meta.spec,
    cards: [...new Set(capCards[id] ?? existing?.cards ?? [])],
  };
}

fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
console.log(`flipped ${flipped} coverage entries`);
const unimpl = Object.entries(cov.capabilities).filter(([, c]) => c.status !== "implemented");
console.log(`capabilities not yet implemented (${unimpl.length}):`, unimpl.map(([k]) => k).join(", "));
