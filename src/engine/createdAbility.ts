// -----------------------------------------------------------------------------
// The Open R&D Faction: building the ability both players create
// -----------------------------------------------------------------------------
//
// RESEARCH & DEVELOPMENT: "Before the game begins, both players create the
// rules text for an ability. This card has that ability and both players can
// use it." The engine never reads free text. The players agree on one
// `CreatedAbilitySpec` picked from a closed menu (this file's part tables,
// exported as data in `CREATED_ABILITY_MENU`); `buildCreatedAbility` turns it
// into an ordinary `ActivatedAbility` plus rules text generated from the
// parts. One table drives the menu, the validator, the builder and the text,
// so they cannot drift apart.

import type {
  ActivatedAbility,
  CardSelector,
  Cost,
  CreatedAbilityMenu,
  CreatedAbilityMenuEntry,
  CreatedAbilitySpec,
  CreatedCostKind,
  CreatedEffectKind,
  Effect
} from "../types/index.js";

/** The id of the built ability (what `activateAbility.abilityId` names). */
export const CREATED_ABILITY_ID = "created-ability";

const PICK_ID = "created-pick";
const DISCARD_ID = "created-discard";

interface CostPartDef extends CreatedAbilityMenuEntry<CreatedCostKind> {
  min: number;
  max: number;
  defaultAmount: number;
  /** The cost line's text ("Pay 2."). */
  text(n: number): string;
  build(n: number): Cost;
}

interface EffectPartDef extends CreatedAbilityMenuEntry<CreatedEffectKind> {
  /** The effect sentence ("Draw 2 cards."), without the "EFFECT:" prefix. */
  text(n: number): string;
  build(n: number): Effect;
  /** The character the user picks when using the ability (a `targets` entry + a line in the COST text). */
  pick?: { selector: CardSelector; text: string };
}

const picked = { type: "selected", id: PICK_ID } as const;
const cards = (n: number) => (n === 1 ? "a card" : `${n} cards`);
const tokens = (n: number) => (n === 1 ? "a token" : `${n} tokens`);

const COST_PARTS: CostPartDef[] = [
  {
    kind: "pay",
    label: "Pay N",
    min: 1,
    max: 6,
    defaultAmount: 2,
    text: (n) => `Pay ${n}.`,
    build: (n) => ({ type: "payResources", amount: n })
  },
  {
    kind: "loseInfluence",
    label: "Lose N influence",
    min: 1,
    max: 5,
    defaultAmount: 1,
    text: (n) => `Lose ${n} influence.`,
    build: (n) => ({ type: "loseInfluence", amount: n })
  },
  {
    kind: "discardCard",
    label: "Discard N cards from your hand",
    min: 1,
    max: 3,
    defaultAmount: 1,
    text: (n) => `Discard ${cards(n)}.`,
    build: (n) => ({
      type: "discard",
      id: DISCARD_ID,
      player: "controller",
      selector: { owner: "self", zone: "hand" },
      count: n
    })
  }
];

const EFFECT_PARTS: EffectPartDef[] = [
  {
    kind: "draw",
    label: "Draw N cards",
    min: 1,
    max: 3,
    defaultAmount: 1,
    text: (n) => `Draw ${cards(n)}.`,
    build: (n) => ({ type: "draw", player: "controller", amount: n })
  },
  {
    kind: "gainInfluence",
    label: "Your faction gains N influence",
    min: 1,
    max: 3,
    defaultAmount: 1,
    text: (n) => `Your faction gains ${n} influence.`,
    build: (n) => ({ type: "modifyInfluence", player: "controller", amount: n })
  },
  {
    kind: "opponentLosesInfluence",
    label: "Your opponent's faction loses N influence",
    min: 1,
    max: 3,
    defaultAmount: 1,
    text: (n) => `Your opponent's faction loses ${n} influence.`,
    build: (n) => ({ type: "modifyInfluence", player: "opponent", amount: -n })
  },
  {
    kind: "damageCharacter",
    label: "Inflict N damage to a picked character",
    min: 1,
    max: 5,
    defaultAmount: 2,
    picksCharacter: true,
    pick: { selector: { type: "character" }, text: "Pick a character." },
    text: (n) => `Inflict ${n} damage to the picked character.`,
    build: (n) => ({ type: "dealDamage", target: picked, amount: n })
  },
  {
    kind: "restoreCharacter",
    label: "Restore a picked depleted character",
    picksCharacter: true,
    pick: { selector: { type: "character", depleted: true }, text: "Pick a depleted character." },
    text: () => "Restore the picked character.",
    build: () => ({ type: "restore", target: picked })
  },
  {
    kind: "depleteCharacter",
    label: "Deplete a picked character",
    picksCharacter: true,
    pick: { selector: { type: "character", depleted: false }, text: "Pick a character that is not depleted." },
    text: () => "Deplete the picked character.",
    build: () => ({ type: "deplete", target: picked })
  },
  {
    kind: "tokenOnCharacter",
    label: "Put N tokens on a picked character",
    min: 1,
    max: 3,
    defaultAmount: 1,
    picksCharacter: true,
    pick: { selector: { type: "character" }, text: "Pick a character." },
    text: (n) => `Put ${tokens(n)} on the picked character.`,
    build: (n) => ({ type: "addCounter", target: picked, counter: "token", amount: n })
  },
  {
    kind: "lookAtTop",
    label: "Look at the top N cards of your deck and put them back in any order",
    min: 2,
    max: 5,
    defaultAmount: 3,
    text: (n) => `Look at the top ${n} cards of your deck and put them back in any order.`,
    build: (n) => ({ type: "lookAndReorder", player: "controller", count: n })
  },
  {
    kind: "millOpponent",
    label: "Put the top N cards of your opponent's deck into their discard pile",
    min: 1,
    max: 5,
    defaultAmount: 2,
    text: (n) => `Put the top ${n === 1 ? "card" : `${n} cards`} of your opponent's deck into their discard pile.`,
    build: (n) => ({ type: "mill", player: "opponent", count: n, to: "discard" })
  }
];

const COST_LIMITS = { minCosts: 1, maxCosts: 3, uniqueCostKinds: true } as const;

function menuEntry<K extends string>(p: CreatedAbilityMenuEntry<K>): CreatedAbilityMenuEntry<K> {
  return {
    kind: p.kind,
    label: p.label,
    ...(p.min !== undefined ? { min: p.min } : {}),
    ...(p.max !== undefined ? { max: p.max } : {}),
    ...(p.defaultAmount !== undefined ? { defaultAmount: p.defaultAmount } : {}),
    ...(p.picksCharacter ? { picksCharacter: true } : {})
  };
}

/**
 * The closed menu the two players build the ability from, as plain data: part
 * kinds, labels (`N` = the stepper), numeric bounds and the cost-line limits.
 * A UI renders it as dropdowns and steppers and sends back a
 * `CreatedAbilitySpec`; nothing in it is free text.
 */
export const CREATED_ABILITY_MENU: CreatedAbilityMenu = {
  costs: COST_PARTS.map(menuEntry),
  effects: EFFECT_PARTS.map(menuEntry),
  limits: { ...COST_LIMITS }
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkAmount(where: string, def: CreatedAbilityMenuEntry, amount: unknown, errors: string[]): void {
  if (def.min === undefined || def.max === undefined) {
    if (amount !== undefined) errors.push(`${where}: "${def.label}" takes no number.`);
    return;
  }
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    errors.push(`${where}: "${def.label}" needs a whole number from ${def.min} to ${def.max}.`);
  } else if (amount < def.min || amount > def.max) {
    errors.push(`${where}: ${amount} is out of range for "${def.label}" (${def.min} to ${def.max}).`);
  }
}

function checkKeys(where: string, part: Record<string, unknown>, errors: string[]): void {
  for (const key of Object.keys(part)) {
    if (key !== "kind" && key !== "amount") errors.push(`${where}: unknown field "${key}".`);
  }
}

/**
 * Checks a spec against the menu. Returns the list of problems, empty when
 * the spec is valid. Accepts any value (a spec off the wire): unknown kinds,
 * out-of-range or fractional numbers, too few or too many costs, duplicate
 * cost kinds and any field the menu does not define are all reported.
 */
export function validateCreatedAbilitySpec(spec: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(spec)) return ["The ability must be an object with `costs` and `effect`."];
  for (const key of Object.keys(spec)) {
    if (key !== "costs" && key !== "effect") errors.push(`ability: unknown field "${key}".`);
  }

  const { costs, effect } = spec;
  if (!Array.isArray(costs)) {
    errors.push("The ability needs a `costs` list.");
  } else {
    if (costs.length < COST_LIMITS.minCosts) errors.push(`The ability needs at least ${COST_LIMITS.minCosts} cost.`);
    if (costs.length > COST_LIMITS.maxCosts) errors.push(`The ability can have at most ${COST_LIMITS.maxCosts} costs.`);
    const seen = new Set<string>();
    costs.forEach((part: unknown, i) => {
      const where = `cost ${i + 1}`;
      if (!isRecord(part)) {
        errors.push(`${where}: must be an object with a kind and an amount.`);
        return;
      }
      checkKeys(where, part, errors);
      const def = COST_PARTS.find((p) => p.kind === part.kind);
      if (!def) {
        errors.push(`${where}: unknown cost kind ${JSON.stringify(part.kind)}.`);
        return;
      }
      if (seen.has(def.kind)) errors.push(`${where}: "${def.label}" is used twice; each cost can appear once.`);
      seen.add(def.kind);
      checkAmount(where, def, part.amount, errors);
    });
  }

  if (!isRecord(effect)) {
    errors.push("The ability needs exactly one `effect`.");
  } else {
    checkKeys("effect", effect, errors);
    const def = EFFECT_PARTS.find((p) => p.kind === effect.kind);
    if (!def) errors.push(`effect: unknown effect kind ${JSON.stringify(effect.kind)}.`);
    else checkAmount("effect", def, effect.amount, errors);
  }
  return errors;
}

/**
 * Builds the engine-native ability and its generated rules text from a spec.
 * Throws (listing every problem) when the spec is invalid. The ability is
 * always `usableBy: "controllerAndOpponent"` (the two players who created it);
 * "you" in the text is whoever uses it. The
 * text is made only from the menu's own phrases, in the printed-card layout:
 * `COST: Pay 2. Discard a card. Pick a character. EFFECT: ...`.
 */
export function buildCreatedAbility(spec: CreatedAbilitySpec): { ability: ActivatedAbility; text: string } {
  const errors = validateCreatedAbilitySpec(spec);
  if (errors.length > 0) throw new Error(`Invalid player-created ability: ${errors.join(" ")}`);

  const costs = spec.costs.map((p) => ({ def: COST_PARTS.find((d) => d.kind === p.kind)!, amount: p.amount }));
  const effectDef = EFFECT_PARTS.find((d) => d.kind === spec.effect.kind)!;
  const effectAmount = spec.effect.amount ?? 0;

  const ability: ActivatedAbility = {
    id: CREATED_ABILITY_ID,
    type: "activated",
    usableBy: "controllerAndOpponent",
    costs: costs.map(({ def, amount }) => def.build(amount)),
    ...(effectDef.pick ? { targets: [{ id: PICK_ID, selector: structuredClone(effectDef.pick.selector), count: 1 }] } : {}),
    effects: [effectDef.build(effectAmount)]
  };

  const costText = [...costs.map(({ def, amount }) => def.text(amount)), ...(effectDef.pick ? [effectDef.pick.text] : [])];
  const text = `COST: ${costText.join(" ")} EFFECT: ${effectDef.text(effectAmount)}`;
  return { ability, text };
}
