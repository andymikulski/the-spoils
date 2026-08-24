// -----------------------------------------------------------------------------
// IDs / primitive types
// -----------------------------------------------------------------------------

export type PlayerId = string;
export type CardDefinitionId = string;
export type CardInstanceId = string;
export type AbilityId = string;
export type ModifierId = string;
export type BattleId = string;

export type Trade =
  | "arcanist"
  | "banker"
  | "gearsmith"
  | "rogue"
  | "warlord"
  | "universal"
  | "Universal";

export type Keyword =
  | "tactical"
  | "aggro"
  | "covert"
  /**
   * While attacking and blocked, this character's controller may assign
   * its battle damage to the attack's original target instead of the
   * blocking party (e.g. Raging Bask) — `getLegalBattleDamageTargets`
   * appends that target as an extra option rather than replacing the
   * blockers, since it's "may... instead of," not a forced redirect.
   */
  | "redirectDamage";

/** A boolean combat restriction, granted like a Keyword but never printed statically — always via a `grantRestriction` effect or `ContinuousAbility.restrictions`. */
export type Restriction =
  | "cannotAttack"
  | "cannotBlock";

export type CardType =
  | "character"
  | "item"
  | "location"
  | "tactic"
  | "resource"
  | "faction";

export type Zone =
  | "deck"
  | "hand"
  | "deploying"
  | "play"
  | "discard"
  | "void"
  /** "Removed from the game" (RULES.md §2) — gone; nothing can retrieve it. */
  | "removed";

export type Stat =
  | "strength"
  | "life"
  | "speed"
  | "influence"
  /** A location's damage capacity (RULES.md §3) — distinct from `life`, which locations don't have. */
  | "structure";

export type ComparisonOperator = ">" | ">=" | "=" | "<=" | "<";

export type Duration =
  | { type: "permanent" }
  | { type: "untilEndOfTurn" }
  | { type: "whileSourceInPlay" };

export type ModifierOperation = "add" | "set" | "multiply";
