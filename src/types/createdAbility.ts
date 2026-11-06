// -----------------------------------------------------------------------------
// The Open R&D Faction: the ability both players create (closed menu)
// -----------------------------------------------------------------------------
//
// "Before the game begins, both players create the rules text for an ability."
// The players do not type anything. They agree on ONE `CreatedAbilitySpec`,
// picked from the fixed menu `CREATED_ABILITY_MENU` (src/engine/createdAbility.ts),
// and the engine builds the real ability and its rules text from it
// (`buildCreatedAbility`). A spec is plain JSON, so it can be pinned in an
// online match's setup and replayed.

/** What a player may pay to use the created ability. */
export type CreatedCostKind = "pay" | "loseInfluence" | "discardCard";

/** What the created ability does. */
export type CreatedEffectKind =
  | "draw"
  | "gainInfluence"
  | "opponentLosesInfluence"
  | "damageCharacter"
  | "restoreCharacter"
  | "depleteCharacter"
  | "tokenOnCharacter"
  | "lookAtTop"
  | "millOpponent";

/** One cost line, e.g. `{ kind: "pay", amount: 2 }` = "Pay 2." */
export interface CreatedCostPart {
  kind: CreatedCostKind;
  amount: number;
}

/**
 * The effect, e.g. `{ kind: "damageCharacter", amount: 2 }`. `amount` is
 * present exactly when the menu entry for `kind` has a range (restore /
 * deplete take none).
 */
export interface CreatedEffectPart {
  kind: CreatedEffectKind;
  amount?: number;
}

/**
 * The structured ability the two players agree on: one to three different
 * cost lines (at least one) and exactly one effect. "You" in the generated
 * text is whoever uses the ability (it is usable by both players).
 */
export interface CreatedAbilitySpec {
  costs: CreatedCostPart[];
  effect: CreatedEffectPart;
}

/** One selectable row of the menu (cost or effect), for rendering a dropdown + stepper. */
export interface CreatedAbilityMenuEntry<K extends string = string> {
  kind: K;
  /** What to show in the dropdown, with `N` standing for the stepper value ("Pay N"). */
  label: string;
  /** Stepper bounds (inclusive); absent = the part takes no number. */
  min?: number;
  max?: number;
  /** A good starting stepper value. */
  defaultAmount?: number;
  /** The part makes the user pick a character when it is used (so the UI can say so). */
  picksCharacter?: boolean;
}

export interface CreatedAbilityMenu {
  costs: ReadonlyArray<CreatedAbilityMenuEntry<CreatedCostKind>>;
  effects: ReadonlyArray<CreatedAbilityMenuEntry<CreatedEffectKind>>;
  limits: {
    /** Fewest / most cost lines. */
    minCosts: number;
    maxCosts: number;
    /** Each cost kind may appear at most once. */
    uniqueCostKinds: boolean;
  };
}
