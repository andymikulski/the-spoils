// -----------------------------------------------------------------------------
// IDs / primitive types
// -----------------------------------------------------------------------------

export type PlayerId = string;
export type CardDefinitionId = string;
export type CardInstanceId = string;

/** Names a `ResolutionContext` held in `EngineMemory.contexts`. */
export type ContextId = string;
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
   * A FORCED redirect (Penetrate): while attacking and blocked, this
   * character cannot assign battle damage to the blocking party at all — its
   * only legal target is the attack's original target (faction or location).
   * Pair with an `endOfBattle` duration ("during this battle").
   */
  | "forceRedirectDamage"
  /**
   * "Can block COVERT parties" (Recyclable Golem). A character with this
   * keyword counts as Covert for the purpose of *blocking* an all-Covert
   * attacking party only (it is not otherwise Covert).
   */
  | "canBlockCovert"
  /**
   * "Can block COVERT parties and non-COVERT parties" (Guardbeast of
   * Thabbash). Like `canBlockCovert`, but ALSO exempts the character from
   * "a COVERT character may block only a COVERT party" — so a character that
   * is itself Covert (e.g. via an icon clause) can still block a non-Covert
   * attack.
   */
  | "canBlockAnyParty";

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
  /**
   * "Your opponents cannot pick this card." — like `cannotBePicked`, but only
   * for a picker who isn't the card's controller; its own controller can
   * still pick it. Martial Artist, Martial Arts Trainee, Camouflaged Urchin.
   */
  | "cannotBePickedByOpponents"
  /**
   * "Your opponent cannot pick this card." — only the block's selected opponent (MP 2) cannot pick it; the
   * card's controller and every other opponent still can. Selected when the restriction starts applying
   * (MPX-lasting) and bound like any "your opponent".
   */
  | "cannotBePickedByOpponent"
  /** "This card can attack only once each turn." — `declareAttack` rejects a character that already attacked this turn while it has this restriction. Granted statically or as a continuous aura. */
  | "attackOncePerTurn"
  /**
   * "Anything that can pick this card must pick it." — the inverse of
   * `cannotBePicked`: whenever a player-or-chooser target declaration's
   * legal candidate pool would include one or more `mustBePicked` cards, it
   * is narrowed to *only* those (the picker is forced to choose among
   * them). Does not force a fully-optional ("you may pick") declaration to
   * pick at all — only which card, once picking. Ferret Oil Coating.
   */
  | "mustBePicked"
  /**
   * "This card's activated abilities cannot be used." — no player may
   * activate an activated ability whose source has this restriction
   * (`getAvailableActivatedAbilities` skips it, `activateAbility` rejects
   * it). Triggered / continuous / replacement abilities are unaffected.
   * Granted as a continuous aura — "Abilities on locations cannot be used"
   * (0v3rw0rk3d 31f, over `{ type: "location" }`).
   */
  | "cannotUseAbilities"
  /** "Opponents cannot take control of this card." — a `takeControl` effect that would move it to a different controller fizzles. Gigantitect's Giant Giant. */
  | "cannotBeTakenControl";

export type CardType =
  | "character"
  | "item"
  | "location"
  | "tactic"
  | "resource"
  | "faction";

/**
 * One entry of the optional card catalog an engine can be given (`SpoilsEngine.setCardCatalog`,
 * the `cardCatalog` game-setup option): a real card's name and type. Lets "name a non-resource
 * card" (Incriminating Photograph) refuse names that are not cards. The engine does not import
 * the card catalog itself.
 */
export interface CardCatalogEntry {
  name: string;
  cardType: CardType;
}

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
  /**
   * Expires at the start of the source controller's *next* turn — it
   * survives the intervening opponent turn, unlike `untilEndOfTurn`. "until
   * the start of your next turn" (Unstable Modification's per-turn modal
   * choice). In the 2-player engine this is "two start-of-turn points
   * later".
   */
  | {
      type: "untilStartOfNextTurn";
      /**
       * Stamped by the engine when the effect resolves: the turn number at
       * whose start it ends = the next turn that belongs to the effect's
       * controller (a spell cast on the opponent's turn ends one turn later,
       * not two). Absent on authored data.
       */
      untilTurn?: number;
    }
  /**
   * "until the end of your next turn": the controller's next turn, then it
   * ends with that turn (swept at the following start-of-turn point).
   * `untilTurn` is stamped by the engine when the effect resolves.
   */
  | { type: "untilEndOfNextTurn"; untilTurn?: number }
  /**
   * "until the end of the battle" — swept when the current battle ends
   * (and by the next start-of-turn sweep if no battle is running).
   */
  | { type: "endOfBattle" }
  | { type: "whileSourceInPlay" };

export type ModifierOperation = "add" | "set" | "multiply";
