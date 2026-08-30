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
   * "Cannot be blocked" (CR §412). While every member of a battle party
   * has this keyword, the defending player may not declare a blocking
   * party at all. Effects that *add* a character into the blocking party
   * still work.
   */
  | "cannotBeBlocked"
  /**
   * While attacking and blocked, this character's controller may assign
   * its battle damage to the attack's original target instead of the
   * blocking party (e.g. Raging Bask) — `getLegalBattleDamageTargets`
   * appends that target as an extra option rather than replacing the
   * blockers, since it's "may... instead of," not a forced redirect.
   */
  | "redirectDamage"
  /**
   * "Can block COVERT parties" (Recyclable Golem). A character with this
   * keyword counts as Covert for the purpose of *blocking* an all-Covert
   * attacking party only (it is not otherwise Covert).
   */
  | "canBlockCovert";

/** A boolean combat restriction, granted like a Keyword but never printed statically — always via a `grantRestriction` effect or `ContinuousAbility.restrictions`. */
export type Restriction =
  | "cannotAttack"
  | "cannotBlock"
  /** "must attack if it can" — if its controller declares any attack, an eligible, un-depleted `mustAttack` character with a legal target has to be among the attackers. */
  | "mustAttack"
  /** "must block if it can" — a non-depleted `mustBlock` character that can legally block the attacking party has to be among the declared blockers. */
  | "mustBlock"
  /** "cannot be restored" (broad — no effect can un-deplete it either). Framptle Tromwibbler. */
  | "cannotBeRestored"
  /** "cannot be restored **by your faction's RESTORE RULE**" (narrow — an explicit `restore` effect still works). Aura form of `CardInstance.restoreLocked`. Skullcrush Steamroller. */
  | "cannotBeRestoredByRule"
  /**
   * "This card cannot be picked." — it's excluded from the legal-candidate
   * set of every player-or-chooser TARGET declaration (but not from
   * `forEach` / `count` / aura selectors, nor from random selection). Usually
   * a conditional `ContinuousAbility.restrictions` entry ("while you control
   * more characters than any opponent, this card cannot be picked").
   */
  | "cannotBePicked"
  /** "This card can attack only once each turn." — `declareAttack` rejects a character that already attacked this turn while it has this restriction. Granted statically or as a continuous aura. */
  | "attackOncePerTurn"
  /** "Opponents cannot take control of this card." — a `takeControl` effect that would move it to a different controller fizzles. Gigantitect's Giant Giant. */
  | "cannotBeTakenControl";

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
