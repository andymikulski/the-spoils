#!/usr/bin/env node
/* Seed set: author `behavior`/`flipUp`/`unique`/`attachTo`/`resource` onto
 * data/cards.json AND flip the coverage manifest (data/card-coverage.json)
 * to `authored` with shapes/metadata/engineCapability/notes, registering the
 * 8 Seed engine capabilities. Re-runnable. Run `npm run sync-cards` after.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const CARDS = path.join(ROOT, "data", "cards.json");
const COV = path.join(ROOT, "data", "card-coverage.json");
const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
const cov = JSON.parse(fs.readFileSync(COV, "utf8"));
const byId = new Map(cards.map(c => [c.id, c]));
const covById = new Map(cov.cards.map(e => [e.id, e]));

// ---------- shorthand ----------------------------------------------------
const S = id => ({ type: "selected", id });
const CAND = S("__candidate");
const UEOT = { type: "untilEndOfTurn" };
const PERM = { type: "permanent" };
const WSIP = { type: "whileSourceInPlay" };
const USNT = { type: "untilStartOfNextTurn" };
const cmod = (target, stat, operation, value, duration = UEOT) => ({ type: "createModifier", target, stat, operation, value, duration });
const mod = (target, stat, operation, value) => ({ target, stat, operation, value });
const cnt = (target = "source", counter = "token") => ({ type: "counter", target, counter });
const negCnt = (target = "source", counter = "token") => ({ type: "multiply", values: [cnt(target, counter), -1] });
const icons = (icon, player = "controller") => ({ type: "resourceIcons", player, icon });
const iconGate = (icon, n, player = "controller") => ({ type: "numberCompare", left: icons(icon, player), operator: ">=", right: n });
const dmg = (target, amount) => ({ type: "dealDamage", target, amount });
const draw = (amount = 1, player = "controller") => ({ type: "draw", player, amount });
const infl = (amount, player = "controller") => ({ type: "modifyInfluence", player, amount });
const pick = (id, selector, count = 1, extra = {}) => ({ id, selector, count, ...extra });
const grantKw = (target, keyword, duration = UEOT) => ({ type: "grantKeyword", target, keyword, duration });
const suppressKw = (target, keyword, duration = UEOT) => ({ type: "suppressKeyword", target, keyword, duration });
const grantRes = (target, restriction, duration = UEOT) => ({ type: "grantRestriction", target, restriction, duration });
const moveTo = (target, to, extra = {}) => ({ type: "moveCard", target, to, ...extra });
const destroy = target => ({ type: "destroy", target });
const deplete = target => ({ type: "deplete", target });
const restore = target => ({ type: "restore", target });
const addTok = (target = "source", amount = 1, counter = "token") => ({ type: "addCounter", target, counter, amount });
const rmTok = (target = "source", amount = 1, counter = "token") => ({ type: "removeCounter", target, counter, amount });
const factionOf = player => ({ type: "factionOf", player });
const ifExists = (id, effects) => ({ type: "if", condition: { type: "targetExists", target: S(id) }, effects });
const cardCost = target => ({ type: "cardCost", target });
const eventDmg = () => ({ type: "eventDamageAmount" });

const payR = amount => ({ type: "payResources", amount });
const rfg = (target = "source") => ({ type: "removeFromGame", target });

// triggered helpers
const etb = (effects, targets, extra = {}) => ({ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, ...(targets ? { targets } : {}), effects, ...extra });
const leaves = (effects, targets, extra = {}) => ({ id: "leaves", type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }] }, ...(targets ? { targets } : {}), effects, ...extra });
const toDiscardFromPlay = (id, effects, targets, extra = {}) => ({ id, type: "triggered", event: "cardMoved", condition: { type: "and", conditions: [{ type: "sourceIsEventCard" }, { type: "cardMovedFromZone", zone: "play" }, { type: "cardMovedToZone", zone: "discard" }] }, ...(targets ? { targets } : {}), effects, ...extra });
const onAttack = (effects, targets, extra = {}) => ({ id: "on-attack", type: "triggered", event: "characterAttacked", condition: { type: "sourceIsEventCard" }, ...(targets ? { targets } : {}), effects, ...extra });
const onBlock = (effects, targets, extra = {}) => ({ id: "on-block", type: "triggered", event: "characterBlocked", condition: { type: "sourceIsEventCard" }, ...(targets ? { targets } : {}), effects, ...extra });
const onDealBattleDmg = (id, effects, targets, extra = {}) => ({ id, type: "triggered", event: "damageDealt", condition: { type: "sourceIsDamageSource" }, ...(targets ? { targets } : {}), effects, ...extra });
const startTurn = (id, effects, opts = {}) => {
  const conds = [{ type: "eventPlayerIs", player: opts.who || "controller" }];
  if (opts.icon) conds.push(iconGate(opts.icon, opts.n));
  return { id, type: "triggered", event: "turnStarted", condition: conds.length === 1 ? conds[0] : { type: "and", conditions: conds }, ...(opts.targets ? { targets: opts.targets } : {}), effects };
};
const startEachTurn = (id, effects, opts = {}) => ({ id, type: "triggered", event: "turnStarted", ...(opts.targets ? { targets: opts.targets } : {}), effects });

// "you may pick a character. If you do, <thenEffects>"
const mayPick = (id, selector, thenEffects, opts = {}) => ({
  type: "chooserSelectsTarget", chooser: opts.chooser || "controller",
  declaration: { id, selector, count: opts.count || 1, optional: true },
  effects: [ifExists(id, thenEffects)]
});
const oppMayDraw = n => ({ type: "chooserSelectsOption", chooser: "opponent", options: [{ label: "Decline", effects: [] }, { label: "Draw " + n, effects: [draw(n, "opponent")] }] });
const youMayDraw = n => ({ type: "chooserSelectsOption", chooser: "controller", options: [{ label: "Decline", effects: [] }, { label: "Draw " + n, effects: [draw(n, "controller")] }] });
const oppDiscards = (n = 1, random = false) => ({
  type: "chooserSelectsTarget", chooser: random ? "controller" : "opponent",
  declaration: { id: "__od", selector: random ? { owner: "opponent", zone: "hand" } : { owner: "opponent", zone: "hand" }, count: n, optional: false, ...(random ? { random: true } : {}) },
  effects: [{ type: "forEach", selected: "__od", effects: [moveTo(CAND, "discard")] }]
});
const discardFromOppHand = (extraConds = []) => ({
  type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "__dh", selector: { owner: "opponent", zone: "hand", conditions: extraConds }, count: 1, optional: false },
  effects: [{ type: "forEach", selected: "__dh", effects: [moveTo(CAND, "discard")] }]
});
const searchToHand = (sel, opt = true) => ({
  type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "__s", selector: { zone: "deck", owner: "self", ...sel }, count: 1, optional: opt },
  effects: [{ type: "forEach", selected: "__s", effects: [moveTo(CAND, "hand")] }, { type: "shuffleDeck", player: "controller" }]
});
const searchOppDeck = (sel, to) => ({
  type: "chooserSelectsTarget", chooser: "controller",
  declaration: { id: "__so", selector: { zone: "deck", owner: "opponent", ...sel }, count: 1, optional: true },
  effects: [{ type: "forEach", selected: "__so", effects: [moveTo(CAND, to)] }, { type: "shuffleDeck", player: "opponent" }]
});
// RECUR: [icons] — from discard, pay N, exile self, [+picks], effects
const recur = (threshold, pay, effects, targets) => ({
  id: "recur", type: "activated", activationZone: "discard", threshold,
  costs: [payR(pay), rfg("source")].filter(c => !(c.type === "payResources" && c.amount === 0)),
  ...(targets ? { targets } : {}), effects
});
// "[icons][icons]: This card gains X" — repeatable icon-gated pump
const iconPump = (id, threshold, mods) => ({ id, type: "activated", threshold, effects: mods.map(m => cmod("source", m[0], m[1], m[2], PERM)) });
// non-stacking icon-gated static -> continuous
const contIcon = (id, icon, n, modifiers, keywords, suppressKeywords) => {
  const a = { id, type: "continuous", condition: iconGate(icon, n), modifiers: modifiers || [] };
  if (keywords) a.keywords = keywords;
  if (suppressKeywords) a.suppressKeywords = suppressKeywords;
  return a;
};
const mayPayToken = pay => ({ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "mayPay", player: "controller", costs: [payR(pay)], effects: [addTok("source", 1)], elseEffects: [] }] });
const tokenBuff = (id, mods) => ({ id, type: "continuous", condition: { type: "counterCompare", target: "source", counter: "token", operator: ">=", value: 1 }, modifiers: mods });

// ---------- capability registry (all implemented this pass) -------------
const CAPS = {
  "prevent-attack-on-faction": { kind: ["ability", "battle", "state"], spec: "ContinuousAbility.preventsAttackOnFaction?: { player:'self'|'opponent'|'any' } — while the source is in play, declareAttack whose target is the matching faction throws. High Court of Demands, Theocratic Senate of Marduun ('your opponents cannot attack your faction')." },
  "player-attack-limit": { kind: ["ability", "battle", "state"], spec: "ContinuousAbility.attackLimitPerTurn?: NumberExpression + GameState.attackDeclarationsThisTurn (per-player, reset at the start-of-turn point). declareAttack rejects a declaration once the player has declared that many attacks. Narrow Passage ('players can attack only once each turn'). A runInitiatedAttack (Counter Attack) does not count." },
  "must-receive-battle-damage": { kind: ["ability", "battle"], spec: "ContinuousAbility.mustReceiveBattleDamage?: boolean — a battle-damage magnet. getLegalBattleDamageTargets: while >=1 magnet is in the party being assigned into, the legal set is narrowed to the magnets (and the redirectDamage 'assign past blockers' option is dropped). Courageous Paladin." },
  "search-tax": { kind: ["ability", "state"], spec: "ContinuousAbility.searchTax?: { player:'self'|'opponent'|'any'; amount?: NumberExpression } — a player pays `amount` resources each time an effect would have them search their OWN deck (chooserSelectsTarget on an owned-deck selector); an unaffordable tax makes the search do nothing. Department of Rejections." },
  "ability-cost-modifier-opponent-characters": { kind: ["ability", "state"], spec: "ContinuousAbility.abilityCostModifiers scope gains 'opponentCharacters' — adds `delta` to the payResources portion of any activated ability on a character the source-controller's opponent controls, including abilities used while the character is out of play. Department of Rejections ('your opponents must pay 2 to use a character's ability')." },
  "attack-tax-attacker-scope": { kind: ["ability", "battle"], spec: "ContinuousAbility.attackTax gains `player:'activePlayer'` (charge whoever declares the attack) and `requiresAttackerMatch?: CardSelector` (levy only when the declared party contains a matching card). Auspicious Tax ('the attached character's controller must pay 3 to attack with it')." },
  "redirect-attack-target": { kind: ["effect", "battle"], spec: "Effect { type:'redirectAttackTarget', to: TargetRef } — repoints GameState.battle.target at an in-play card and updates defenderPlayerId. Architectural Restitution ('change the target of that attack to the location')." },
  "deploy-for-free-budget": { kind: ["effect", "choice"], spec: "Effect deployForFree gains `budget?: NumberExpression` — a total-cost pool: after each free deploy the choice re-issues with the pool reduced by the deployed card's printed cost, until it is spent / nothing in hand fits / the player declines (or a deployed card's own resolution needs a further choice). Reality Shift." },
  "sum-cost-expression": { kind: ["expression"], spec: "NumberExpression { type:'sumCost', selector: CardSelector } — sum of printed numeric `cost` over every in-play card matching `selector`. Parallel to `sumStat`, but `cost` is a card-definition field not a live stat. 'X is the total numeric cost of all non-resource cards you control' (Reality Shift)." }
};

// ---------- per-card patches -------------------------------------------
// P[id] = { behavior?, flipUp?, unique?, attachTo?, resource?, meta?, shapes:[], caps:[], conf, notes, status }
const P = {};
const V = (id, o) => { P[id] = { status: "verified", conf: "high", caps: [], shapes: [], ...o }; };
const VANILLA = id => { P[id] = { status: "vanilla", vanilla: true }; };
const KW = (id, keywords, extra = {}) => V(id, { behavior: { keywords }, meta: { keywords }, shapes: ["keyword(s): " + keywords.join(", ")], ...extra });

module.exports = { P, V, VANILLA, KW, CAPS, S, CAND, UEOT, PERM, WSIP, USNT, cmod, mod, cnt, negCnt, icons, iconGate, dmg, draw, infl, pick, grantKw, suppressKw, grantRes, moveTo, destroy, deplete, restore, addTok, rmTok, factionOf, ifExists, cardCost, eventDmg, payR, rfg, etb, leaves, toDiscardFromPlay, onAttack, onBlock, onDealBattleDmg, startTurn, startEachTurn, mayPick, oppMayDraw, youMayDraw, oppDiscards, discardFromOppHand, searchToHand, searchOppDeck, recur, iconPump, contIcon, mayPayToken, tokenBuff };

require("./author-seed-data.cjs");

// ---------- apply -----------------------------------------------------
let nCards = 0, nCov = 0;
const capCards = {};
for (const [id, p] of Object.entries(P)) {
  for (const c of p.caps || []) (capCards[c] ??= []).push(id);
}
for (const [id, p] of Object.entries(P)) {
  const card = byId.get(id);
  if (!card) throw new Error("no card for id " + id);
  if (p.behavior !== undefined) card.behavior = p.behavior;
  if (p.flipUp) card.flipUp = p.flipUp;
  if (p.unique !== undefined) card.unique = p.unique;
  if (p.attachTo !== undefined) card.attachTo = p.attachTo;
  if (p.resource !== undefined) card.resource = p.resource;
  nCards++;

  const e = covById.get(id);
  if (!e) throw new Error("coverage missing " + id);
  e.status = p.status;
  e.rulesAudited = true;
  if (p.vanilla) {
    e.behavior = { needed: false, shapes: [], reusesProvenShape: null, newTestNeeded: false };
    e.metadata = { unique: card.unique ?? null, attachTo: card.attachTo ?? null, resourceProvides: card.resource?.provides ?? null, keywords: [] };
    e.engineCapability = [];
    e.parityGaps = [];
    e.confidence = "high";
    e.notes = p.notes || "No rules text needing behavior.";
  } else {
    e.behavior = { needed: true, shapes: p.shapes, reusesProvenShape: p.newShape ? false : true, newTestNeeded: !!p.newShape };
    e.metadata = {
      unique: p.unique ?? card.unique ?? null,
      attachTo: p.attachTo ?? card.attachTo ?? null,
      resourceProvides: (p.resource ?? card.resource)?.provides ?? null,
      keywords: p.meta?.keywords ?? []
    };
    e.engineCapability = p.caps || [];
    e.parityGaps = p.parityGaps || [];
    e.confidence = p.conf || "high";
    e.notes = p.notes || "";
  }
  if (!e.display) e.display = {};
  nCov++;
}

for (const [id, meta] of Object.entries(CAPS)) {
  const existing = cov.capabilities[id];
  cov.capabilities[id] = {
    status: "implemented",
    kind: meta.kind,
    spec: meta.spec,
    cards: [...new Set(capCards[id] ?? existing?.cards ?? [])]
  };
}

fs.writeFileSync(CARDS, JSON.stringify(cards, null, 2) + "\n");
fs.writeFileSync(COV, JSON.stringify(cov, null, 2) + "\n");
console.log(`patched ${nCards} cards.json entries, ${nCov} coverage entries`);
