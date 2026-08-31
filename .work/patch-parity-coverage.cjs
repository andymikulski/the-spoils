// One-off: fold the five resolved "medium" parity gaps into the coverage
// manifest — register their engine capabilities as implemented, drop the
// parityGaps registry entries, and update the 8 affected card entries.
// Safe to delete after `node scripts/build-coverage.cjs` has run.
const fs = require("fs");
const P = "data/card-coverage.json";
const m = JSON.parse(fs.readFileSync(P, "utf8"));

Object.assign(m.capabilities, {
  "card-ignores-source-class": {
    status: "implemented",
    kind: ["ability", "condition", "engine"],
    cards: ["Parkour Hoodlum"],
    rulesRef: "RULES.md §3.8",
    spec:
      "ContinuousAbility.ignoresRulesTextFrom?: CardType. While the source is in play (and condition holds) it cannot be PICKED as a target by a card of that type (targetCandidates filter, scoped on the resolving source's card type), and a single-target mutating effect (SOURCE_CLASS_GUARDED_EFFECTS) or a continuous aura whose origin is a card of that type is a no-op against it. Aggregate all-X / count effects still see it. 'This card ignores all rules text on locations' — Parkour Hoodlum. Not modelled: cost / damage-amount modifiers from an ignored source (edge)."
  },
  "cross-faction-rule-override": {
    status: "implemented",
    kind: ["cards", "engine"],
    cards: ["The Knitting Coalition"],
    rulesRef: "RULES.md §3.6",
    spec:
      "FactionDefinition.overridesOpponent?: { startingDraw?: boolean; suppressDevelop?: boolean } — while this faction card is in play it rewrites sub-rules of the OPPONENT's faction. startingDraw: the opponent's opening hand uses THIS faction's setup.openingHand (createTwoPlayerFactionGame). suppressDevelop: getDevelopChoices returns [] for the opponent. The Knitting Coalition — HIDDEN INFLUENCE / PULLING STRINGS. 2-player only."
  },
  "mixed-starting-resources": {
    status: "implemented",
    kind: ["cards", "engine"],
    cards: ["The Society of Magical Propriety", "The Union of Unextraordinary Miners"],
    rulesRef: "RULES.md §3.1",
    spec:
      "FactionDefinition.setup.startingResources gains: slots (per-slot program — a resource slot places a face-up resource, an anyCard slot places any card, face-down if it is not a resource; The Society of Magical Propriety), chosenStaples ({ min, max, plus? } — X staples chosen at setup via FactionGameSetupOptions.startingResourceX, clamped to [min, max], default min, plus fixed extras; The Union of Unextraordinary Miners MONEY FOR NOTHING), matchOpponentCount (top the OPPONENT up with staples to equal this faction's starting-resource count). Cards drawn in deck order like the flat form; player does not choose which staple / card."
  },
  "opponent-may-pay-to-counter": {
    status: "implemented",
    kind: ["effect", "choice"],
    cards: ["Study Disturbance", "Tedious TriAdic Truculence"],
    rulesRef: "RULES.md §7",
    spec:
      "Modelled with the existing mayPay effect: the tactic's real body is elseEffects, the buyout is effects (a peek — empty for Study Disturbance, lookAndReorder for Tedious TriAdic Truculence). Engine fixes: (1) mayPay now charges the RESOLVED effect.player's resources ('that player may pay 2', 'any opponent may pay 3'), mirroring anyPlayerMayPay; (2) lookAndReorder gains chooser?: PlayerRef so 'any opponent looks at the top 3 cards of YOUR deck and reorders them' works. CONCESSION: the buyout is offered on resolution (after a response window), not truly pre-stack; immaterial for these two cards."
  },
  "develop-draw-replacement": {
    status: "implemented",
    kind: ["cards", "effect"],
    cards: ["Arcane Escrow"],
    rulesRef: "RULES.md §6",
    spec:
      "CardDefinition.behavior.developDrawReplacement?: { cost?: Cost[]; effects: Effect[] } — while the developing player controls an in-play card carrying it, choosing the draw develop option runs a mayPay (player = developer, costs = cost, effects = replacement.effects, elseEffects = the draw) instead of drawing. 'If you would draw a card as part of your Develop Rule, you may put a card voided by this card into its owner's hand instead' — Arcane Escrow (modelled as 'a card in your void'; void-origin not tracked)."
  },
  "deck-search-trigger": {
    status: "implemented",
    kind: ["event"],
    cards: ["Golden Charm"],
    rulesRef: "RULES.md §12",
    spec:
      "New GameEvent deckSearched { playerId } — emitted when a chooserSelectsTarget effect raises a pick whose declaration selector names the deck zone (playerId = the deck owner). The pick is already the outstanding choice, so processImmediateQueue defers the trigger; it resolves right after the search completes. Golden Charm — 'If a player would search their deck you may pay 1 ... draw a card' (net: the interceptor may pay 1 to draw 1; the search proceeds). Scope: only chooserSelectsTarget-based deck picks emit it."
  }
});

for (const id of [
  "card-ignores-source-class",
  "cross-faction-rule-override",
  "mixed-starting-resources",
  "opponent-may-pay-to-counter",
  "search-and-develop-draw-interception"
]) {
  delete m.parityGaps[id];
}

const card = name => {
  const c = m.cards.find(x => x.name === name);
  if (!c) throw new Error("missing coverage entry " + name);
  return c;
};

let c;

c = card("Study Disturbance");
c.parityGaps = [];
c.engineCapability = ["player-play-restriction", "opponent-may-pay-to-counter"];
c.confidence = "medium";
c.behavior.shapes = [
  "tactic: targets [{p: faction count 1}]; effect mayPay(player = controllerOf(p), pay 2 -> [] i.e. 'terminate this card'; elseEffects: restrictPlay(controllerOf(p), character, EOT) + draw 1)"
];
c.behavior.reusesProvenShape = false;
c.behavior.newTestNeeded = true;
c.notes =
  "opponent-may-pay-to-counter resolved: 'EXTRA COST: pick a player; that player may pay 2 -> look at top card + terminate this card' is a mayPay whose elseEffects are the real body (restrictPlay + draw). Engine fix: mayPay now charges the resolved effect.player. The pre-stack timing of the buyout is approximated as an on-resolution mayPay.";

c = card("Tedious TriAdic Truculence");
c.parityGaps = [];
c.engineCapability = ["opponent-may-pay-to-counter"];
c.confidence = "medium";
c.behavior.shapes = [
  "tactic: targets [{picks: character count 3}]; effect mayPay(player = opponent, pay 3 -> lookAndReorder(player controller, chooser opponent, count 3); elseEffects: forEach picks -> if(strength <= 3) destroy)"
];
c.behavior.reusesProvenShape = false;
c.behavior.newTestNeeded = true;
c.notes =
  "opponent-may-pay-to-counter resolved as a mayPay (player: opponent) whose elseEffects are the mass-destroy body; the buyout branch uses lookAndReorder with the new chooser: opponent ('any opponent looks at the top 3 cards of YOUR deck and reorders them'). Buyout timing approximated as on-resolution.";

c = card("Arcane Escrow");
c.parityGaps = [];
c.engineCapability = ["develop-draw-replacement"];
c.confidence = "medium";
c.behavior.shapes = [
  "replacement: replaces {moveToZone, zone discard, controlledBy self} optional -> moveCard(__candidate, void)",
  "behavior.developDrawReplacement: { effects: [chooserSelectsTarget over {owner self, zone void} optional -> if(targetExists) moveCard(v, hand)] }",
  "activated WITHDRAW: costs [payResources 1] -> draw 1; chooserSelectsTarget discard x2",
  "card.flipUp { cost: 1, threshold: gg }"
];
c.behavior.reusesProvenShape = false;
c.behavior.newTestNeeded = true;
c.notes =
  "develop-draw-replacement resolved: 'if you would draw a card as part of your Develop Rule, you may put a voided card into hand instead' is behavior.developDrawReplacement (a mayPay wrapper around a void->hand pick, with the draw as elseEffects). Modelled as 'a card in your void' — the this-card-voided-it origin is not tracked.";

c = card("Golden Charm");
c.parityGaps = [];
c.engineCapability = ["unique-designation-selector", "deck-search-trigger"];
c.confidence = "medium";
c.behavior.shapes = [
  "triggered {event deckSearched} -> mayPay(controller, pay 1 -> draw 1)",
  "activated SERAPHIM FUSION: costs [payResources 4, destroy source], targets [{e: {controller self, zone play, type character, uniqueDesignation eustace}}, {s: {zone deck, name 'Siluriformes Flaxenscale'} optional}] -> if(targetExists s) putIntoPlay(s, controller) + shuffleDeck"
];
c.behavior.reusesProvenShape = false;
c.behavior.newTestNeeded = true;
c.notes =
  "search-interception resolved via the new deckSearched event: 'if a player would search their deck you may pay 1 -> draw a card, then they search instead' is a deckSearched trigger -> mayPay(pay 1 -> draw 1). Net effect (interceptor draws 1 for 1; the search still happens) matches; the 'instead' ordering is not observable. Only chooserSelectsTarget deck picks emit the event.";

c = card("Parkour Hoodlum");
c.parityGaps = [];
c.engineCapability = [
  "continuous-from-hand",
  "untargetable",
  "dynamic-tactical-honored",
  "card-ignores-source-class"
];
c.confidence = "medium";
c.behavior.shapes = [
  "continuous(activeZone hand): condition numberCompare(count{zone play, type location} >= 1) -> keywords [{target source, tactical}]",
  "continuous: ignoresRulesTextFrom 'location' — cannot be picked by a location, and single-target location effects / location auras do not affect it"
];
c.behavior.reusesProvenShape = false;
c.behavior.newTestNeeded = true;
c.notes =
  "card-ignores-source-class resolved: 'this card ignores all rules text on locations' is ContinuousAbility.ignoresRulesTextFrom: 'location' — targetCandidates drops it when the picking source is a location, and SOURCE_CLASS_GUARDED_EFFECTS + the continuous-aura recompute loops skip it when the origin is a location. Aggregate all-X effects still see it. Cost / damage-amount modifiers from a location are the remaining edge, noted in the capability.";

c = card("The Knitting Coalition");
c.parityGaps = [];
c.engineCapability = ["faction-abilities", "cross-faction-rule-override"];
c.notes =
  "EPIC faction. Influence 28, 3/4 opening hand, 2 Greed starting resources, standard restore + develop. INFLATIONARY FORCES DRAW / RESOURCE authored usableBy:'anyPlayer'. cross-faction-rule-override resolved: HIDDEN INFLUENCE + PULLING STRINGS are faction.overridesOpponent { startingDraw: true, suppressDevelop: true } — the opponent's opening hand uses this card's openingHand and the opponent has no Develop Rule.";

c = card("The Society of Magical Propriety");
c.parityGaps = [];
c.engineCapability = [
  "faction-abilities",
  "faction-start-of-turn-effects",
  "mixed-starting-resources"
];
c.notes =
  "EPIC faction. Influence 30, 10/9 opening hand, restore-all + detach, standard develop. Abilities: DRAW (pay 3), RESOURCE (pay 3), ENCYCLOPEDIC KNOWLEDGE ([O][O]; remove 3 tokens -> search deck for a tactic -> hand). mixed-starting-resources resolved: 'Any 1 resource, Any 1 card (face-down if not a resource)' is startingResources.slots [{kind:resource},{kind:anyCard}]. APPROXIMATIONS: the player does not choose WHICH resource / card (deck order, like every other faction); 'you may put a token on this card when you develop' is still an automatic startOfTurnEffects token; 300-card minimum deck is a deckbuilding rule.";

c = card("The Union of Unextraordinary Miners");
c.parityGaps = [];
c.engineCapability = ["faction-abilities", "develop-uses-per-turn", "mixed-starting-resources"];
c.notes =
  "EPIC faction. Influence 22, 5/6 opening hand, restore-all + detach. OVERTIME = develop.usesPerTurn: 2. Abilities: DRAW (pay 4), RESOURCE (pay 5). mixed-starting-resources resolved: MONEY FOR NOTHING is startingResources.chosenStaples { min: 1, max: 10, plus: ['Deception'] } + matchOpponentCount. X is supplied via FactionGameSetupOptions.startingResourceX (default = min = 1); the opponent is topped up with staples to the same count.";

fs.writeFileSync(P, JSON.stringify(m, null, 2) + "\n");
console.log("patched coverage manifest");
