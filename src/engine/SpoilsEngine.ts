// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

import type {
  AbilityDefinition,
  AbilityId,
  ActivatedAbility,
  BattleDamageAssignment,
  BattleId,
  BattleState,
  BattleView,
  CardDefinition,
  CardDefinitionId,
  CardInstance,
  CardInstanceId,
  CardPlayability,
  CardSelector,
  CardType,
  Condition,
  Cost,
  DevelopChoice,
  Duration,
  Effect,
  FactionDefinition,
  GameAction,
  GameEvent,
  GameFlowView,
  GameLogEntry,
  GameLogKind,
  GameState,
  Keyword,
  NumberExpression,
  PendingChoice,
  PendingEffectFrame,
  PlayerId,
  PlayerRef,
  PlayerState,
  ResolutionContext,
  ResourceIcon,
  ResponseContinuation,
  ResponseWindowKind,
  ResponseWindowState,
  Restriction,
  RuntimeModifier,
  StackItem,
  Stat,
  TargetDeclaration,
  TargetRef,
  TokenSpec,
  Threshold,
  TriggerResolution,
  Zone
} from "../types/index.js";
import {
  assert,
  compare,
  isStapleResourceDefinition,
  nextId,
  parseThreshold,
  withBuiltInFactionDefaults
} from "./utilities.js";
import { drawRandom, randomSeed } from "./rng.js";

/** Reserved target-declaration id for an "Attach to X" card's play-time target. */
const ATTACH_TARGET_ID = "attachTo";

/** Bracketed rules-text token for each resource icon (`[V]` etc.) — used by the `textMentionsIcon` condition. */
const ICON_TEXT_TOKEN: Record<ResourceIcon, string> = {
  rage: "[R]",
  greed: "[G]",
  deception: "[D]",
  elitism: "[E]",
  obsession: "[O]",
  volition: "[V]"
};

/**
 * Single-target mutating effects that "an effect from an ignored card type"
 * must not apply to its target (Parkour Hoodlum — `ignoresRulesTextFrom`).
 * Deliberately excludes effects whose `target` is a not-yet-in-play card
 * (`playResource`, `putIntoPlay`, `deployFromZone`) or a stack item
 * (`terminate`, `duplicate`) — the guard would be a harmless no-op there
 * anyway, since the check requires an in-play, face-up target.
 */
const SOURCE_CLASS_GUARDED_EFFECTS = new Set<Effect["type"]>([
  "dealDamage",
  "destroy",
  "deplete",
  "restore",
  "moveCard",
  "flipFaceDown",
  "addCounter",
  "removeCounter",
  "createModifier",
  "takeControl",
  "grantKeyword",
  "grantRestriction",
  "grantProvides",
  "setDamage",
  "setCardType",
  "removeCardType",
  "modifyNumericCost",
  "preventDamage",
  "detach",
  "setRestoreLock",
  "skipNextRestore",
  "attachTo"
]);

export class SpoilsEngine {
  readonly definitions: Record<CardDefinitionId, CardDefinition>;
  readonly state: GameState;

  readonly immediateQueue: TriggerResolution[] = [];

  /**
   * Event batches delay triggered-ability execution until a simultaneous group
   * of mutations is complete. Battle damage uses this so one damage event
   * cannot interrupt another member of the same speed group.
   */
  private eventBatchDepth = 0;

  /**
   * Whether `emit()` and the flow markers append to `state.gameLog`. On by
   * default; `setLogEnabled(false)` turns recording off (the already-recorded
   * entries stay). Not serialized — it's an engine-run setting, not game
   * state.
   */
  private logEnabled = true;

  /** Guards `applyReplacement` against infinite recursion (a `destroy`
   * replacement whose own effect destroys the same card, etc.). */
  private readonly replacing = new Set<CardInstanceId>();

  /**
   * The player currently *causing* mutations — the controller of the effect
   * being resolved, or the player who dealt the battle damage. Read by
   * `applyReplacement` to honor `ReplacementAbility.replaces.by` ("destroyed
   * by an opposing card or effect"). `undefined` when nothing is driving
   * (e.g. a state-based check with no preceding effect), which never
   * satisfies a scoped `by: "self" | "opponent"`.
   */
  private currentCause: PlayerId | undefined;

  /**
   * Per-card "who last dealt it damage" — set while battle damage is
   * applied (which happens outside `resolveEffect`, so the `currentCause`
   * hook there doesn't cover it), read by `checkStateBasedActions` so a
   * character dying to *lethal battle damage* attributes the destruction to
   * the attacker/blocker that dealt it. Non-battle `dealDamage` is already
   * covered by the `resolveEffect` cause hook.
   */
  private readonly lethalDamageCause = new Map<CardInstanceId, PlayerId>();

  /**
   * Snapshot of a card's `attachedTo` / `linkedTargets` taken the instant it
   * leaves play, so a "when this card leaves play" trigger resolving later
   * in the same action (queued behind an event batch) can still read
   * `"attachedTo"` / `{ remembered }`. Cleared at the top of every
   * `perform()`.
   */
  private readonly departedLinks = new Map<
    CardInstanceId,
    { attachedTo?: CardInstanceId; linkedTargets?: Record<string, CardInstanceId> }
  >();

  /**
   * The `{ sourceId, abilityId }` of the ability most recently removed from
   * the response stack by a `terminate` this action — a fallback so
   * `respondedAbilitySource` / `lockAbilityThisTurn "respondedAbility"` still
   * resolve after "Terminate the ability. Destroy the character / It cannot
   * be used again this turn." (Exploding Sock Puppet!, Subsection 5).
   * Cleared at the top of every `perform()`.
   */
  private lastTerminatedAbility:
    | { sourceId: CardInstanceId; abilityId: AbilityId }
    | undefined;

  /**
   * Explicit override for `random`, as passed to the constructor. Threaded
   * through to `canPayCosts`'s simulate-on-a-clone probe so a test's
   * scripted sequence applies there too — `undefined` (the production
   * default) instead lets that probe derive its own stream from the clone's
   * own `rngState`, so a dry-run affordability check can never advance the
   * real game's RNG.
   */
  private readonly randomOverride?: () => number;

  /** Backs `shuffleDeck` and any random-valued expression/target. Defaults to the seeded, serializable stream on `state.rngState`. */
  private readonly random: () => number;

  constructor(
    definitions: CardDefinition[],
    initialState: GameState,
    random?: () => number
  ) {
    this.randomOverride = random;
    this.random = random ?? (() => drawRandom(this.state));

    this.definitions = Object.fromEntries(
      definitions.map(def => {
        const normalized = withBuiltInFactionDefaults(def);
        return [normalized.id, normalized];
      })
    );

    this.state = initialState;

    // Normalize partially-specified states (test fixtures, hand-built saves).
    this.state.responseStack ??= [];
    this.state.gameLog ??= [];
    this.state.developsUsedThisTurn ??= 0;
    this.state.setup ??= { phase: "complete" };
    this.state.started ??= true;
    this.state.rngState ??= randomSeed();
    this.state.turnEventTally ??= {};
    this.state.turnDeploys ??= {};
    this.state.damageThisTurn ??= {};
    this.state.restoreRuleSkips ??= {};
    this.state.resourceGrants ??= [];
    this.state.provideGrants ??= [];
    this.state.playRestrictions ??= [];
    this.state.numericCostModifiers ??= [];
    this.state.outgoingDamageModifiers ??= [];
    this.state.thresholdReductions ??= [];
    this.state.cardTypeGrants ??= [];
    this.state.subtypeGrants ??= [];
    this.state.runtimeReplacements ??= [];
    this.state.handMoveRedirects ??= [];
    this.state.partyRestrictionGrants ??= [];
    this.state.damageShields ??= [];
    this.state.battleDamageTransforms ??= [];
    this.state.voidPlayGrants ??= [];
    this.state.scheduledEffects ??= [];
    this.state.playerKeywordGrants ??= [];
    this.state.keywordSuppressions ??= [];
    this.state.abilitySuppressions ??= [];
    this.state.abilityUsesThisTurn ??= {};
    this.state.attacksThisTurn ??= {};
    this.state.attackDeclarationsThisTurn ??= {};
    this.state.damagePreventionWindows ??= [];
    this.state.destructionRestrictionWindows ??= [];

    for (const card of Object.values(this.state.cards)) {
      card.faceDown ??= false;
    }
  }

  get responseStack(): StackItem[] {
    return this.state.responseStack;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  perform(action: GameAction): void {
    this.departedLinks.clear();
    this.lastTerminatedAbility = undefined;

    // Once the game has ended, only let already-in-flight resolution (a
    // battle finishing, a response window closing) drain to a clean stop —
    // block anything that would start something new.
    const isDraining =
      !!this.state.responseWindow ||
      !!this.state.battle ||
      this.responseStack.length > 0;

    assert(!this.state.winner || isDraining, "The game has already ended.");

    assert(
      !this.state.pendingChoice || action.type === "resolvePendingChoice",
      "A pending choice must be resolved before any other action."
    );

    // Baseline "who is causing this" for replacement `by` scoping; effect
    // resolution and battle damage refine it as they go.
    if ("playerId" in action && action.playerId) {
      this.currentCause = action.playerId;
    }

    if (this.state.setup.phase === "mulligan" && action.type !== "mulligan") {
      throw new Error("Opening mulligans must be completed before play begins.");
    }

    switch (action.type) {
      case "playCard":
        this.playCard(action);
        return;

      case "activateAbility":
        this.activateAbility(action);
        return;

      case "flipUp":
        this.flipUpCard(action);
        return;

      case "passPriority":
        this.passPriority(action.playerId);
        return;

      case "mulligan":
        this.mulligan(action.playerId, action.cardIds);
        return;

      case "chooseDevelop":
        this.chooseDevelop(action.playerId, action.choice);
        return;

      case "endTurn":
        this.endTurn(action.playerId);
        return;

      case "declareAttack":
        this.declareAttack(action.playerId, action.attackerIds, action.target);
        return;

      case "declareBlockers":
        this.declareBlockers(action.playerId, action.blockerIds);
        return;

      case "advanceFlow":
        this.advanceFlow();
        return;

      case "advanceBattle":
        assert(this.state.battle, "No battle in progress.");
        assert(
          action.playerId === this.state.battle.attackerPlayerId ||
          action.playerId === this.state.battle.defenderPlayerId,
          "Player is not part of this battle."
        );
        this.advanceFlow();
        return;

      case "assignBattleDamage":
        this.assignBattleDamage(action.playerId, action.assignments);
        return;

      case "resolvePendingChoice":
        this.resolvePendingChoice(action.playerId, action.choice);
        return;
    }
  }

  /**
   * Single query surface intended for a UI / renderer.
   */
  getFlowView(): GameFlowView {
    let mode: GameFlowView["mode"] = "main";

    if (this.state.winner) {
      mode = "gameOver";
    } else if (this.state.pendingChoice) {
      mode = "pendingChoice";
    } else if (this.state.setup.phase === "mulligan") {
      mode = "setup";
    } else if (this.state.responseWindow?.phase === "acceptingResponses") {
      mode = "response";
    } else if (this.state.responseWindow?.phase === "resolving") {
      mode = "resolvingResponses";
    } else if (this.state.battle?.phase === "finished") {
      mode = "battleFinished";
    } else if (this.state.battle) {
      mode = "battleChoice";
    }

    return {
      activePlayerId: this.state.activePlayerId,
      priorityPlayerId: this.state.priorityPlayerId,
      mode,
      developAvailable: this.canDevelopNow(this.state.activePlayerId),
      setup: structuredClone(this.state.setup),
      responseWindow: this.state.responseWindow
        ? structuredClone(this.state.responseWindow)
        : undefined,
      responseStack: structuredClone(this.state.responseStack),
      battle: this.getBattleView(),
      winner: this.state.winner,
      pendingChoice: this.state.pendingChoice
        ? structuredClone(this.state.pendingChoice)
        : undefined,
      revealed: this.getRevealedZones()
    };
  }

  /**
   * Which players' deck-top / hand is currently public via a `grantsReveal`
   * continuous ability. Derived, renderer-facing only (RULES.md §5 — the
   * engine has perfect information and no rule keys off it).
   */
  private getRevealedZones(): GameFlowView["revealed"] {
    const deckTopFor = new Set<PlayerId>();
    const handFor = new Set<PlayerId>();
    this.forEachActiveContinuous((source, ability) => {
      const rule = ability.grantsReveal;
      if (!rule) return;
      for (const playerId of Object.keys(this.state.players) as PlayerId[]) {
        if (!this.scopeMatchesPlayer(rule.of, source.controllerId, playerId)) continue;
        (rule.zone === "hand" ? handFor : deckTopFor).add(playerId);
      }
    });
    return {
      deckTop: [...deckTopFor]
        .map(playerId => ({ playerId, cardId: this.state.players[playerId].deck[0] }))
        .filter((e): e is { playerId: PlayerId; cardId: CardInstanceId } => !!e.cardId),
      hands: [...handFor]
    };
  }

  // ---------------------------------------------------------------------------
  // Game log (RULES.md §12 "Fidelity pass" — informational only)
  // ---------------------------------------------------------------------------

  /** Turn the running game log (`state.gameLog`) on or off. Already-recorded entries are kept. */
  setLogEnabled(enabled: boolean): void {
    this.logEnabled = enabled;
  }

  /** Whether new game-log entries are currently being recorded. */
  isLogEnabled(): boolean {
    return this.logEnabled;
  }

  /** The running game log, oldest entry first. The live array — treat as read-only. */
  getLog(): readonly GameLogEntry[] {
    return this.state.gameLog;
  }

  /**
   * The game log rendered as plain text, one line per entry, indented by
   * `depth` so responses (and responses to responses) read as nested under
   * what they answer. `sinceSeq` skips everything up to and including that
   * sequence number (for tailing an in-progress game); `indent` is the
   * per-level prefix (default two spaces).
   */
  formatLog(options: { sinceSeq?: number; indent?: string } = {}): string {
    const indent = options.indent ?? "  ";
    const sinceSeq = options.sinceSeq ?? 0;

    return this.state.gameLog
      .filter(entry => entry.seq > sinceSeq)
      .map(entry => {
        const prefix = entry.kind === "turn" ? "" : indent.repeat(entry.depth + 1);
        return `${prefix}${entry.message}`;
      })
      .join("\n");
  }

  private recordLogEvent(event: GameEvent): void {
    if (!this.logEnabled) return;

    // The log is informational — a gap in a message must never abort a real
    // mutation, so a describe failure degrades to a bare event tag.
    let described: { kind: GameLogKind; message: string } | undefined;
    try {
      described = this.describeEvent(event);
    } catch {
      described = { kind: "info", message: `(${event.type})` };
    }
    if (!described) return;

    this.state.gameLog.push({
      seq: this.state.gameLog.length + 1,
      turn: this.state.turn,
      activePlayerId: this.state.activePlayerId,
      depth: this.responseStack.length,
      kind: described.kind,
      message: described.message,
      event
    });
  }

  private recordLogMarker(
    marker: NonNullable<GameLogEntry["marker"]>,
    kind: GameLogKind,
    message: string,
    depth: number
  ): void {
    if (!this.logEnabled) return;

    this.state.gameLog.push({
      seq: this.state.gameLog.length + 1,
      turn: this.state.turn,
      activePlayerId: this.state.activePlayerId,
      depth,
      kind,
      message,
      marker
    });
  }

  /** Player display name for a log line, falling back to the id. */
  private logPlayerName(playerId: PlayerId): string {
    return this.state.players[playerId]?.name || playerId;
  }

  /** Card display name for a log line, falling back to the instance id. */
  private logCardName(cardId: CardInstanceId | undefined): string {
    if (!cardId) return "something";
    const card = this.state.cards[cardId];
    if (!card) return cardId;
    if (card.faceDown) return "a face-down card";
    return this.definitions[card.definitionId]?.name ?? cardId;
  }

  /** "the faction" line label — "Alice's faction". */
  private logFactionOwnerName(cardId: CardInstanceId): string {
    const card = this.state.cards[cardId];
    return card ? `${this.logPlayerName(card.ownerId)}'s faction` : "a faction";
  }

  /**
   * One-line rendering + category for an emitted event. Returns `undefined`
   * for events with no reader value (a degenerate same-zone self-move).
   */
  private describeEvent(event: GameEvent): { kind: GameLogKind; message: string } | undefined {
    const responding = this.responseStack.length > 0;

    switch (event.type) {
      case "turnStarted":
        return {
          kind: "turn",
          message: `— Turn ${this.state.turn}: ${this.logPlayerName(event.playerId)} —`
        };

      case "turnEnding":
        return { kind: "turn", message: `${this.logPlayerName(event.playerId)} ends their turn` };

      case "cardPlayed": {
        const suffix = responding ? " in response" : "";
        return {
          kind: responding ? "response" : "action",
          message: `${this.logPlayerName(event.playerId)} plays ${this.logCardName(event.cardId)}${suffix}`
        };
      }

      case "abilityActivated": {
        const def = this.state.cards[event.cardId]
          ? this.definitions[this.state.cards[event.cardId].definitionId]
          : undefined;
        const ability = def?.behavior?.abilities?.find(a => a.id === event.abilityId);
        const label = ability?.name ? `"${ability.name}"` : "an ability";
        const suffix = responding ? " in response" : "";
        return {
          kind: responding ? "response" : "action",
          message: `${this.logPlayerName(event.playerId)} activates ${label} on ${this.logCardName(event.cardId)}${suffix}`
        };
      }

      case "cardEnteredPlay":
        return { kind: "zone", message: `${this.logCardName(event.cardId)} enters play` };

      case "cardMoved": {
        if (event.from === event.to) return undefined;
        // "Being Deployed" is a transient mechanical waypoint — the deploy
        // and its resolution are already logged (`cardPlayed`,
        // `stackItemResolving`, `cardEnteredPlay`).
        if (event.from === "deploying" || event.to === "deploying") return undefined;
        return {
          kind: "zone",
          message: `${this.logCardName(event.cardId)} moves from ${event.from} to ${event.to}`
        };
      }

      case "cardPicked":
        return {
          kind: "zone",
          message: `${this.logPlayerName(event.playerId)} picks ${this.logCardName(event.cardId)}`
        };

      case "cardDestroyed":
        return { kind: "zone", message: `${this.logCardName(event.cardId)} is destroyed` };

      case "cardDepleted":
        return { kind: "zone", message: `${this.logCardName(event.cardId)} is depleted` };

      case "cardRestored":
        return { kind: "zone", message: `${this.logCardName(event.cardId)} is restored` };

      case "counterChanged": {
        const count = this.state.cards[event.cardId]?.counters?.[event.counter] ?? 0;
        return {
          kind: "zone",
          message: `${this.logCardName(event.cardId)} now has ${count} ${event.counter} counter(s)`
        };
      }

      case "resourcePlayed":
        return {
          kind: "resource",
          message: `${this.logPlayerName(event.playerId)} plays ${this.logCardName(event.cardId)} as a ${
            event.faceDown ? "face-down" : "face-up"
          } resource`
        };

      case "cardsDrawn":
        return {
          kind: "draw",
          message: `${this.logPlayerName(event.playerId)} draws ${event.count} card${
            event.count === 1 ? "" : "s"
          }`
        };

      case "cardsDiscarded":
        return {
          kind: "draw",
          message: `${this.logPlayerName(event.playerId)} discards a card`
        };

      case "cardsRevealed": {
        const names = event.cardIds.map(id => this.logCardName(id)).join(", ") || "no cards";
        return {
          kind: "draw",
          message: `${this.logPlayerName(event.ownerId)} reveals ${names} from ${event.zone}`
        };
      }

      case "deckSearched":
        return { kind: "draw", message: `${this.logPlayerName(event.playerId)} searches their deck` };

      case "damageDealt": {
        const target = this.state.cards[event.targetId];
        const targetLabel =
          target && this.getDefinition(event.targetId).type === "faction"
            ? this.logFactionOwnerName(event.targetId)
            : this.logCardName(event.targetId);
        const from = event.sourceId ? ` from ${this.logCardName(event.sourceId)}` : "";
        return {
          kind: "damage",
          message: `${targetLabel} takes ${event.amount} damage${from}`
        };
      }

      case "battleStarted": {
        const battle = this.state.battle;
        const targetLabel = !battle
          ? "the opponent"
          : battle.target.type === "faction"
            ? this.logPlayerName(battle.target.playerId) + "'s faction"
            : this.logCardName(battle.target.cardId);
        const attackers = (battle?.attackingParty ?? [])
          .map(id => this.logCardName(id))
          .join(", ");
        return {
          kind: "battle",
          message: `Battle: ${attackers || "attackers"} attack ${targetLabel}`
        };
      }

      case "battleEnded":
        return { kind: "battle", message: `Battle ends` };

      case "characterAttacked":
        return { kind: "battle", message: `${this.logCardName(event.cardId)} attacks` };

      case "characterBlocked":
        return { kind: "battle", message: `${this.logCardName(event.cardId)} blocks` };

      case "blockingPartyFormed":
        return {
          kind: "battle",
          message: `${this.logPlayerName(event.playerId)} forms a blocking party of ${event.blockerCount}`
        };

      case "attackerBlocked":
        return {
          kind: "battle",
          message: `${this.logCardName(event.cardId)} is blocked by ${event.blockerCount} character(s)`
        };

      case "coinFlipped":
        return {
          kind: "info",
          message: `${this.logPlayerName(event.playerId)} flips a coin and ${
            event.won ? "wins" : "loses"
          }`
        };
    }

    return undefined;
  }

  getDefinition(cardId: CardInstanceId): CardDefinition {
    const card = this.requireCard(cardId);
    const definition = this.definitions[card.definitionId];

    assert(
      definition,
      `Missing definition '${card.definitionId}' for card '${cardId}'`
    );

    return definition;
  }

  /**
   * Every card type a card currently has (RULES.md §3.7 / CR §208). Its
   * printed `definition.type` plus any type ADDED by a live `setCardType`
   * grant ("this turn, the item is a golem character" — CR §208.1: a card
   * may have several types at once; §208.1a: gaining one keeps the rest).
   * Everything that keys a *rules* decision off type — typed selectors, the
   * lethal-damage / attach-to state-based checks, battle legality, the
   * `cardTypeIs` condition, start-of-turn damage-clear and attack
   * eligibility — asks `hasCardType`. Play-time resolution (tactic vs.
   * permanent) still reads `definition.type` directly, since a type change
   * only applies to a card already in play.
   */
  getCardTypes(cardId: CardInstanceId): CardType[] {
    const types = new Set<CardType>([this.getDefinition(cardId).type]);

    // `untilEndOfTurn` / `permanent` grants apply while they sit in the
    // array (the start-of-turn sweep drops the expired ones, exactly like
    // `state.modifiers`); `whileSourceInPlay` needs the live check here
    // since nothing else prunes it.
    for (const grant of this.state.cardTypeGrants) {
      if (grant.targetId !== cardId) continue;
      if (
        grant.duration.type === "whileSourceInPlay" &&
        (!grant.sourceId || this.state.cards[grant.sourceId]?.zone !== "play")
      ) {
        continue;
      }
      types.add(grant.cardType);
    }

    return [...types];
  }

  /**
   * A card's current subtype list — printed subtypes plus any still-active
   * `grantSubtype` grant ("it gains the sarcophyle subtype"). The single
   * read path for every subtype consumer (`cardSubtypeIs`, selector
   * `subtype` / `subtypeVar`, `distinctCount by: "subtype"`,
   * `hasAttachment.ofSubtype`).
   */
  getSubtypes(cardId: CardInstanceId): string[] {
    const subs = new Set<string>(this.getDefinition(cardId).subtype ?? []);
    for (const grant of this.state.subtypeGrants) {
      if (grant.targetId !== cardId) continue;
      if (
        grant.duration.type === "whileSourceInPlay" &&
        (!grant.sourceId || this.state.cards[grant.sourceId]?.zone !== "play")
      ) {
        continue;
      }
      subs.add(grant.subtype);
    }
    return [...subs];
  }

  /** Whether `cardId` currently has `type` (printed or added — see `getCardTypes`). */
  hasCardType(cardId: CardInstanceId, type: CardType): boolean {
    return this.getCardTypes(cardId).includes(type);
  }

  /**
   * Puts a token permanent into play under `playerId` — a synthetic
   * `CardDefinition` registered on the fly plus a `CardInstance` marked
   * `isToken` (so `moveCard` deletes it outright when it leaves play).
   */
  /**
   * A card's Unique designation, including one granted live by a
   * `ContinuousAbility.uniqueGrant` (God's Autograph). `"cardName"` grants
   * resolve to the card's own name.
   */
  getEffectiveUnique(cardId: CardInstanceId): string | undefined {
    const card = this.state.cards[cardId];
    if (!card) return undefined;

    const printed = this.getDefinition(cardId).unique;
    if (printed) return printed;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.uniqueGrant) continue;
        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [cardId] }
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, ctx)
        ) {
          continue;
        }
        if (!this.matchesSelector(card, ability.uniqueGrant.selector, ctx)) {
          continue;
        }
        return ability.uniqueGrant.designation === "cardName"
          ? this.getDefinition(cardId).name
          : ability.uniqueGrant.designation;
      }
    }

    return undefined;
  }

  /**
   * A card's FLIP UP option: its own printed `flipUp`, or one granted by an
   * in-play `ContinuousAbility.grantFlipUp` aura (Woadenworm Gloamspike —
   * "all your face-down tactics gain FLIP UP with cost & threshold equal to
   * their regular cost & threshold"). A card with its own `flipUp` keeps it.
   */
  getEffectiveFlipUp(
    cardId: CardInstanceId
  ): { cost: number; threshold: string | number; effects?: Effect[] } | undefined {
    const definition = this.getDefinition(cardId);
    if (definition.flipUp) return definition.flipUp;

    const card = this.state.cards[cardId];
    if (!card) return undefined;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.grantFlipUp) continue;
        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [cardId] }
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        if (!this.matchesSelector(card, ability.grantFlipUp.selector, ctx)) {
          continue;
        }
        return {
          cost: definition.cost ?? 0,
          threshold: definition.threshold
        };
      }
    }

    return undefined;
  }

  private createTokenPermanent(
    playerId: PlayerId,
    token: TokenSpec
  ): CardInstanceId {
    const defId = nextId("token-def");
    this.definitions[defId] = {
      id: defId,
      name: token.name,
      set: "Token",
      type: token.cardType,
      trade: "universal",
      rarity: "",
      cost: 0,
      threshold: 0,
      subtype: token.subtype ?? [],
      text: "",
      strength: token.strength,
      life: token.life,
      speed: token.speed,
      structure: token.structure
    };

    const instance: CardInstance = {
      id: nextId("card"),
      definitionId: defId,
      ownerId: playerId,
      controllerId: playerId,
      zone: "play",
      depleted: false,
      damage: 0,
      faceDown: false,
      attackEligibleTurn: undefined,
      counters: {},
      isToken: true
    };
    this.state.cards[instance.id] = instance;
    this.requirePlayer(playerId).play.push(instance.id);

    this.emit({
      type: "cardEnteredPlay",
      cardId: instance.id,
      playerId
    });

    return instance.id;
  }

  getFactionCard(playerId: PlayerId): CardInstance | undefined {
    const player = this.requirePlayer(playerId);
    return player.factionId ? this.state.cards[player.factionId] : undefined;
  }

  getFactionDefinition(playerId: PlayerId): FactionDefinition | undefined {
    const faction = this.getFactionCard(playerId);
    if (!faction) return undefined;
    return this.getDefinition(faction.id).faction;
  }

  isResource(cardId: CardInstanceId): boolean {
    const card = this.requireCard(cardId);
    return card.zone === "play" &&
      (card.faceDown || this.getDefinition(cardId).type === "resource");
  }

  getAvailableResourceIds(playerId: PlayerId): CardInstanceId[] {
    const player = this.requirePlayer(playerId);
    return player.play.filter(cardId => {
      const card = this.state.cards[cardId];
      return (
        card.controllerId === playerId &&
        this.isResource(cardId) &&
        card.attachedTo === undefined
      );
    });
  }

  getAvailableResourceCount(playerId: PlayerId): number {
    return this.getAvailableResourceIds(playerId).length;
  }

  getThresholds(playerId: PlayerId): Threshold {
    const result: Threshold = {};

    for (const cardId of this.requirePlayer(playerId).play) {
      const card = this.state.cards[cardId];
      if (!card || card.controllerId !== playerId) {
        continue;
      }

      // Resources (face-up printed icons, or Volition for face-down) AND
      // any other in-play card that prints "PROVIDES: [X]" (a crest item, a
      // character) — `getResourceIcons` returns `[]` for everything else.
      const icons = this.getResourceIcons(cardId);
      for (const icon of icons) {
        result[icon] = (result[icon] ?? 0) + 1;
      }
    }

    // "This turn, you control an additional [E][E][E][E]" (31337!) and other
    // temporary phantom-icon grants.
    for (const grant of this.state.resourceGrants) {
      if (grant.playerId !== playerId) continue;
      result[grant.icon] = (result[grant.icon] ?? 0) + grant.amount;
    }

    return result;
  }

  getDevelopChoices(playerId: PlayerId): DevelopChoice[] {
    // "Your opponent ignores their faction's DEVELOP RULE." (The Knitting
    // Coalition — PULLING STRINGS): an opposing in-play faction can suppress
    // this player's Develop Rule entirely.
    const opponentFaction = this.getFactionDefinition(this.getOpponent(playerId).id);
    if (opponentFaction?.overridesOpponent?.suppressDevelop) {
      return [];
    }
    return structuredClone(
      this.getFactionDefinition(playerId)?.turn.develop.choices ?? []
    );
  }

  /** How many times `playerId`'s faction may use its Develop Rule per turn (default 1; "OVERTIME" = 2). */
  private developsAllowed(playerId: PlayerId): number {
    return this.getFactionDefinition(playerId)?.turn.develop.usesPerTurn ?? 1;
  }

  /**
   * The in-play card `playerId` controls that carries
   * `behavior.developDrawReplacement` ("If you would draw a card as part of
   * your Develop Rule, you may ... instead"; Arcane Escrow), or `undefined`.
   */
  private developDrawReplacementCardFor(
    playerId: PlayerId
  ): CardInstanceId | undefined {
    for (const cardId of this.requirePlayer(playerId).play) {
      const card = this.state.cards[cardId];
      if (!card || card.controllerId !== playerId || card.faceDown) continue;
      if (this.getDefinition(cardId).behavior?.developDrawReplacement) {
        return cardId;
      }
    }
    return undefined;
  }

  private getResourceIcons(cardId: CardInstanceId): ResourceIcon[] {
    const card = this.requireCard(cardId);

    // "This turn, this card gains PROVIDES: [X]" — a card-scoped runtime
    // grant, stacked on top of the printed icons / Volition below. Live-read
    // like `state.modifiers` (present == active); expiry is the start-of-turn
    // sweep + the leave-play cleanup, not `durationStillActive` (whose
    // `<=` turn check only makes sense at that sweep).
    const granted: ResourceIcon[] = [];
    for (const grant of this.state.provideGrants) {
      if (grant.targetId !== cardId) continue;
      if (
        grant.duration.type === "whileSourceInPlay" &&
        (!grant.sourceId || this.state.cards[grant.sourceId]?.zone !== "play")
      ) {
        continue;
      }
      for (let i = 0; i < grant.amount; i++) granted.push(grant.icon);
    }

    if (card.faceDown) {
      return ["volition", ...granted];
    }

    const definition = this.getDefinition(cardId);

    if (definition.resource?.provides?.length) {
      return [...definition.resource.provides, ...granted];
    }

    switch (definition.name.toLowerCase()) {
      case "rage":
        return ["rage", ...granted];
      case "greed":
        return ["greed", ...granted];
      case "deception":
        return ["deception", ...granted];
      case "elitism":
        return ["elitism", ...granted];
      case "obsession":
        return ["obsession", ...granted];
      default:
        return granted;
    }
  }

  private payNumericCost(playerId: PlayerId, amount: number): void {
    assert(Number.isInteger(amount) && amount >= 0, "Numeric costs must be non-negative integers.");

    const player = this.requirePlayer(playerId);
    assert(player.factionId, "Player has no faction to attach resources to.");

    const resources = this.getAvailableResourceIds(playerId);
    assert(resources.length >= amount, "Not enough unattached resources.");

    for (const cardId of resources.slice(0, amount)) {
      this.requireCard(cardId).attachedTo = player.factionId;
    }
  }

  /**
   * Apply an influence change to `playerId`'s faction, first running it
   * through any in-play `ContinuousAbility.influenceModifiers` (Tax
   * Attorney — "when your faction loses influence, reduce the amount by
   * 1"). The single choke point for the `modifyInfluence` effect and every
   * CR §408.3 damage→influence path. (Influence paid as an explicit
   * `loseInfluence` COST is not routed here — a cost is a cost.)
   */
  private applyInfluenceDelta(playerId: PlayerId, delta: number): void {
    let d = delta;
    if (d !== 0) {
      const dir: "loss" | "gain" = d < 0 ? "loss" : "gain";
      this.forEachActiveContinuous((source, ability, context) => {
        for (const mod of ability.influenceModifiers ?? []) {
          if (mod.direction !== "any" && mod.direction !== dir) continue;
          if (
            !this.scopeMatchesPlayer(mod.player, source.controllerId, playerId)
          )
            continue;
          const reduce = Math.max(
            0,
            this.evaluateNumber(mod.delta, context)
          );
          const newMag = Math.max(mod.minAmount ?? 0, Math.abs(d) - reduce);
          d = dir === "loss" ? -newMag : newMag;
        }
      });
    }
    this.requirePlayer(playerId).influence += d;
  }

  private drawCards(playerId: PlayerId, amount: number): void {
    const player = this.requirePlayer(playerId);

    // ContinuousAbility.drawModifiers — "increase the amount by 1" /
    // "you cannot draw cards" (Beatrix Winterbottom). Only a real draw
    // (amount > 0) counts as "drawing any number of cards".
    let effective = amount;
    if (amount > 0) {
      this.forEachActiveContinuous((source, ability, context) => {
        for (const mod of ability.drawModifiers ?? []) {
          if (
            !this.scopeMatchesPlayer(mod.player, source.controllerId, playerId)
          )
            continue;
          if (mod.prevent) {
            effective = 0;
            continue;
          }
          if (mod.delta !== undefined) {
            effective += this.evaluateNumber(mod.delta, context);
          }
        }
      });
    }
    effective = Math.max(0, effective);

    const drawn = player.deck.splice(0, effective);

    this.beginEventBatch();
    try {
      for (const cardId of drawn) {
        const card = this.requireCard(cardId);
        card.zone = "hand";
        card.faceDown = false;
        card.attachedTo = undefined;
        player.hand.push(cardId);

        this.emit({
          type: "cardMoved",
          cardId,
          from: "deck",
          to: "hand"
        });
      }

      if (drawn.length > 0) {
        this.emit({ type: "cardsDrawn", playerId, count: drawn.length });
      }
    } finally {
      this.endEventBatch();
    }
  }

  private shuffleInPlace<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  private playResourceCard(
    playerId: PlayerId,
    cardId: CardInstanceId,
    faceDown: boolean
  ): void {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    assert(card.ownerId === playerId, "That card is not in this player's hand.");
    assert(card.zone === "hand", "A resource must be played from hand.");

    if (!faceDown) {
      assert(
        definition.type === "resource",
        "Only a resource card can be played face-up as a resource."
      );
    }

    card.faceDown = faceDown;
    card.attachedTo = undefined;
    this.moveCard(cardId, "play");

    this.emit({
      type: "resourcePlayed",
      cardId,
      playerId,
      faceDown
    });
  }

  startGameAfterSetup(): void {
    assert(this.state.setup.phase === "complete", "Opening setup is not complete.");
    assert(!this.state.started, "The game has already started.");

    this.state.started = true;
    this.state.developsUsedThisTurn = 0;
    this.state.priorityPlayerId = this.state.activePlayerId;
    this.state.turnEventTally = {};
    this.state.turnDeploys = {};
    this.state.damageThisTurn = {};
    this.applyFactionStartOfTurn(this.state.activePlayerId);

    this.emit({
      type: "turnStarted",
      playerId: this.state.activePlayerId
    });
  }

  private mulligan(playerId: PlayerId, cardIds: CardInstanceId[]): void {
    const setup = this.state.setup;

    assert(setup.phase === "mulligan", "The mulligan step is over.");
    assert(
      setup.order[setup.currentIndex] === playerId,
      "It is not this player's mulligan decision."
    );

    const faction = this.getFactionDefinition(playerId);
    const mulliganRule = faction?.setup.mulligan;

    assert(
      mulliganRule?.mode === "replaceAny" && (mulliganRule.count ?? 0) > 0,
      "This faction does not provide a replace-any mulligan."
    );

    const unique = new Set(cardIds);
    assert(unique.size === cardIds.length, "A mulligan card was selected twice.");

    const player = this.requirePlayer(playerId);

    for (const cardId of cardIds) {
      assert(player.hand.includes(cardId), "Mulligan cards must be in your hand.");
    }

    // Put the selected cards on the bottom in the supplied order, then draw
    // the same number. There is no shuffle during the Tournament mulligan.
    for (const cardId of cardIds) {
      player.hand = player.hand.filter(id => id !== cardId);
      const card = this.requireCard(cardId);
      card.zone = "deck";
      player.deck.push(cardId);
    }

    // Record what was set aside — the `bottomedInMulligan` condition reads
    // this (Community Chest's "if you chose to put this card on the bottom
    // of your deck as part of your mulligan").
    if (cardIds.length) {
      (this.state.mulligan[playerId] ??= []).push(...cardIds);
    }

    this.drawCards(playerId, cardIds.length);

    setup.currentIndex++;

    if (setup.currentIndex >= setup.order.length) {
      this.state.setup = { phase: "complete" };
      this.startGameAfterSetup();
    }
  }

  /**
   * Whether `playerId` may use their faction's Develop Rule (CR §202.8)
   * right now. It is an optional, once-per-turn action — not a phase and
   * not on CR §603.2's list of turn actions — usable any time during the
   * active player's own turn while nothing else (a battle, a response
   * window, a pending choice, unresolved responses) is in flight.
   */
  canDevelopNow(playerId: PlayerId): boolean {
    return (
      this.state.setup.phase === "complete" &&
      this.state.started &&
      !this.state.winner &&
      this.state.developsUsedThisTurn < this.developsAllowed(playerId) &&
      playerId === this.state.activePlayerId &&
      !this.state.responseWindow &&
      !this.state.battle &&
      !this.state.pendingChoice &&
      this.responseStack.length === 0 &&
      this.getDevelopChoices(playerId).length > 0
    );
  }

  private chooseDevelop(
    playerId: PlayerId,
    choice: Extract<GameAction, { type: "chooseDevelop" }>["choice"]
  ): void {
    assert(
      this.canDevelopNow(playerId),
      "The develop rule is a once-per-turn action, usable only on your own turn outside a battle or response window."
    );

    const available = this.getDevelopChoices(playerId);
    const rule = available.find(candidate => candidate.type === choice.type);
    assert(rule, `Faction does not allow develop choice '${choice.type}'.`);

    if (choice.type === "draw") {
      assert(rule.type === "draw", "Invalid draw develop rule.");

      // "If you would draw a card as part of your Develop Rule, you may
      // <instead> ..." (Arcane Escrow) — offer the substitution before
      // drawing. A `mayPay` may pause here; the plain-draw fall-through is
      // its `elseEffects`.
      const drawCount = rule.count;
      const substitute = this.developDrawReplacementCardFor(playerId);
      if (substitute) {
        const replacement = this.getDefinition(substitute).behavior!
          .developDrawReplacement!;
        this.state.developsUsedThisTurn += 1;
        this.state.priorityPlayerId = playerId;
        this.resolveEffect(
          {
            type: "mayPay",
            player: "controller",
            costs: replacement.cost ?? [],
            effects: replacement.effects,
            elseEffects: [
              { type: "draw", player: "controller", amount: drawCount }
            ]
          },
          { sourceId: substitute, controllerId: playerId, selected: {} }
        );
        this.processImmediateQueue();
        this.checkStateBasedActions();
        return;
      }

      this.drawCards(playerId, rule.count);
    } else if (choice.revealFromHand) {
      assert(rule.type === "playResource", "Invalid resource develop rule.");
      assert(
        choice.cards.length === 0,
        "A revealFromHand develop play takes no resource cards."
      );

      const revealed = this.requireCard(choice.revealFromHand.cardId);
      const revealDef = this.getDefinition(revealed.id);
      assert(
        revealDef.revealFromHand,
        `'${revealDef.name}' has no 'reveal from hand' deploy option.`
      );
      assert(
        revealed.zone === "hand" && revealed.controllerId === playerId,
        "You may only reveal a card from your own hand."
      );
      // FINE PRINT: [G][G][G][G] — an extra icon gate on the reveal deploy.
      assert(
        revealDef.revealFromHand.threshold === undefined ||
          this.meetsThreshold(playerId, revealDef.revealFromHand.threshold),
        "Threshold requirements for the reveal deploy are not met."
      );

      this.state.developsUsedThisTurn += 1;

      this.deployCard(
        playerId,
        revealed.id,
        choice.revealFromHand.selected ?? {},
        choice.revealFromHand.variables ?? {},
        false,
        false,
        revealDef.revealFromHand.cost
      );

      // Rider effects ("your faction loses 2 influence") resolve now,
      // sourced from the revealed card.
      for (const effect of revealDef.revealFromHand.effects ?? []) {
        this.resolveEffect(effect, {
          sourceId: revealed.id,
          controllerId: playerId,
          selected: {}
        });
      }

      this.afterStackAction(playerId);
      return;
    } else {
      assert(rule.type === "playResource", "Invalid resource develop rule.");
      assert(
        choice.cards.length === rule.count,
        `Develop requires exactly ${rule.count} resource play(s).`
      );

      for (const resource of choice.cards) {
        this.playResourceCard(playerId, resource.cardId, resource.faceDown);
      }
    }

    this.state.developsUsedThisTurn += 1;
    this.state.priorityPlayerId = playerId;
  }

  /**
   * The start-of-turn point (CR §602) — a single instant, not a phase.
   * Applies the three core start-of-turn rules (clear all character damage,
   * end all "this turn" effects, set attack eligibility) and then the new
   * active player's faction Restore Rule (CR §202.7).
   */
  private applyFactionStartOfTurn(playerId: PlayerId): void {
    const player = this.requirePlayer(playerId);
    const faction = this.getFactionDefinition(playerId);
    const restore = faction?.turn.restore;

    // CR §602.1b — all "this turn" effects end at this same instant.
    // Expire `setCardType` grants first, so the loops below see reverted
    // types; a card that loses the character type this way forgets the
    // damage it took this turn (CR §208.3) — which §602.1a would clear for
    // it anyway *if* it were still a character, so clear it explicitly.
    const lostCharacterType = new Set<CardInstanceId>();
    this.state.cardTypeGrants = this.state.cardTypeGrants.filter(grant => {
      if (this.durationStillActive(grant)) return true;
      if (grant.cardType === "character") lostCharacterType.add(grant.targetId);
      return false;
    });

    // CR §602.1a — all damage on characters is cleared, everywhere, every
    // turn. Not part of any faction's Restore Rule.
    for (const card of Object.values(this.state.cards)) {
      if (
        card.zone === "play" &&
        !card.faceDown &&
        (this.hasCardType(card.id, "character") ||
          lostCharacterType.has(card.id))
      ) {
        card.damage = 0;
      }
    }

    this.state.modifiers = this.state.modifiers.filter(modifier =>
      this.durationStillActive(modifier)
    );
    this.state.keywordGrants = this.state.keywordGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.keywordSuppressions = this.state.keywordSuppressions.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.playerKeywordGrants = this.state.playerKeywordGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.abilitySuppressions = this.state.abilitySuppressions.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.restrictions = this.state.restrictions.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.resourceGrants = this.state.resourceGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.provideGrants = this.state.provideGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.playRestrictions = this.state.playRestrictions.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.numericCostModifiers = this.state.numericCostModifiers.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.outgoingDamageModifiers = this.state.outgoingDamageModifiers.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.battleDamageTransforms = this.state.battleDamageTransforms.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.blockRestrictionGrants = this.state.blockRestrictionGrants.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.partyRestrictionGrants = this.state.partyRestrictionGrants.filter(
      grant => this.durationStillActive(grant)
    );
    this.state.damagePreventionWindows = this.state.damagePreventionWindows.filter(
      w => this.durationStillActive(w)
    );
    this.state.destructionRestrictionWindows =
      this.state.destructionRestrictionWindows.filter(w =>
        this.durationStillActive(w)
      );
    this.state.subtypeGrants = this.state.subtypeGrants.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.handMoveRedirects = this.state.handMoveRedirects.filter(grant =>
      this.durationStillActive(grant)
    );
    this.state.runtimeReplacements = this.state.runtimeReplacements.filter(
      grant =>
        grant.duration.type === "endOfBattle"
          ? true
          : this.durationStillActive(
              grant as { duration: Duration; createdTurn: number }
            )
    );
    // "This turn, take control of the character." (Mutiny Grant) — when the
    // grant lapses, control snaps back to whoever held it before.
    this.state.controlGrants = this.state.controlGrants.filter(grant => {
      if (this.durationStillActive(grant)) return true;
      if (this.state.cards[grant.cardId]) {
        this.reassignControl(grant.cardId, grant.previousControllerId);
      }
      return false;
    });
    this.state.costReductions = [];
    this.state.thresholdReductions = [];
    this.state.damageShields = [];

    // CR §602.1c — start-of-turn attack eligibility is a core rule, not a
    // faction ability.
    for (const card of Object.values(this.state.cards)) {
      card.attackEligibleTurn = undefined;
    }

    for (const cardId of player.play) {
      const card = this.requireCard(cardId);

      if (
        !card.faceDown &&
        this.hasCardType(cardId, "character") &&
        card.controllerId === playerId
      ) {
        card.attackEligibleTurn = this.state.turn;
      }
    }

    // "On your next turn, skip your faction's RESTORE RULE." (Monstrous
    // Lassitude) — a whole-rule skip for this turn, consuming one charge.
    const skipRestore = (this.state.restoreRuleSkips[playerId] ?? 0) > 0;
    if (skipRestore) {
      this.state.restoreRuleSkips[playerId] =
        (this.state.restoreRuleSkips[playerId] ?? 0) - 1;
    }

    if (!skipRestore && restore?.detachResources && player.factionId) {
      for (const cardId of player.play) {
        const card = this.requireCard(cardId);
        if (card.attachedTo === player.factionId && this.isResource(cardId)) {
          card.attachedTo = undefined;
        }
      }
    }

    if (!skipRestore && restore?.restoreNonResources) {
      for (const cardId of player.play) {
        const card = this.requireCard(cardId);
        // "that character does not restore during its controller's next
        // RESTORE RULE" (Numba 1 Stunna!) — a one-shot per-card skip.
        if (card.skipNextRestore) {
          card.skipNextRestore = undefined;
          continue;
        }
        if (
          !this.isResource(cardId) &&
          !card.restoreLocked &&
          !this.hasRestriction(cardId, "cannotBeRestored") &&
          !this.hasRestriction(cardId, "cannotBeRestoredByRule")
        ) {
          card.depleted = false;
        }
      }
    }

    // Faction "at the start of your turn ..." automatic effects (Imperial
    // Army's next-character discount; a token on The Society of Magical
    // Propriety), resolved with the faction card as `source`.
    const startOfTurnEffects = faction?.turn.startOfTurnEffects ?? [];
    if (startOfTurnEffects.length > 0 && player.factionId) {
      const context: ResolutionContext = {
        sourceId: player.factionId,
        controllerId: playerId,
        selected: {}
      };
      for (const effect of startOfTurnEffects) {
        this.resolveEffect(effect, context);
      }
    }
  }

  getStat(cardId: CardInstanceId, stat: Stat): number {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    let value =
      stat === "influence"
        ? definition.influence ?? 0
        : definition[stat] ?? 0;

    const modifiers = [
      ...this.getContinuousModifiers(cardId),
      ...this.state.modifiers.filter(modifier => modifier.targetId === cardId)
    ].filter(modifier => modifier.stat === stat);

    for (const modifier of modifiers) {
      switch (modifier.operation) {
        case "add":
          value += modifier.value;
          break;

        case "set":
          value = modifier.value;
          break;

        case "multiply":
          value *= modifier.value;
          break;
      }
    }

    return value;
  }

  /**
   * A card's activatable abilities — its `behavior.abilities` plus, for a
   * faction card, its `faction.abilities` (RULES.md §3.6).
   */
  private getCardActivatedAbilities(
    cardId: CardInstanceId
  ): ActivatedAbility[] {
    const definition = this.getDefinition(cardId);
    return [
      ...(definition.behavior?.abilities ?? []),
      ...(definition.faction?.abilities ?? [])
    ]
      .filter(
        (a): a is ActivatedAbility =>
          a.type === "activated" && !this.abilitySuppressed(cardId, a.id)
      )
      .concat(this.getGrantedActivatedAbilities(cardId));
  }

  /**
   * True when `playerId` controls an in-play card whose
   * `ContinuousAbility.canUseOpponentAbilities` is live (The Billionaire) —
   * they may activate activated abilities on cards their opponent controls.
   */
  private playerCanUseOpponentAbilities(playerId: PlayerId): boolean {
    let can = false;
    this.forEachActiveContinuous((source, ability) => {
      if (ability.canUseOpponentAbilities && source.controllerId === playerId) {
        can = true;
      }
    });
    return can;
  }

  getAvailableActivatedAbilities(
    playerId: PlayerId
  ): Array<{ cardId: CardInstanceId; ability: ActivatedAbility }> {
    if (!this.canUseAbilityAtCurrentTiming(playerId)) {
      return [];
    }

    const borrowsOpponentAbilities = this.playerCanUseOpponentAbilities(playerId);

    const result: Array<{
      cardId: CardInstanceId;
      ability: ActivatedAbility;
    }> = [];

    for (const card of Object.values(this.state.cards)) {
      if (card.zone !== "play" || card.faceDown) continue;
      if (this.hasRestriction(card.id, "cannotUseAbilities")) continue;
      const controlsIt = card.controllerId === playerId;

      for (const ability of this.getCardActivatedAbilities(card.id)) {
        // A non-controlled card only offers abilities marked "both players
        // may use this" (The Knitting Coalition — INFLATIONARY FORCES) or
        // "only an opponent may use this" (iDumb De-Itemizer — RESET) —
        // unless the player borrows opponent abilities (The Billionaire).
        if (
          !controlsIt &&
          ability.usableBy !== "anyPlayer" &&
          ability.usableBy !== "opponent" &&
          !borrowsOpponentAbilities
        ) {
          continue;
        }
        // "Only an opponent may use this ability" — hidden from the controller.
        if (controlsIt && ability.usableBy === "opponent") continue;

        // A borrowed opponent ability resolves "as if your opponent used
        // it" — condition / non-numeric costs are checked as that opponent.
        const asPlayerId =
          !controlsIt && borrowsOpponentAbilities && ability.usableBy !== "anyPlayer"
            ? card.controllerId
            : playerId;

        const context: ResolutionContext = {
          sourceId: card.id,
          controllerId: asPlayerId,
          abilityId: ability.id,
          selected: {}
        };

        if (
          (!ability.condition ||
            this.evaluateCondition(ability.condition, context)) &&
          this.provisionalProbeTargets(ability.targets ?? [], context) &&
          this.canPayCosts(ability.costs ?? [], context)
        ) {
          result.push({
            cardId: card.id,
            ability
          });
        }
      }
    }

    return result;
  }

  /**
   * Read-only availability probe helper: provisionally bind each of an
   * ability's own `targets` declarations to a plausible legal pick, so a
   * cost that references one (`{ type: "selected", id }` — Hollow Moose
   * INFILTRATE destroys the item/character you choose) can be simulated by
   * `canPayCosts` instead of failing on a missing target and hiding the
   * whole ability. Returns false only when a mandatory declaration has
   * fewer legal candidates than it requires — the ability genuinely can't
   * be used right now. Mutates `context.selected`; the caller passes a
   * throwaway context.
   */
  private provisionalProbeTargets(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): boolean {
    for (const declaration of declarations) {
      if (context.selected[declaration.id]) continue;

      const candidates = this.targetCandidates(declaration.selector, context);
      const count = this.evaluateNumber(declaration.count, context);

      if (!declaration.optional && candidates.length < count) {
        return false;
      }

      context.selected[declaration.id] = candidates
        .slice(0, count)
        .map(candidate => candidate.id);
    }

    return true;
  }

  /**
   * Whether `cardId` (which must be in `playerId`'s hand) could be deployed right now — the same
   * timing/threshold/numeric-cost gates `playCard` itself enforces, exposed read-only so a UI can
   * warn (or grey a card out) *before* walking the player through target selection for something
   * that was never payable, instead of only finding out from `perform()` rejecting it at the end.
   * Doesn't cover a card's targets or extra costs (deplete/discard/destroy/depleteSelected) —
   * those depend on selections the player hasn't made yet, so `perform()` is still the last word
   * on whether a specific play actually goes through.
   */
  getCardPlayability(playerId: PlayerId, cardId: CardInstanceId): CardPlayability {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);

    let legalTiming = false;
    if (card.controllerId === playerId && card.zone === "hand") {
      try {
        this.assertCanDeployAtCurrentTiming(playerId, definition, cardId);
        legalTiming = true;
      } catch {
        legalTiming = false;
      }
    }

    const thresholdMet = this.meetsThreshold(playerId, definition.threshold, {
      definition,
      cardId
    });

    const pendingReduction = this.state.costReductions.find(
      reduction =>
        reduction.playerId === playerId &&
        (reduction.cardType === undefined ||
          reduction.cardType === definition.type)
    );
    const numericCost = this.applyCostModifiers(
      playerId,
      cardId,
      Math.max(0, (definition.cost ?? 0) - (pendingReduction?.amount ?? 0))
    );
    const availableResources = this.getAvailableResourceCount(playerId);

    return {
      playable: legalTiming && thresholdMet && availableResources >= numericCost,
      legalTiming,
      thresholdMet,
      numericCost,
      availableResources
    };
  }

  /** Convenience filter over `getCardPlayability` — every card in `playerId`'s hand that's currently deployable. */
  getPlayableHandCards(playerId: PlayerId): CardInstanceId[] {
    return this.requirePlayer(playerId).hand.filter(
      cardId => this.getCardPlayability(playerId, cardId).playable
    );
  }

  queryCards(
    selector: CardSelector,
    context: ResolutionContext
  ): CardInstance[] {
    return Object.values(this.state.cards).filter(card =>
      this.matchesSelector(card, selector, context)
    );
  }

  /**
   * The card that damage / a leave-play targeting `cardId` should be
   * redirected onto, from an active `ContinuousAbility.redirects` entry
   * ("...deal damage to this card instead ... this character leaves play in
   * that way instead"; 6r4wny 60dy9u4rd5). `undefined` if none — or if the
   * redirect target isn't itself a live in-play card.
   */
  private redirectTargetFor(
    cardId: CardInstanceId
  ): CardInstanceId | undefined {
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.redirects) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        for (const redirect of ability.redirects) {
          if (this.resolveTargetRef(redirect.from, ctx) !== cardId) continue;
          const toId = this.resolveTargetRef(redirect.to, ctx);
          if (toId && toId !== cardId && this.state.cards[toId]?.zone === "play") {
            return toId;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * `queryCards` restricted to cards that may legally be *picked* as a
   * target — drops anything with the `cannotBePicked` restriction ("this
   * card cannot be picked"). Used by every player-or-chooser target
   * declaration; `forEach` / `count` / aura / random selectors keep using
   * `queryCards` directly (RULES.md §12: "cannot be picked" only blocks
   * choosing it, not being swept up by an "all X" effect).
   */
  private targetCandidates(
    selector: CardSelector,
    context: ResolutionContext
  ): CardInstance[] {
    const pickingSourceTypes = this.state.cards[context.sourceId]
      ? this.getCardTypes(context.sourceId)
      : [];
    const eligible = this.queryCards(selector, context).filter(card => {
      if (this.hasRestriction(card.id, "cannotBePicked")) return false;
      // "this card cannot be picked by <cardType>s" (Parkour Hoodlum) —
      // scoped on the card/ability doing the picking.
      for (const type of this.ignoredSourceTypesFor(card.id)) {
        if (pickingSourceTypes.includes(type)) return false;
      }
      return true;
    });

    // "Anything that can pick this card must pick it" (Ferret Oil Coating) —
    // if the legal pool contains any `mustBePicked` card, it collapses to
    // just those. (Forces *which* card, not *whether* to pick for a
    // fully-optional declaration.)
    const forced = eligible.filter(card =>
      this.hasRestriction(card.id, "mustBePicked")
    );
    return forced.length > 0 ? forced : eligible;
  }

  /**
   * Card types whose rules text `cardId` currently ignores — an in-play,
   * face-up `ContinuousAbility.ignoresRulesTextFrom` on `cardId` itself
   * whose `condition` (if any) holds. "This card ignores all rules text on
   * locations." (Parkour Hoodlum). A card of one of these types cannot pick
   * `cardId` as a target, and its single-target effects / auras skip it.
   */
  private ignoredSourceTypesFor(cardId: CardInstanceId): CardType[] {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play" || card.faceDown) return [];

    const result: CardType[] = [];
    for (const ability of this.getDefinition(cardId).behavior?.abilities ?? []) {
      if (ability.type !== "continuous" || !ability.ignoresRulesTextFrom) {
        continue;
      }
      if (this.abilitySuppressed(cardId, ability.id)) continue;
      const ctx: ResolutionContext = {
        sourceId: cardId,
        controllerId: card.controllerId,
        abilityId: ability.id,
        selected: {}
      };
      if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
        continue;
      }
      result.push(ability.ignoresRulesTextFrom);
    }
    return result;
  }

  /** True when `selector.zone` explicitly names `zone` (a bare selector defaults to in-play only, so it doesn't). */
  private selectorNamesZone(selector: CardSelector, zone: Zone): boolean {
    const z = selector.zone;
    if (z === undefined || z === "any") return false;
    return Array.isArray(z) ? z.includes(zone) : z === zone;
  }

  /** True when a mutation whose origin is `sourceId` must not affect `targetId` ("effects from <cardType> do not affect this card"; Parkour Hoodlum). */
  private sourceClassIgnoredByTarget(
    targetId: CardInstanceId,
    sourceId: CardInstanceId | undefined
  ): boolean {
    if (!sourceId || !this.state.cards[sourceId]) return false;
    const ignored = this.ignoredSourceTypesFor(targetId);
    if (ignored.length === 0) return false;
    const sourceTypes = this.getCardTypes(sourceId);
    return ignored.some(type => sourceTypes.includes(type));
  }

  // ---------------------------------------------------------------------------
  // Card play / response stack
  // ---------------------------------------------------------------------------

  private playCard(
    action: Extract<GameAction, { type: "playCard" }>
  ): void {
    this.assertCanDeployAtCurrentTiming(
      action.playerId,
      this.getDefinition(action.cardId),
      action.cardId
    );

    this.deployCard(
      action.playerId,
      action.cardId,
      action.selected ?? {},
      action.variables ?? {},
      false,
      false,
      undefined,
      false,
      action.mode
    );

    // "Your opponents cannot respond to this card." (Swindle) — resolve the
    // just-pushed stack item straight away, no response window of its own.
    if (this.getDefinition(action.cardId).behavior?.noResponse) {
      this.resolveTopOfStack();
      this.checkStateBasedActions();

      // If it was itself a response, the window is still open for the item
      // beneath it — hand priority to whoever may still respond to that
      // (CR §607.2).
      const w = this.state.responseWindow;
      if (
        w &&
        w.phase === "acceptingResponses" &&
        !this.state.pendingChoice &&
        this.responseStack.length > 0
      ) {
        const top = this.responseStack[this.responseStack.length - 1];
        w.priorityPlayerId = this.getOpponent(top.controllerId).id;
        this.state.priorityPlayerId = w.priorityPlayerId;
      }
      return;
    }

    this.afterStackAction(action.playerId);
  }

  /**
   * The core "put a hand card on the response stack" logic shared by a
   * normal playCard action and a `deployForFree` effect's nested play.
   * Timing (priority/response-window) legality is the caller's
   * responsibility — `deployForFree` deploys synchronously as part of
   * resolving another effect, not as a fresh player-initiated action, so it
   * deliberately skips `assertCanDeployAtCurrentTiming`.
   */
  private deployCard(
    playerId: PlayerId,
    cardId: CardInstanceId,
    selected: Record<string, CardInstanceId[]>,
    variables: Record<string, number>,
    free: boolean,
    fromZone = false,
    /**
     * A flat numeric cost that replaces `definition.cost` (and any
     * reductions / cost modifiers) — the "deploy this card for N"
     * alternative cost of a `revealFromHand` deploy (Witty Worm).
     */
    costOverride?: number,
    /**
     * Skip the printed-threshold gate — "deploy it for free even if you
     * cannot meet its threshold" (`deployFromZone.ignoreThreshold`; I Drink
     * Your Milkshake!).
     */
    ignoreThreshold = false,
    /** Chosen mode index for a modal tactic (`behavior.modes`). */
    mode?: number
  ): void {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(card.id);

    if (fromZone) {
      // "You may deploy the <card>" — a face-down permanent/tactic in play,
      // or a card in the discard pile. Flipping a face-down card face-up is
      // a leaves-play/enters-play boundary in its own right (RULES.md §2);
      // `moveCard` to "deploying" below fires that.
      assert(
        card.ownerId === playerId || card.controllerId === playerId,
        "You cannot deploy that card."
      );
      if (card.faceDown && card.zone === "play") {
        card.faceDown = false;
      }
      card.controllerId = playerId;
    } else {
      // "You may deploy the voided cards as though they were in your hand"
      // (Cheats) — a matching `voidPlayGrant` lets a void-zone card be
      // deployed like a hand card (optionally ignoring its threshold), even
      // one an opponent owns; the deploying player takes control of it.
      const voidGrant =
        card.zone === "void"
          ? this.state.voidPlayGrants.find(
              g => g.cardId === card.id && g.playerId === playerId
            )
          : undefined;
      // "While this card is depleted, you may deploy tactics in the void as
      // though they were in your hand" (Voidal Tactician) — a live
      // ContinuousAbility.voidPlay grant, not a persisted per-card entry.
      const voidAura =
        !voidGrant && card.zone === "void"
          ? this.continuousVoidPlayGrantFor(card.id, playerId)
          : undefined;
      if (voidGrant || voidAura) {
        card.controllerId = playerId;
        if (voidGrant?.ignoreThreshold || voidAura?.ignoreThreshold) {
          ignoreThreshold = true;
        }
      } else {
        assert(
          card.controllerId === playerId,
          "You do not control that card."
        );
        assert(card.zone === "hand", "Card must be in your hand.");
      }
    }

    assert(
      ignoreThreshold ||
        this.meetsThreshold(playerId, definition.threshold, {
          definition,
          cardId: card.id
        }),
      "Threshold requirements are not met."
    );

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: playerId,
      selected,
      variables
    };

    // Resolved before condition/targets/costs — e.g. "flip a coin; X is 1
    // or 2" has to be settled before "pick X or fewer items" can even be
    // validated.
    this.applyVariableRolls(this.getTacticVariableRolls(definition, mode), context);
    this.assertVariableBounds(this.getTacticVariableBounds(definition, mode), context);

    const tacticCondition = this.getTacticCondition(definition, mode);
    assert(
      !tacticCondition || this.evaluateCondition(tacticCondition, context),
      "This card cannot be deployed right now."
    );

    this.validateTargetDeclarations(
      this.getPlayTargetDeclarations(definition, mode),
      context
    );

    // Deploying for free waives only the numeric cost — any other extra
    // costs (targets, deplete, etc.) still apply, matching cards like
    // Spontaneous Displacement's "you still need to... satisfy its extra
    // costs" reminder text.
    const extraCosts = this.getTacticCosts(definition, mode).filter(
      cost => !free || cost.type !== "payResources"
    );

    // A pending "reduce the next numeric cost you pay this turn" is only
    // actually consumed once the whole payment is confirmed affordable —
    // peeked here, spliced out below, not before. A `costOverride` (Witty
    // Worm's flat alt cost) bypasses reductions and cost modifiers alike.
    const pendingReduction =
      free || costOverride !== undefined
        ? undefined
        : this.state.costReductions.find(
            reduction =>
              reduction.playerId === playerId &&
              (reduction.cardType === undefined ||
                reduction.cardType === definition.type)
          );

    // "reduce this card's numeric cost by the number of cards removed [as an
    // EXTRA COST]" (Opportunistic Pirate) — evaluated in the play context so
    // it can read the EXTRA-COST selections.
    const onPlayAdjust =
      !free && costOverride === undefined && definition.behavior?.onPlay?.costAdjust
        ? this.evaluateNumber(definition.behavior.onPlay.costAdjust, context)
        : 0;

    const numericCost = free
      ? 0
      : costOverride !== undefined
        ? Math.max(0, costOverride)
        : this.applyCostModifiers(
            playerId,
            cardId,
            Math.max(
              0,
              (definition.cost ?? 0) - (pendingReduction?.amount ?? 0) + onPlayAdjust
            )
          );

    const costs: Cost[] = [
      { type: "payResources", amount: numericCost },
      ...extraCosts
    ];

    assert(this.canPayCosts(costs, context), "Costs cannot be paid.");

    if (pendingReduction) {
      this.state.costReductions = this.state.costReductions.filter(
        reduction => reduction.id !== pendingReduction.id
      );
    }

    this.payCosts(costs, context);

    // "reduce the threshold requirement of the NEXT card you deploy" —
    // consumed now (its threshold gate was already checked above).
    this.state.thresholdReductions = this.state.thresholdReductions.filter(
      r => r.playerId !== playerId
    );

    this.moveCard(card.id, "deploying");

    const effects =
      definition.type === "tactic"
        ? this.getTacticEffects(definition, mode)
        : [];

    // "an opponent deployed at least 2 cards with the same name this turn" /
    // "an opponent deployed a character this turn" (deploysThisTurn)
    (this.state.turnDeploys[playerId] ??= []).push({
      name: definition.name,
      type: definition.type
    });

    // The `cardPlayed` event and the stack push are one step: a
    // `cardPlayed` trigger (e.g. "terminate the tactic") must see the card
    // already on the response stack. Batching defers the trigger until the
    // push below has happened.
    this.beginEventBatch();
    try {
      this.emit({
        type: "cardPlayed",
        cardId: card.id,
        playerId
      });

      this.responseStack.push({
        id: nextId("stack"),
        sourceId: card.id,
        controllerId: playerId,
        kind: "card",
        effects,
        context
      });
    } finally {
      this.endEventBatch();
    }
  }

  /** Hand cards `playerId` could deploy via a `deployForFree` effect right now. */
  private deployForFreeCandidates(
    playerId: PlayerId,
    maxCost: number,
    selector: CardSelector | undefined,
    context: ResolutionContext
  ): CardInstanceId[] {
    return Object.values(this.state.cards)
      .filter(card => {
        if (card.zone !== "hand" || card.controllerId !== playerId) return false;
        if ((this.getDefinition(card.id).cost ?? 0) > maxCost) return false;
        // The hand-zone gate is already applied; don't let the selector's
        // in-play zone default fight it.
        return (
          !selector ||
          this.matchesSelector(card, { ...selector, zone: "any" }, context)
        );
      })
      .map(card => card.id);
  }

  /**
   * Resolves the chosen card from a `deployForFree` effect: deploys it
   * (waiving its numeric cost) and resolves it synchronously — like any
   * other nested consequence of an effect, it does not open its own
   * response window — before continuing whatever ability the
   * `deployForFree` effect itself belonged to.
   */
  private deployCardForFree(
    playerId: PlayerId,
    cardId: CardInstanceId,
    selected: Record<string, CardInstanceId[]>,
    variables: Record<string, number>,
    fromZone = false,
    ignoreThreshold = false,
    payCost = false
  ): void {
    this.deployCard(
      playerId,
      cardId,
      selected,
      variables,
      !payCost,
      fromZone,
      undefined,
      ignoreThreshold
    );

    // Only reached once deployCard has committed (it throws before
    // mutating anything on a validation failure) — this IS the "deployed
    // for free" pendingChoice being answered, so clear it now.
    this.state.pendingChoice = undefined;

    // If the newly-deployed card's own resolution (e.g. its ETB trigger)
    // needs a chooser's input, that pause takes priority — the ability
    // that originally paused on `deployForFree` must stay parked in
    // pendingEffectFrames until this new pause is answered too, not get
    // resumed out from under it.
    if (this.resolveTopOfStack()) {
      this.resumeEffectFrames();
    }
  }

  /**
   * The play-time instruction block for a tactic — its first
   * activated-ability-shaped behavior, or, when the card is a modal tactic
   * (`behavior.modes`) and `mode` is supplied, that chosen mode. Non-tactic
   * permanents use `behavior.onPlay` instead (handled by each getter).
   */
  private getTacticSource(
    definition: CardDefinition,
    mode?: number
  ): {
    condition?: Condition;
    costs?: Cost[];
    targets?: TargetDeclaration[];
    variables?: Record<string, NumberExpression>;
    variableBounds?: Record<string, { min?: NumberExpression; max?: NumberExpression }>;
    effects?: Effect[];
  } | undefined {
    const modes = definition.behavior?.modes;
    if (modes && modes.length > 0) {
      const picked = modes[mode ?? 0];
      assert(picked, `Modal card '${definition.name}' has no mode ${mode}.`);
      return picked;
    }
    return definition.behavior?.abilities?.find(
      ability => ability.type === "activated"
    ) as ActivatedAbility | undefined;
  }

  private getPlayTargetDeclarations(
    definition: CardDefinition,
    mode?: number
  ): TargetDeclaration[] {
    const declarations: TargetDeclaration[] = [];

    if (definition.type === "tactic") {
      declarations.push(...(this.getTacticSource(definition, mode)?.targets ?? []));
    } else if (definition.behavior?.onPlay?.targets) {
      // A non-tactic permanent's "EXTRA COST: Pick ..." picks.
      declarations.push(...definition.behavior.onPlay.targets);
    }

    if (definition.attachTo) {
      declarations.push({
        id: ATTACH_TARGET_ID,
        selector: { type: definition.attachTo },
        count: 1
      });
    }

    return declarations;
  }

  private getTacticEffects(definition: CardDefinition, mode?: number): Effect[] {
    return this.getTacticSource(definition, mode)?.effects ?? [];
  }

  /** Extra costs beyond the printed numeric cost (e.g. "EXTRA COST: Choose a number for X. Pay X+X."). */
  private getTacticCosts(definition: CardDefinition, mode?: number): Cost[] {
    if (definition.type !== "tactic") {
      return definition.behavior?.onPlay?.costs ?? [];
    }
    return this.getTacticSource(definition, mode)?.costs ?? [];
  }

  /** A play-timing restriction beyond the normal response-window rules (e.g. "deploy this only while you are attacking"). */
  private getTacticCondition(
    definition: CardDefinition,
    mode?: number
  ): Condition | undefined {
    if (definition.type !== "tactic") {
      return definition.behavior?.onPlay?.condition;
    }
    return this.getTacticSource(definition, mode)?.condition;
  }

  private getTacticVariableRolls(
    definition: CardDefinition,
    mode?: number
  ): Record<string, NumberExpression> | undefined {
    if (definition.type !== "tactic") {
      return undefined;
    }
    return this.getTacticSource(definition, mode)?.variables;
  }

  /** Evaluates `rolls` once and merges them into `context.variables`, without overwriting anything already explicitly supplied there. */
  private applyVariableRolls(
    rolls: Record<string, NumberExpression> | undefined,
    context: ResolutionContext
  ): void {
    if (!rolls) {
      return;
    }

    const resolved: Record<string, number> = {};

    for (const [id, expression] of Object.entries(rolls)) {
      resolved[id] = this.evaluateNumber(expression, context);
    }

    context.variables = { ...resolved, ...context.variables };
  }

  /**
   * "Pick a number for X, where X is <= the number of [O] you control."
   * Validates a player-chosen `variable` against its declared bounds
   * (beyond plain affordability). Throws before any mutation.
   */
  private assertVariableBounds(
    bounds: Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined,
    context: ResolutionContext
  ): void {
    if (!bounds) return;

    for (const [id, bound] of Object.entries(bounds)) {
      const value = context.variables?.[id] ?? 0;
      if (bound.min !== undefined) {
        assert(
          value >= this.evaluateNumber(bound.min, context),
          `Chosen value for '${id}' is below its minimum.`
        );
      }
      if (bound.max !== undefined) {
        assert(
          value <= this.evaluateNumber(bound.max, context),
          `Chosen value for '${id}' is above its maximum.`
        );
      }
    }
  }

  private getTacticVariableBounds(
    definition: CardDefinition,
    mode?: number
  ): Record<string, { min?: NumberExpression; max?: NumberExpression }> | undefined {
    if (definition.type !== "tactic") {
      return undefined;
    }
    return this.getTacticSource(definition, mode)?.variableBounds;
  }

  // ---------------------------------------------------------------------------
  // Activated abilities
  // ---------------------------------------------------------------------------

  private activateAbility(
    action: Extract<GameAction, { type: "activateAbility" }>
  ): void {
    const card = this.requireCard(action.cardId);

    const ability = this.getCardActivatedAbilities(card.id).find(
      a => a.id === action.abilityId
    );

    assert(ability, "Activated ability not found.");

    // The Billionaire — "You may use abilities on your opponent's cards ...
    // the ability's effect happens as if your opponent used it." The numeric
    // cost is paid from the activator's resources; everything else resolves
    // with the opponent as the ability's controller.
    const borrowed =
      card.controllerId !== action.playerId &&
      ability.usableBy !== "anyPlayer" &&
      ability.usableBy !== "opponent" &&
      this.playerCanUseOpponentAbilities(action.playerId);
    const abilityControllerId = borrowed ? card.controllerId : action.playerId;

    assert(
      borrowed ||
        ability.usableBy === "anyPlayer" ||
        (ability.usableBy === "opponent"
          ? card.controllerId !== action.playerId
          : card.controllerId === action.playerId),
      "You do not control that card."
    );

    // Most abilities are usable only from `play`; RECUR / RETIRE-style ones
    // declare `activationZone: "discard"` (or hand/void) and are used from
    // there instead.
    const requiredZone = ability.activationZone ?? "play";
    assert(
      card.zone === requiredZone,
      `Source must be in zone '${requiredZone}' to use this ability.`
    );
    // A face-down card is an anonymous resource (RULES.md §4) — its own
    // printed abilities are inert while face-down, same as triggered
    // abilities (findTriggers) and continuous ones (getContinuousModifiers
    // et al.) already treat it. (Only meaningful for a `play`-zone source.)
    if (requiredZone === "play" && !ability.fromFaceDown) {
      assert(!card.faceDown, "A face-down card's abilities cannot be activated.");
    }

    assert(
      !this.hasRestriction(card.id, "cannotUseAbilities"),
      "This card's abilities cannot be used."
    );

    this.assertCanUseAbilityAtCurrentTiming(action.playerId);

    if (ability.threshold !== undefined && ability.threshold !== 0) {
      assert(
        this.meetsThreshold(abilityControllerId, ability.threshold),
        "Ability threshold requirements are not met."
      );
    }

    {
      // "It cannot be used again this turn." (Subsection 5, Paragraph 12) —
      // a `lockAbilityThisTurn` effect parks the sentinel here.
      const key = `${card.id}:${ability.id}`;
      assert(
        (this.state.abilityUsesThisTurn[key] ?? 0) < Number.MAX_SAFE_INTEGER,
        "This ability cannot be used again this turn."
      );
    }

    if (ability.usesPerTurn !== undefined) {
      const key = `${card.id}:${ability.id}`;
      assert(
        (this.state.abilityUsesThisTurn[key] ?? 0) < ability.usesPerTurn,
        `This ability can be used only ${ability.usesPerTurn} time(s) each turn.`
      );
    }

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: abilityControllerId,
      abilityId: ability.id,
      selected: action.selected ?? {},
      variables: action.variables ?? {}
    };

    this.applyVariableRolls(ability.variables, context);
    this.assertVariableBounds(ability.variableBounds, context);

    if (ability.condition) {
      assert(
        this.evaluateCondition(ability.condition, context),
        "Ability condition is not satisfied."
      );
    }

    this.validateTargetDeclarations(ability.targets ?? [], context);

    // "Reduce the numeric cost of your faction's abilities by 1, to a
    // minimum of 1." (First Unified Market of Abstract Secure Theoreticals) —
    // fold any `abilityCostModifiers` into the `payResources` costs.
    let effectiveCosts = this.applyAbilityCostModifiers(
      card.id,
      ability.costs ?? [],
      abilityControllerId,
      context
    );

    // A borrowed ability (The Billionaire): the numeric cost is paid from
    // the ACTIVATOR's resources; the rest is satisfied as the opponent.
    if (borrowed) {
      const numeric = effectiveCosts
        .filter(c => c.type === "payResources")
        .reduce(
          (sum, c) =>
            sum +
            this.evaluateNumber(
              (c as Extract<Cost, { type: "payResources" }>).amount,
              context
            ),
          0
        );
      assert(
        this.getAvailableResourceIds(action.playerId).length >= numeric,
        "Ability costs cannot be paid."
      );
      this.payNumericCost(action.playerId, numeric);
      effectiveCosts = effectiveCosts.filter(c => c.type !== "payResources");
    }

    assert(
      this.canPayCosts(effectiveCosts, context),
      "Ability costs cannot be paid."
    );

    this.payCosts(effectiveCosts, context);

    if (ability.usesPerTurn !== undefined) {
      const key = `${card.id}:${ability.id}`;
      this.state.abilityUsesThisTurn[key] =
        (this.state.abilityUsesThisTurn[key] ?? 0) + 1;
    }

    // Cost-triggered abilities happen immediately before the ability itself
    // enters the response chain.
    this.processImmediateQueue();

    this.responseStack.push({
      id: nextId("stack"),
      sourceId: card.id,
      controllerId: abilityControllerId,
      kind: "ability",
      abilityId: ability.id,
      effects: ability.effects,
      context
    });

    this.emit({
      type: "abilityActivated",
      cardId: card.id,
      abilityId: ability.id,
      playerId: action.playerId
    });

    this.afterStackAction(action.playerId);
  }

  /**
   * Flip up a face-down resource by paying its `flipUp` cost and resolve it
   * as its real card type, with `deployedViaFlipUp` set on the context. No
   * response window opens, but the effects (rider + the card's own) run
   * through `runEffectFrame`, so one that pauses on a chooser suspends
   * cleanly and the post-effects bookkeeping (`finishFlipUp` — discard a
   * flipped tactic / send a flipped permanent into play) waits for it.
   */
  private flipUpCard(
    action: Extract<GameAction, { type: "flipUp" }>
  ): void {
    const card = this.requireCard(action.cardId);
    const definition = this.getDefinition(card.id);

    assert(
      card.controllerId === action.playerId,
      "You do not control that card."
    );
    assert(
      card.zone === "play" && card.faceDown,
      "Only a face-down resource you control can be flipped up."
    );
    const flipUp = this.getEffectiveFlipUp(card.id);
    assert(flipUp, "That card has no FLIP UP cost.");
    assert(
      !this.state.playRestrictions.some(
        r => r.playerId === action.playerId && r.kind === "flipUp"
      ) && !this.continuousPlayRestricted(action.playerId, { kind: "flipUp" }),
      "You cannot play cards using FLIP UP right now."
    );
    assert(
      !card.attachedTo,
      "A resource attached to your faction cannot be flipped up."
    );

    this.assertCanUseAbilityAtCurrentTiming(action.playerId);
    assert(
      this.meetsThreshold(action.playerId, flipUp.threshold),
      "FLIP UP threshold requirements are not met."
    );

    const context: ResolutionContext = {
      sourceId: card.id,
      controllerId: action.playerId,
      selected: action.selected ?? {},
      variables: action.variables ?? {},
      deployedViaFlipUp: true
    };

    this.applyVariableRolls(this.getTacticVariableRolls(definition), context);
    this.assertVariableBounds(this.getTacticVariableBounds(definition), context);

    const condition = this.getTacticCondition(definition);
    assert(
      !condition || this.evaluateCondition(condition, context),
      "This card cannot be flipped up right now."
    );

    this.validateTargetDeclarations(
      this.getPlayTargetDeclarations(definition),
      context
    );

    const costs: Cost[] = [
      { type: "payResources", amount: flipUp.cost },
      ...this.getTacticCosts(definition)
    ];

    // Committed: the card is now its real type, not a face-down resource —
    // so it can't be spent to pay its own FLIP UP cost. Clear that before
    // checking/paying costs; roll back if the cost is unaffordable so a
    // failed flip-up leaves nothing mutated.
    card.faceDown = false;
    if (!this.canPayCosts(costs, context)) {
      card.faceDown = true;
      throw new Error("FLIP UP costs cannot be paid.");
    }
    this.payCosts(costs, context);

    // Its effects — the "...and your faction loses 5 influence" / "...and
    // draw a card" rider first, then the card's own — resolve through a
    // frame so a chooser among them pauses cleanly. A non-tactic
    // permanent's inline ETB (`behavior.onPlay.effects`) runs on the FLIP
    // UP path too, with the same play-time picks (`onPlay.targets` is
    // already validated into `context` above).

    const effects: Effect[] = [
      ...(flipUp.effects ?? []),
      ...(definition.type === "tactic"
        ? this.getTacticEffects(definition)
        : definition.behavior?.onPlay?.effects ?? [])
    ];

    this.runEffectFrame({
      effects,
      index: 0,
      context,
      finishFlipUp: {
        cardId: card.id,
        attachTargetId: definition.attachTo
          ? context.selected[ATTACH_TARGET_ID]?.[0]
          : undefined,
        context
      }
    });
  }

  /**
   * Post-effects bookkeeping for a FLIP UP resolution (see `flipUpCard` /
   * `PendingEffectFrame.finishFlipUp`): a flipped tactic goes to discard, a
   * flipped permanent enters play proper (attachment + attack-eligibility +
   * `cardEnteredPlay`). Runs once every rider/own effect — including
   * anything a paused chooser added — has finished.
   */
  private finishFlipUp(info: {
    cardId: CardInstanceId;
    attachTargetId?: CardInstanceId;
    context?: ResolutionContext;
  }): void {
    const card = this.state.cards[info.cardId];
    if (!card) return;

    const definition = this.getDefinition(card.id);

    if (definition.type === "tactic") {
      if (card.zone === "play") {
        this.applyTacticDisposition(
          card.id,
          info.context ?? {
            sourceId: card.id,
            controllerId: card.controllerId,
            selected: {},
            deployedViaFlipUp: true
          }
        );
      }
    } else {
      if (definition.attachTo) {
        card.attachedTo = info.attachTargetId;
      }
      card.attackEligibleTurn = undefined;
      this.emit({
        type: "cardEnteredPlay",
        cardId: card.id,
        playerId: card.controllerId
      });
    }

    this.processImmediateQueue();
    this.checkStateBasedActions();
  }

  /**
   * The entitled player declines to respond. The Spoils has no
   * priority-passing system (CR §607.2b): the player being responded to
   * never gets a pass of their own, so one decline is enough.
   *
   * - If an item is on the response stack, it now resolves (LIFO). The
   *   window flips to "resolving"; advanceFlow() pops it and then re-opens
   *   the window for whoever may still respond (CR §607.2).
   * - Otherwise this responder simply opened no chain. In a two-sided
   *   battle response window (CR §608.1c / §609.1a) hand off to the other
   *   side; once everyone has passed, the window closes.
   */
  private passPriority(playerId: PlayerId): void {
    const window = this.requireResponseWindow();

    assert(
      window.phase === "acceptingResponses",
      "Responses are currently resolving."
    );
    assert(
      window.priorityPlayerId === playerId,
      "It is not your priority."
    );

    if (this.responseStack.length > 0) {
      window.phase = "resolving";
      return;
    }

    // Empty stack: this responder is finished making top-level responses.
    // (`priorityPlayerId === playerId` is asserted above, and an empty-stack
    // window always tracks `pendingResponders[0]`, so this drops exactly
    // this player.)
    window.pendingResponders.shift();

    if (window.pendingResponders.length > 0) {
      window.priorityPlayerId = window.pendingResponders[0];
      this.state.priorityPlayerId = window.priorityPlayerId;
      return;
    }

    window.phase = "resolving";
  }

  /**
   * Advances exactly one automatic step:
   *
   * 1. Resolve the top response-stack item, then re-open the window for
   *    whoever may still respond (CR §607.2 / §607.2a), OR
   * 2. Hand a two-sided battle window to its next responder / close it and
   *    resume the interrupted turn/battle flow once nobody has anything
   *    left to add, OR
   * 3. Clear a finished battle after the UI has had a chance to render it.
   */
  private advanceFlow(): void {
    const window = this.state.responseWindow;

    if (window) {
      assert(
        window.phase === "resolving",
        "Players must finish responding before the flow can advance."
      );

      if (this.responseStack.length > 0) {
        const settled = this.resolveTopOfStack();
        // A chooser mid-resolution parks the item; its pendingChoice's
        // resolution path resumes the frame and then re-enters this flow.
        if (settled && !this.state.pendingChoice) {
          this.reopenOrCloseResponseWindow();
        }
        return;
      }

      this.reopenOrCloseResponseWindow();
      return;
    }

    if (this.state.battle?.phase === "finished") {
      this.state.battle = undefined;
      this.state.priorityPlayerId = this.state.activePlayerId;
      return;
    }

    throw new Error("There is no automatic game-flow step to advance.");
  }

  /**
   * Run after a response-stack item finishes resolving (inline via
   * advanceFlow, or after a chooser pause once its effect frames drain).
   * Re-opens the response window for whoever may respond next — the opponent
   * of the new top item's controller (CR §607.1 — never the controller
   * themselves), or the next queued top-level responder — or closes it and
   * resumes the interrupted flow once the stack and the responder queue are
   * both empty.
   */
  private reopenOrCloseResponseWindow(): void {
    const window = this.state.responseWindow;
    if (!window || window.phase !== "resolving") return;
    // Still mid-resolution somewhere up the call chain — don't act yet.
    if (this.state.pendingChoice) return;
    if (this.state.pendingEffectFrames.length > 0) return;

    if (this.responseStack.length > 0) {
      const top = this.responseStack[this.responseStack.length - 1];
      window.phase = "acceptingResponses";
      window.priorityPlayerId = this.getOpponent(top.controllerId).id;
      this.state.priorityPlayerId = window.priorityPlayerId;
      return;
    }

    if (window.pendingResponders.length > 0) {
      window.phase = "acceptingResponses";
      window.priorityPlayerId = window.pendingResponders[0];
      this.state.priorityPlayerId = window.priorityPlayerId;
      return;
    }

    const continuation = structuredClone(window.continuation);
    this.state.responseWindow = undefined;
    this.state.priorityPlayerId = this.state.activePlayerId;
    this.resumeContinuation(continuation);
  }

  /** Returns true if the popped item's effects (and any bookkeeping after them) ran to completion without pausing on a chooser effect. */
  private resolveTopOfStack(): boolean {
    const item = this.responseStack.pop();

    assert(item, "Response stack is empty.");

    if (this.logEnabled) {
      // Source may have left play since the item was pushed (RULES.md §10) —
      // look everything up defensively; the log must never abort resolution.
      const sourceDef = this.state.cards[item.sourceId]
        ? this.definitions[this.state.cards[item.sourceId].definitionId]
        : undefined;
      const abilityName = sourceDef?.behavior?.abilities?.find(
        a => a.id === item.abilityId
      )?.name;
      const what =
        item.kind === "ability"
          ? `${abilityName ? `"${abilityName}"` : "an ability"} on ${this.logCardName(item.sourceId)}`
          : this.logCardName(item.sourceId);
      this.recordLogMarker(
        "stackItemResolving",
        "resolution",
        `${what} resolves`,
        this.responseStack.length
      );
    }

    return this.runEffectFrame({
      effects: item.effects,
      index: 0,
      context: item.context,
      finishStackItem: item
    });
  }

  private finishStackItem(item: StackItem): void {
    if (item.kind === "card") {
      const card = this.requireCard(item.sourceId);
      const definition = this.getDefinition(card.id);

      if (definition.type === "tactic") {
        // "the last tactic deployed this turn" (Voidal Replication) — a
        // tactic that has finished resolving.
        this.state.lastDeployedTacticId = card.id;
        if (card.zone === "deploying") {
          this.applyTacticDisposition(card.id, item.context);
        }
      } else if (card.zone === "deploying") {
        this.moveCard(card.id, "play");

        if (definition.attachTo) {
          card.attachedTo = item.context.selected[ATTACH_TARGET_ID]?.[0];
        }

        // A card entering during the active turn did not start that turn in
        // play, so it is not attack-eligible unless it has AGGRO.
        card.attackEligibleTurn = undefined;

        this.emit({
          type: "cardEnteredPlay",
          cardId: card.id,
          playerId: card.controllerId
        });

        // A non-tactic's `behavior.onPlay.effects` are its inline ETB — they
        // resolve here, with the play-time context (so the EXTRA COST picks
        // in `item.context.selected` are available).
        for (const effect of definition.behavior?.onPlay?.effects ?? []) {
          this.resolveEffect(effect, item.context);
        }
      }
    }

    this.processImmediateQueue();
    this.checkStateBasedActions();
  }

  /**
   * Resolves `frame.effects` from `frame.index`, pausing (leaving a
   * `pendingChoice` set and re-pushing the remainder onto
   * `state.pendingEffectFrames`) the moment a "chooser" effect
   * (`chooserSelectsTarget`, `chooserSelectsOption`, `lookAndReorder`,
   * `deployForFree`) needs a specific player's input. Returns true if the
   * frame ran to completion (and `finishStackItem`, if set, has already
   * been handled).
   */
  private runEffectFrame(frame: PendingEffectFrame): boolean {
    for (let i = frame.index; i < frame.effects.length; i++) {
      this.resolveEffect(frame.effects[i], frame.context);
      this.processImmediateQueue();
      this.checkStateBasedActions();

      if (this.state.pendingChoice) {
        this.state.pendingEffectFrames.push({ ...frame, index: i + 1 });
        return false;
      }

      // "Attack that player. ... resolve the battle immediately and before
      // you draw the card." (Counter Attack) — an `initiateAttack` that
      // actually started a battle hands off to the normal battle flow; the
      // rest of this list runs as an `endOfBattle` rider.
      if (
        frame.effects[i].type === "initiateAttack" &&
        this.state.battle &&
        this.state.battle.phase !== "finished"
      ) {
        const rest = frame.effects.slice(i + 1);
        if (rest.length > 0) {
          this.state.scheduledEffects.push({
            id: nextId("scheduled"),
            when: "endOfBattle",
            turnScheduled: this.state.turn,
            sourceId: frame.context.sourceId,
            controllerId: frame.context.controllerId,
            effects: rest
          });
        }
        if (frame.finishStackItem) this.finishStackItem(frame.finishStackItem);
        if (frame.finishFlipUp) this.finishFlipUp(frame.finishFlipUp);
        return true;
      }
    }

    if (frame.finishStackItem) {
      this.finishStackItem(frame.finishStackItem);
    }

    if (frame.finishFlipUp) {
      this.finishFlipUp(frame.finishFlipUp);
    }

    return true;
  }

  /**
   * Continues whatever was suspended in `state.pendingEffectFrames`, most
   * recently-paused first (LIFO — a chooser effect's own `effects` finish
   * before the outer ability they were nested in resumes). Call once a
   * chooser-style pendingChoice has been answered and its immediate
   * follow-up effects (if any) have been pushed as a new frame.
   */
  private resumeEffectFrames(): void {
    while (this.state.pendingEffectFrames.length > 0) {
      const frame = this.state.pendingEffectFrames.pop()!;
      const completed = this.runEffectFrame(frame);
      if (!completed) return;
    }

    // A response-stack item that had paused on a chooser has now finished
    // draining — continue the response flow (re-open the window for the next
    // responder, or close it). A no-op outside a resolving response window.
    this.reopenOrCloseResponseWindow();
  }

  private afterStackAction(actingPlayerId: PlayerId): void {
    const existing = this.state.responseWindow;

    if (existing) {
      assert(
        existing.phase === "acceptingResponses",
        "Cannot add a response while the chain is resolving."
      );

      // A fresh item is on top of the stack; only the opponent of whoever
      // just acted may respond to it (CR §607.1). The stack itself carries
      // the LIFO ordering — no priority hand-back to the actor.
      existing.priorityPlayerId = this.getOpponent(actingPlayerId).id;
      this.state.priorityPlayerId = existing.priorityPlayerId;
      return;
    }

    // A main-phase deploy / ability: its stack item drives the whole
    // window. Only the opponent responds and it closes once the item
    // resolves — there is no top-level responder queue (CR §607.2b).
    this.openResponseWindow(
      "action",
      this.getOpponent(actingPlayerId).id,
      { type: "main" },
      []
    );
  }

  private openResponseWindow(
    kind: ResponseWindowKind,
    firstPlayerId: PlayerId,
    continuation: ResponseContinuation,
    pendingResponders: PlayerId[]
  ): void {
    assert(
      !this.state.responseWindow,
      "A response window is already open."
    );

    this.state.responseWindow = {
      id: nextId("response"),
      kind,
      phase: "acceptingResponses",
      priorityPlayerId: firstPlayerId,
      pendingResponders: [...pendingResponders],
      continuation
    };

    this.state.priorityPlayerId = firstPlayerId;

    // Only bracket the "respond to your opponent's action / turn-end"
    // windows; the battle response points open constantly during resolution
    // and the battle events themselves already carry the sequence.
    if (kind === "action" || kind === "endTurn") {
      this.recordLogMarker(
        "responseWindowOpened",
        "info",
        `${this.logPlayerName(firstPlayerId)} may respond`,
        this.responseStack.length
      );
    }
  }

  private resumeContinuation(
    continuation: ResponseContinuation
  ): void {
    switch (continuation.type) {
      case "main":
        this.state.priorityPlayerId = this.state.activePlayerId;
        return;

      case "endTurn":
        this.finishTurn(continuation.playerId);
        return;

      case "battleBlocking": {
        const battle = this.requireBattleId(continuation.battleId);
        battle.phase = "blocking";
        this.state.priorityPlayerId = battle.defenderPlayerId;
        return;
      }

      case "battleAssignDamage": {
        const battle = this.requireBattleId(continuation.battleId);
        this.enterDamageAssignment(battle);
        return;
      }

      case "battleInflictDamage": {
        const battle = this.requireBattleId(continuation.battleId);
        this.inflictLockedBattleDamage(battle);
        this.prepareNextSpeedGroupOrFinish(battle);
        return;
      }
    }
  }

  private assertCanDeployAtCurrentTiming(
    playerId: PlayerId,
    definition: CardDefinition,
    cardId?: CardInstanceId
  ): void {
    // CR §203.1: a resource is played only when an effect instructs you to
    // (the faction Develop Rule via `chooseDevelop`, or a card effect) —
    // never as a normal card deploy.
    assert(
      definition.type !== "resource",
      "Resource cards can only be played when an effect instructs you to (e.g. the develop rule)."
    );

    assert(
      !this.state.playRestrictions.some(
        r =>
          r.playerId === playerId &&
          r.kind === "cardType" &&
          r.cardType === definition.type
      ),
      `You cannot play ${definition.type} cards right now.`
    );

    // Standing "you may not play X" from an in-play ContinuousAbility.
    // playRestrictions (Geldale, City-Fortress).
    assert(
      !this.continuousPlayRestricted(playerId, { cardType: definition.type }),
      `You cannot play ${definition.type} cards right now.`
    );

    // "The named card cannot be deployed." (Incriminating Photograph).
    assert(
      !this.continuousPlayRestricted(playerId, { name: definition.name }),
      `'${definition.name}' cannot be deployed right now.`
    );

    const window = this.state.responseWindow;

    if (window) {
      assert(
        window.phase === "acceptingResponses",
        "Responses are already resolving."
      );
      assert(
        window.priorityPlayerId === playerId,
        "It is not your priority."
      );
      assert(
        definition.type === "tactic" ||
          (cardId
            ? this.hasKeyword(cardId, "tactical")
            : this.definitionHasKeyword(definition, "tactical")),
        "Only tactics or TACTICAL cards may be deployed as responses."
      );
      return;
    }

    assert(
      !this.state.battle,
      "Cards may only be deployed during a battle in a response window."
    );
    assert(
      this.responseStack.length === 0,
      "Cannot begin a new action while responses are unresolved."
    );
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player may deploy a normal turn action."
    );
  }

  private assertCanUseAbilityAtCurrentTiming(
    playerId: PlayerId
  ): void {
    assert(
      this.canUseAbilityAtCurrentTiming(playerId),
      "Ability cannot be used at the current timing."
    );
  }

  private canUseAbilityAtCurrentTiming(
    playerId: PlayerId
  ): boolean {
    const window = this.state.responseWindow;

    if (window) {
      return (
        window.phase === "acceptingResponses" &&
        window.priorityPlayerId === playerId
      );
    }

    return (
      !this.state.battle &&
      this.responseStack.length === 0 &&
      playerId === this.state.activePlayerId
    );
  }

  private requireResponseWindow(): ResponseWindowState {
    const window = this.state.responseWindow;
    assert(window, "No response window is open.");
    return window;
  }

  // ---------------------------------------------------------------------------
  // Event / trigger system
  // ---------------------------------------------------------------------------

  emit(event: GameEvent): void {
    const tallyKey =
      "playerId" in event && event.playerId
        ? `${event.type}:${event.playerId}`
        : event.type;
    this.state.turnEventTally[tallyKey] =
      (this.state.turnEventTally[tallyKey] ?? 0) + 1;

    // Per-turn damage history — "a character that inflicted damage to your
    // faction this turn" (Drive By Boobing), "has not assigned damage this
    // turn" (Backdoor Brigand).
    if (event.type === "damageDealt" && event.sourceId) {
      const rec = (this.state.damageThisTurn[event.sourceId] ??= {
        assigned: false,
        toFactionOf: [],
        toCards: []
      });
      rec.assigned = true;
      if (!rec.toCards.includes(event.targetId)) {
        rec.toCards.push(event.targetId);
      }
      const victim = this.state.cards[event.targetId];
      if (victim && this.getDefinition(event.targetId).type === "faction") {
        if (!rec.toFactionOf.includes(victim.ownerId)) {
          rec.toFactionOf.push(victim.ownerId);
        }
      }
    }

    this.recordLogEvent(event);

    const batchId = nextId("batch");
    const triggers = this.findTriggers(event, batchId);

    for (const trigger of triggers) {
      this.immediateQueue.push(trigger);
    }

    if (this.eventBatchDepth === 0) {
      this.processImmediateQueue();
    }
  }

  private beginEventBatch(): void {
    this.eventBatchDepth++;
  }

  private endEventBatch(): void {
    assert(this.eventBatchDepth > 0, "No event batch is active.");

    this.eventBatchDepth--;

    if (this.eventBatchDepth === 0) {
      this.processImmediateQueue();
    }
  }

  private findTriggers(event: GameEvent, batchId: string): TriggerResolution[] {
    const results: TriggerResolution[] = [];

    const eventCardId = this.getEventCardId(event);

    for (const card of Object.values(this.state.cards)) {
      // A card's own "leaves play" trigger (cardDestroyed, or cardMoved out
      // of `play`) must still be considered even though `moveCard` already
      // updated this card's zone before emit() was called — otherwise the
      // zone check below would always filter out the one card the event is
      // actually about.
      const isLeavingPlayEventSource =
        eventCardId === card.id &&
        (event.type === "cardDestroyed" ||
          (event.type === "cardMoved" && event.from === "play"));

      const definition = this.getDefinition(card.id);

      const ownAbilities = (definition.behavior?.abilities ?? []).filter(
        (a): a is Extract<AbilityDefinition, { type: "triggered" }> =>
          a.type === "triggered"
      );
      // Abilities granted to this card by an in-play continuous
      // `grantedAbilities` aura ("all characters gain the rules text ...").
      const grantedAbilities =
        card.zone === "play" && !card.faceDown
          ? this.getGrantedTriggeredAbilities(card.id)
          : [];

      for (const ability of [...ownAbilities, ...grantedAbilities]) {
        if (ability.event !== event.type) {
          continue;
        }

        if (this.abilitySuppressed(card.id, ability.id)) {
          continue;
        }

        // A trigger is normally live only while its source is face-up in
        // play; `triggerZone` moves that to another zone ("while this card
        // is in your discard pile, when ...").
        const triggerZone = ability.triggerZone ?? "play";
        if (triggerZone === "play") {
          if (
            (card.zone !== "play" && !isLeavingPlayEventSource) ||
            card.faceDown
          ) {
            continue;
          }
        } else if (card.zone !== triggerZone) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: card.id,
          controllerId: card.controllerId,
          abilityId: ability.id,
          event,
          selected: {}
        };

        if (
          !ability.condition ||
          this.evaluateCondition(ability.condition, context)
        ) {
          results.push({
            sourceId: card.id,
            ability,
            context,
            batchId
          });
        }
      }
    }

    return results;
  }

  /**
   * Triggered abilities granted to `cardId` by every in-play, face-up
   * `ContinuousAbility.grantedAbilities` aura whose `condition` holds and
   * whose per-block `selector` matches `cardId`. The granted abilities fire
   * for `cardId` itself (not the granting source).
   */
  private getGrantedTriggeredAbilities(
    cardId: CardInstanceId
  ): Array<Extract<AbilityDefinition, { type: "triggered" }>> {
    const results: Array<Extract<AbilityDefinition, { type: "triggered" }>> = [];
    const target = this.state.cards[cardId];
    if (!target) return results;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.grantedAbilities) continue;

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }

        for (const block of ability.grantedAbilities) {
          if (!this.matchesSelector(target, block.selector, ctx)) continue;
          for (const granted of block.abilities) {
            if (granted.type === "triggered") results.push(granted);
          }
        }
      }
    }

    // "gains all rules text of the removed character" (Skin Suit) — a
    // permanent snapshot on `state.abilityGrants`, live while the recipient
    // is in play.
    for (const grant of this.state.abilityGrants) {
      if (grant.cardId !== cardId) continue;
      for (const granted of grant.abilities) {
        if (granted.type === "triggered") results.push(granted);
      }
    }

    return results;
  }

  /**
   * Activated abilities granted to `cardId` by an in-play
   * `ContinuousAbility.grantedAbilities` aura (the parallel of
   * `getGrantedTriggeredAbilities`) — "each character you control gains
   * 'RESEARCH — ...'." (Jo Ciendeilio). They activate with `cardId` as
   * their source.
   */
  private getGrantedActivatedAbilities(
    cardId: CardInstanceId
  ): ActivatedAbility[] {
    const results: ActivatedAbility[] = [];
    const target = this.state.cards[cardId];
    if (!target || target.zone !== "play" || target.faceDown) return results;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.grantedAbilities) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        for (const block of ability.grantedAbilities) {
          if (!this.matchesSelector(target, block.selector, ctx)) continue;
          for (const granted of block.abilities) {
            if (granted.type === "activated") results.push(granted);
          }
        }
      }
    }

    // Skin Suit's "gains all rules text of the removed character".
    for (const grant of this.state.abilityGrants) {
      if (grant.cardId !== cardId) continue;
      for (const granted of grant.abilities) {
        if (
          granted.type === "activated" &&
          !this.abilitySuppressed(cardId, granted.id)
        ) {
          results.push(granted);
        }
      }
    }
    return results;
  }

  /**
   * `cardId`'s own continuous abilities PLUS any continuous ability granted
   * to it — by an in-play `ContinuousAbility.grantedAbilities` block whose
   * per-block `selector` matches it (God's Blessing of ___), or a permanent
   * `state.abilityGrants` snapshot (Skin Suit). A granted continuous
   * ability is resolved with `cardId` as its source, so "All your
   * characters gain 1 strength" inside the granted text scopes to the
   * recipient's controller. The parallel of `getGrantedTriggeredAbilities`
   * / `getGrantedActivatedAbilities` for the continuous recompute.
   */
  private getEffectiveContinuousAbilities(
    cardId: CardInstanceId
  ): Array<Extract<AbilityDefinition, { type: "continuous" }>> {
    const own = (this.getDefinition(cardId).behavior?.abilities ?? []).filter(
      (a): a is Extract<AbilityDefinition, { type: "continuous" }> =>
        a.type === "continuous"
    );

    const target = this.state.cards[cardId];
    if (!target || target.zone !== "play" || target.faceDown) return own;

    const granted: Array<Extract<AbilityDefinition, { type: "continuous" }>> = [];

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      if (source.id === cardId) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.grantedAbilities) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, ctx)
        ) {
          continue;
        }
        for (const block of ability.grantedAbilities) {
          if (!this.matchesSelector(target, block.selector, ctx)) continue;
          for (const g of block.abilities) {
            if (g.type === "continuous") granted.push(g);
          }
        }
      }
    }

    for (const grant of this.state.abilityGrants) {
      if (grant.cardId !== cardId) continue;
      for (const g of grant.abilities) {
        if (g.type === "continuous") granted.push(g);
      }
    }

    return granted.length ? [...own, ...granted] : own;
  }

  /**
   * Visit every in-play, face-up card's live continuous abilities (own +
   * granted) whose `condition` currently holds, with a resolution context
   * rooted on that source. The generic loop behind the newer
   * `ContinuousAbility` fields (`preventsDefeat`, `drawModifiers`,
   * `influenceModifiers`, `attackTax`, …).
   */
  private forEachActiveContinuous(
    visit: (
      source: CardInstance,
      ability: Extract<AbilityDefinition, { type: "continuous" }>,
      context: ResolutionContext
    ) => void
  ): void {
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }
        visit(source, ability, context);
      }
    }
  }

  /**
   * Total `ContinuousAbility.searchTax` levied on `playerId` searching their
   * own deck (0 = no tax). `searchTax` with `amount` omitted / evaluating to
   * 0 still returns 0 here — a hard "cannot search" is authored as a large
   * `amount` the player can't afford, or handled by the caller.
   */
  private searchTaxFor(playerId: PlayerId): number {
    let tax = 0;
    this.forEachActiveContinuous((source, ability, context) => {
      const rule = ability.searchTax;
      if (!rule) return;
      if (!this.scopeMatchesPlayer(rule.player, source.controllerId, playerId)) {
        return;
      }
      tax += Math.max(
        0,
        rule.amount === undefined ? 0 : this.evaluateNumber(rule.amount, context)
      );
    });
    return tax;
  }

  /** Resolve a `"self" | "opponent" | "any"` player scope against a source. */
  private scopeMatchesPlayer(
    scope: "self" | "opponent" | "any",
    sourceControllerId: PlayerId,
    playerId: PlayerId
  ): boolean {
    if (scope === "any") return true;
    if (scope === "self") return sourceControllerId === playerId;
    return this.getOpponent(sourceControllerId).id === playerId;
  }

  private processImmediateQueue(): void {
    while (this.immediateQueue.length > 0) {
      // A pendingChoice already outstanding (set by whatever called into
      // this — directly, or several frames up a reentrant call chain) must
      // be answered before anything else in the queue is touched. Without
      // this guard, a reentrant call reached via a *different* path (e.g.
      // finishBattle's own beginEventBatch/endEventBatch, entered from
      // resumeContinuation right after this same queue produced the still-
      // unanswered choice) can reach the next queued trigger and resolve it
      // — and if that trigger's own effects set pendingChoice too, it
      // silently overwrites the first one before anyone ever saw or
      // answered it, permanently losing that trigger's effects.
      if (this.state.pendingChoice) return;

      // Peeked, not shifted: if this trigger turns out to need a player
      // choice, it must stay at the head of the queue so resolvePendingChoice
      // can resume exactly here afterward.
      const trigger = this.immediateQueue[0];

      if (
        !this.state.cards[trigger.sourceId] &&
        trigger.context.event?.type !== "cardDestroyed"
      ) {
        this.immediateQueue.shift();
        continue;
      }

      // RULES.md §7: triggers firing "at once" (from the same event) are
      // ordered by their common controller, or by the active player if
      // they belong to different players — never by iteration order.
      const batch = this.getUnorderedTriggerBatch(trigger.batchId);

      if (batch.length > 1) {
        const controllerIds = new Set(
          batch.map(queued => queued.context.controllerId)
        );

        this.state.pendingChoice = {
          kind: "orderTriggers",
          id: nextId("choice"),
          playerId:
            controllerIds.size === 1
              ? [...controllerIds][0]
              : this.state.activePlayerId,
          triggers: batch.map(queued => ({
            sourceId: queued.sourceId,
            abilityId: queued.ability.id
          }))
        };

        return;
      }

      const declarations = trigger.ability.targets ?? [];
      const unresolved = this.findUnresolvedTargetDeclarations(
        declarations,
        trigger.context
      );

      if (unresolved.length > 0) {
        this.state.pendingChoice = {
          kind: "selectTargets",
          id: nextId("choice"),
          playerId: trigger.context.controllerId,
          sourceId: trigger.sourceId,
          abilityId: trigger.ability.id,
          declarations: unresolved
        };

        return;
      }

      if (declarations.length) {
        // Only unambiguous declarations reach here — exactly enough legal
        // candidates to fill every slot, nothing left to decide.
        this.autoSelectTargets(declarations, trigger.context);
      }

      // Committed: remove before resolving effects. An effect can itself
      // emit an event (e.g. dealDamage → damageDealt), reentrantly calling
      // processImmediateQueue — this trigger must not still be at the head
      // when that happens, or it gets resolved again and recurses forever.
      this.immediateQueue.shift();

      const triggerLabel = trigger.ability.name
        ? `"${trigger.ability.name}"`
        : "triggered ability";
      this.recordLogMarker(
        "triggerResolving",
        "trigger",
        `${this.logCardName(trigger.sourceId)}'s ${triggerLabel} resolves`,
        this.responseStack.length
      );

      const completed = this.runEffectFrame({
        effects: trigger.ability.effects,
        index: 0,
        context: trigger.context
      });

      if (!completed) return;
    }
  }

  /** The leading run of immediateQueue entries sharing one batchId (same emitted event). */
  private getUnorderedTriggerBatch(batchId: string): TriggerResolution[] {
    const batch: TriggerResolution[] = [];

    for (const trigger of this.immediateQueue) {
      if (trigger.batchId !== batchId) break;
      batch.push(trigger);
    }

    return batch;
  }

  /**
   * Target declarations a triggered ability can't fill on its own — more
   * legal candidates than slots, so a real decision is needed (RULES.md §7's
   * "a real client should request choices here"). A declaration with too
   * few candidates is left for autoSelectTargets to reject as before; that's
   * a genuinely unplayable trigger, not a choice.
   */
  private findUnresolvedTargetDeclarations(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): TargetDeclaration[] {
    const unresolved: TargetDeclaration[] = [];

    for (const declaration of declarations) {
      if (context.selected[declaration.id]) {
        continue;
      }

      const candidates = this.targetCandidates(declaration.selector, context);
      const max = this.evaluateNumber(declaration.count, context);

      // An optional declaration is always a real decision when at least
      // one legal candidate exists — the controller might decline (or, for
      // an "N or fewer" range, pick fewer than the max) even when there's
      // exactly one, unlike a mandatory declaration (which is only
      // "unresolved" when genuinely ambiguous).
      if (
        candidates.length > max ||
        (declaration.optional && candidates.length > 0)
      ) {
        unresolved.push(declaration);
      }
    }

    return unresolved;
  }

  // ---------------------------------------------------------------------------
  // Conditions / expressions
  // ---------------------------------------------------------------------------

  evaluateCondition(
    condition: Condition,
    context: ResolutionContext
  ): boolean {
    switch (condition.type) {
      case "and":
        return condition.conditions.every(condition =>
          this.evaluateCondition(condition, context)
        );

      case "or":
        return condition.conditions.some(condition =>
          this.evaluateCondition(condition, context)
        );

      case "not":
        return !this.evaluateCondition(
          condition.condition,
          context
        );

      case "sourceInZone":
        return (
          this.state.cards[context.sourceId]?.zone ===
          condition.zone
        );

      case "sourceIsEventCard":
        return (
          this.getEventCardId(context.event) ===
          context.sourceId
        );

      case "eventCardIs":
        return (
          this.getEventCardId(context.event) ===
          this.resolveTargetRef(condition.target, context)
        );

      case "targetInZone": {
        const cardId = this.resolveTargetRef(condition.target, context);
        return !!cardId && this.state.cards[cardId]?.zone === condition.zone;
      }

      case "targetOwnedBy": {
        const cardId = this.resolveTargetRef(
          condition.target ?? { type: "selected", id: "__candidate" },
          context
        );
        if (!cardId) return false;
        const ownerId = this.state.cards[cardId]?.ownerId;
        return !!ownerId && ownerId === this.resolvePlayerRef(condition.player, context).id;
      }

      case "isToken": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return !!cardId && !!this.state.cards[cardId]?.isToken;
      }

      case "battleDamageAssigned": {
        const battle = this.state.battle;
        if (!battle) return false;
        return compare(
          battle.assignedDamageBy.length,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "battleTargetIs": {
        const battle = this.state.battle;
        if (!battle || battle.phase === "finished" || battle.target.type !== "card") {
          return false;
        }
        const targetId = battle.target.cardId;
        if (
          condition.cardType &&
          !this.hasCardType(targetId, condition.cardType)
        ) {
          return false;
        }
        if (condition.controlledBy) {
          const who = this.resolvePlayerRef(condition.controlledBy, context).id;
          if (this.state.cards[targetId]?.controllerId !== who) return false;
        }
        return true;
      }

      case "eventCardControlledBy": {
        const eventCardId = this.getEventCardId(context.event);

        if (!eventCardId) {
          return false;
        }

        const eventCard = this.state.cards[eventCardId];

        if (!eventCard) {
          return false;
        }

        return (
          eventCard.controllerId ===
          this.resolvePlayerRef(condition.player, context).id
        );
      }

      case "targetExists":
        return this.resolveTargetRef(
          condition.target,
          context
        ) !== undefined;

      case "cardTypeIs": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        return !!cardId && this.hasCardType(cardId, condition.cardType);
      }

      case "cardTradeIs": {
        const cardId = this.resolveTargetRef(condition.target, context);
        return !!cardId && this.getDefinition(cardId).trade === condition.trade;
      }

      case "hasUnique": {
        const cardId = this.resolveTargetRef(condition.target, context);
        return !!cardId && this.getEffectiveUnique(cardId) != null;
      }

      case "hasAbility": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) return false;
        const definition = this.getDefinition(cardId);
        const abilities = [
          ...(definition.behavior?.abilities ?? []),
          ...(definition.faction?.abilities ?? [])
        ].filter(a => !this.abilitySuppressed(cardId, a.id));
        return condition.abilityType
          ? abilities.some(a => a.type === condition.abilityType)
          : abilities.length > 0;
      }

      case "statCompare": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        if (!cardId) {
          return false;
        }

        return compare(
          this.getStat(cardId, condition.stat),
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "counterCompare": {
        const cardId = this.resolveTargetRef(
          condition.target,
          context
        );

        if (!cardId) {
          return false;
        }

        const count =
          this.requireCard(cardId).counters[
            condition.counter
          ] ?? 0;

        return compare(
          count,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "numberCompare": {
        return compare(
          this.evaluateNumber(condition.left, context),
          condition.operator,
          this.evaluateNumber(condition.right, context)
        );
      }

      case "inBattle": {
        const cardId = this.resolveTargetRef(condition.target, context);
        const battle = this.state.battle;

        if (!cardId || !battle) {
          return false;
        }

        if (condition.role === "attacker") {
          return battle.attackingParty.includes(cardId);
        }

        if (condition.role === "blocker") {
          return battle.blockingParty.includes(cardId);
        }

        return (
          battle.attackingParty.includes(cardId) ||
          battle.blockingParty.includes(cardId)
        );
      }

      case "sourceIsDamageSource": {
        return (
          context.event?.type === "damageDealt" &&
          context.event.sourceId === context.sourceId
        );
      }

      case "cardMovedFromZone": {
        return (
          context.event?.type === "cardMoved" &&
          context.event.from === condition.zone
        );
      }

      case "cardMovedToZone": {
        return (
          context.event?.type === "cardMoved" &&
          context.event.to === condition.zone
        );
      }

      case "eventOrdinal": {
        const event = context.event;
        if (!event) return false;
        const key =
          "playerId" in event && event.playerId
            ? `${event.type}:${event.playerId}`
            : event.type;
        return compare(
          this.state.turnEventTally[key] ?? 0,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "deploySameNameThisTurn": {
        const player = this.resolvePlayerRef(condition.player, context);
        const names = (this.state.turnDeploys[player.id] ?? []).map(d => d.name);
        const counts = new Map<string, number>();
        let max = 0;
        for (const name of names) {
          const n = (counts.get(name) ?? 0) + 1;
          counts.set(name, n);
          if (n > max) max = n;
        }
        return compare(
          max,
          condition.operator,
          this.evaluateNumber(condition.value, context)
        );
      }

      case "respondingTo": {
        if (condition.respondsTo === "ability") {
          for (let i = this.responseStack.length - 1; i >= 0; i--) {
            const item = this.responseStack[i];
            if (item.sourceId === context.sourceId) continue;
            return item.kind === "ability";
          }
          return false;
        }
        const targetId = this.getRespondedToCardId(context);
        if (!targetId) return false;
        return (
          !condition.cardType ||
          this.hasCardType(targetId, condition.cardType)
        );
      }

      case "respondedToPicked": {
        const item = this.getRespondedToStackItem(context);
        if (!item) return false;
        return this.pickedCardOfType(item, condition.cardType) !== undefined;
      }

      case "deployedViaFlipUp": {
        return context.deployedViaFlipUp === true;
      }

      case "cardNameEquals": {
        const a = this.resolveTargetRef(condition.target, context);
        const b = this.resolveTargetRef(condition.other, context);
        return (
          !!a &&
          !!b &&
          this.getDefinition(a).name === this.getDefinition(b).name
        );
      }

      case "cardNameIs": {
        const a = this.resolveTargetRef(condition.target, context);
        return !!a && this.getDefinition(a).name === condition.name;
      }

      case "bottomedInMulligan": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        if (!cardId) return false;
        const ownerId = this.state.cards[cardId]?.ownerId;
        if (!ownerId) return false;
        return (this.state.mulligan[ownerId] ?? []).includes(cardId);
      }

      case "cardProvides": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId || !this.state.cards[cardId]) return false;
        const min = this.evaluateNumber(condition.min, context);
        const count = this.getResourceIcons(cardId).filter(
          icon => icon === condition.icon
        ).length;
        return count >= min;
      }

      case "isStaple": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId || !this.state.cards[cardId]) return false;
        return isStapleResourceDefinition(this.getDefinition(cardId));
      }

      case "cardDepleted": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return !!cardId && !!this.state.cards[cardId]?.depleted;
      }

      case "hasKeyword": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return (
          !!cardId &&
          this.state.cards[cardId]?.zone === "play" &&
          this.hasKeyword(cardId, condition.keyword)
        );
      }

      case "textMentionsIcon": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        if (!cardId) return false;
        const token = ICON_TEXT_TOKEN[condition.icon];
        return this.getDefinition(cardId).text.includes(token);
      }

      case "cardTypeEquals": {
        const a = this.resolveTargetRef(condition.target, context);
        const b = this.resolveTargetRef(condition.other, context);
        if (!a || !b) return false;
        // "a card of the same type as ..." — they share at least one type
        // (matters only if a `setCardType` grant has given one card an
        // extra type; normally each card has exactly one).
        const bTypes = new Set(this.getCardTypes(b));
        return this.getCardTypes(a).some(t => bTypes.has(t));
      }

      case "sharesBattlePartyWithSource": {
        const battle = this.state.battle;
        if (!battle) return false;
        const targetId = this.resolveTargetRef(condition.target, context);
        const sourceId = context.sourceId;
        if (!targetId) return false;
        const inAttack =
          battle.attackingParty.includes(targetId) &&
          battle.attackingParty.includes(sourceId);
        const inBlock =
          battle.blockingParty.includes(targetId) &&
          battle.blockingParty.includes(sourceId);
        return inAttack || inBlock;
      }

      case "linkedCardInPlay": {
        const linkedId =
          this.state.cards[context.sourceId]?.linkedTargets?.[condition.key];
        return !!linkedId && this.state.cards[linkedId]?.zone === "play";
      }

      case "sourceIsFaceDown": {
        return !!this.state.cards[context.sourceId]?.faceDown;
      }

      case "isExtremum": {
        const targetId = this.resolveTargetRef(condition.target, context);
        if (!targetId || !this.state.cards[targetId]) return false;

        const metricOf = (cardId: CardInstanceId): number =>
          condition.metric === "cost"
            ? this.getDefinition(cardId).cost ?? 0
            : this.getStat(cardId, condition.metric);

        const mine = metricOf(targetId);
        const pool = this.queryCards(condition.among, context);

        return !pool.some(other =>
          other.id !== targetId &&
          (condition.direction === "min"
            ? metricOf(other.id) < mine
            : metricOf(other.id) > mine)
        );
      }

      case "battleRole": {
        const battle = this.state.battle;
        if (!battle) {
          return false;
        }

        return condition.role === "attacker"
          ? battle.attackerPlayerId === context.controllerId
          : battle.defenderPlayerId === context.controllerId;
      }

      case "eventPlayerIs": {
        const event = context.event;

        if (!event || !("playerId" in event)) {
          return false;
        }

        return event.playerId === this.resolvePlayerRef(condition.player, context).id;
      }

      case "targetInSelection": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) {
          return false;
        }

        return (context.selected[condition.selection] ?? []).includes(cardId);
      }

      case "isActivePlayer":
        return (
          this.resolvePlayerRef(condition.player ?? "controller", context).id ===
          this.state.activePlayerId
        );

      case "battleActive":
        return !!this.state.battle && this.state.battle.phase !== "finished";

      case "cardSubtypeIs": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) {
          return false;
        }
        return this.getSubtypes(cardId).includes(condition.subtype);
      }

      case "inPlaySinceTurnStart": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        const card = cardId ? this.state.cards[cardId] : undefined;
        return (
          !!card &&
          card.zone === "play" &&
          card.attackEligibleTurn === this.state.turn
        );
      }

      case "uniqueIs": {
        const cardId = this.resolveTargetRef(condition.target, context);
        if (!cardId) {
          return false;
        }
        const designation = this.getDefinition(cardId).unique;
        return !!designation && condition.designations.includes(designation);
      }

      case "assignedDamageThisTurn": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return !!cardId && !!this.state.damageThisTurn[cardId]?.assigned;
      }

      case "inflictedDamageToFactionThisTurn": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        if (!cardId) return false;
        const owner = this.resolvePlayerRef(condition.player, context).id;
        return (
          this.state.damageThisTurn[cardId]?.toFactionOf.includes(owner) ?? false
        );
      }

      case "hasAttachment": {
        const cardId = this.resolveTargetRef(
          condition.target ?? { type: "selected", id: "__candidate" },
          context
        );
        if (!cardId) return false;
        return Object.values(this.state.cards).some(
          c =>
            c.attachedTo === cardId &&
            c.zone === "play" &&
            (!condition.ofType || this.hasCardType(c.id, condition.ofType)) &&
            (!condition.ofSubtype ||
              this.getSubtypes(c.id).includes(condition.ofSubtype))
        );
      }

      case "isCard": {
        const a = this.resolveTargetRef(
          condition.target ?? { type: "selected", id: "__candidate" },
          context
        );
        const b = this.resolveTargetRef(condition.other ?? "source", context);
        return !!a && a === b;
      }

      case "damagedThisTurn": {
        const targetId = this.resolveTargetRef(condition.target, context);
        if (!targetId) return false;
        if (condition.by === "any") {
          return Object.values(this.state.damageThisTurn).some(rec =>
            rec.toCards.includes(targetId)
          );
        }
        const byId = this.resolveTargetRef(condition.by ?? "source", context);
        if (!byId) return false;
        return (
          this.state.damageThisTurn[byId]?.toCards.includes(targetId) ?? false
        );
      }

      case "attackedThisTurn": {
        const cardId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return !!cardId && (this.state.attacksThisTurn[cardId] ?? 0) > 0;
      }

      case "destroyedByBattleDamage": {
        if (context.event?.type !== "cardDestroyed") return false;
        const targetId = this.resolveTargetRef(
          condition.target ?? "source",
          context
        );
        return (
          !!context.event.byBattleDamage &&
          (targetId === undefined || context.event.cardId === targetId)
        );
      }
    }
  }

  evaluateNumber(
    expression: NumberExpression,
    context: ResolutionContext
  ): number {
    if (typeof expression === "number") {
      return expression;
    }

    switch (expression.type) {
      case "stat": {
        const cardId = this.resolveTargetRef(
          expression.target,
          context
        );

        // An unresolved target (a not-yet-picked declaration read from an
        // ability's `variables`, a card that has since left play) has no
        // stat — read as 0, like `battlePartySize` / `extremumStat`.
        if (!cardId) return 0;

        return this.getStat(cardId, expression.stat);
      }

      case "counter": {
        const cardId = this.resolveTargetRef(
          expression.target,
          context
        );

        if (!cardId || !this.state.cards[cardId]) return 0;

        return (
          this.requireCard(cardId).counters[
            expression.counter
          ] ?? 0
        );
      }

      case "count":
        return this.queryCards(
          expression.selector,
          context
        ).length;

      case "add":
        return expression.values.reduce<number>(
          (sum, value) =>
            sum + this.evaluateNumber(value, context),
          0
        );

      case "multiply":
        return expression.values.reduce<number>(
          (product, value) =>
            product * this.evaluateNumber(value, context),
          1
        );

      case "variable":
        return context.variables?.[expression.id] ?? 0;

      case "random": {
        const min = this.evaluateNumber(expression.min, context);
        const max = this.evaluateNumber(expression.max, context);
        return min + Math.floor(this.random() * (max - min + 1));
      }

      case "cardCost": {
        const cardId = this.resolveTargetRef(expression.target, context);
        if (!cardId || !this.state.cards[cardId]) return 0;
        return this.getDefinition(cardId).cost ?? 0;
      }

      case "printedStat": {
        const cardId = this.resolveTargetRef(expression.target, context);
        if (!cardId || !this.state.cards[cardId]) return 0;
        return this.getDefinition(cardId)[expression.stat] ?? 0;
      }

      case "resourceIcons": {
        const player = this.resolvePlayerRef(expression.player, context);
        return this.getThresholds(player.id)[expression.icon] ?? 0;
      }

      case "divide": {
        const value = this.evaluateNumber(expression.value, context);
        const by = this.evaluateNumber(expression.by, context);

        if (by === 0) {
          return 0;
        }

        return expression.rounding === "up"
          ? Math.ceil(value / by)
          : Math.floor(value / by);
      }

      case "modulo": {
        const value = this.evaluateNumber(expression.value, context);
        const by = this.evaluateNumber(expression.by, context);

        if (by === 0) {
          return 0;
        }

        return ((value % by) + by) % by;
      }

      case "selectionCount": {
        return (context.selected[expression.id] ?? []).length;
      }

      case "sumStat": {
        return this.queryCards(expression.selector, context).reduce(
          (sum, card) => sum + this.getStat(card.id, expression.stat),
          0
        );
      }

      case "sumCounters": {
        return this.queryCards(expression.selector, context).reduce(
          (sum, card) => sum + (card.counters?.[expression.counter] ?? 0),
          0
        );
      }

      case "sumCost": {
        return this.queryCards(expression.selector, context).reduce(
          (sum, card) => sum + (this.getDefinition(card.id).cost ?? 0),
          0
        );
      }

      case "thresholdIconCount": {
        const cardId = this.resolveTargetRef(expression.target, context);
        if (!cardId) {
          return 0;
        }
        const threshold = this.getDefinition(cardId).threshold;
        if (typeof threshold === "number") {
          return threshold;
        }
        return (threshold ?? "").replace(/[^a-z]/gi, "").length;
      }

      case "eventDamageAmount": {
        return context.event?.type === "damageDealt"
          ? context.event.amount
          : 0;
      }

      case "eventDrawAmount": {
        return context.event?.type === "cardsDrawn"
          ? context.event.count
          : 0;
      }

      case "deploysThisTurn": {
        const wanted = expression.player
          ? [this.resolvePlayerRef(expression.player, context).id]
          : Object.keys(this.state.turnDeploys);
        let n = 0;
        for (const pid of wanted) {
          for (const d of this.state.turnDeploys[pid] ?? []) {
            if (expression.cardType && d.type !== expression.cardType) continue;
            if (expression.notCardType && d.type === expression.notCardType)
              continue;
            n++;
          }
        }
        return n;
      }

      case "conditional": {
        return this.evaluateCondition(expression.if, context)
          ? this.evaluateNumber(expression.then, context)
          : this.evaluateNumber(expression.else, context);
      }

      case "battlePartySize": {
        const battle = this.state.battle;
        if (!battle) return 0;

        if (expression.side === "attacking") return battle.attackingParty.length;
        if (expression.side === "blocking") return battle.blockingParty.length;

        const ofId = this.resolveTargetRef(expression.of ?? "source", context);
        if (!ofId) return 0;
        const inAttacking = battle.attackingParty.includes(ofId);
        const inBlocking = battle.blockingParty.includes(ofId);
        if (!inAttacking && !inBlocking) return 0;

        const own = inAttacking ? battle.attackingParty : battle.blockingParty;
        const opposing = inAttacking ? battle.blockingParty : battle.attackingParty;
        return expression.side === "ownParty" ? own.length : opposing.length;
      }

      case "extremumStat": {
        const cards = this.queryCards(expression.selector, context);
        if (cards.length === 0) return 0;
        const values = cards.map(card => this.getStat(card.id, expression.stat));
        return expression.direction === "max"
          ? Math.max(...values)
          : Math.min(...values);
      }

      case "distinctCount": {
        const seen = new Set<string>();
        for (const card of this.queryCards(expression.selector, context)) {
          const def = this.getDefinition(card.id);
          if (expression.by === "subtype") {
            for (const s of this.getSubtypes(card.id)) seen.add(s.toLowerCase());
          } else if (expression.by === "trade") {
            if (def.trade) seen.add(def.trade.toLowerCase());
          } else if (expression.by === "type") {
            seen.add(def.type);
          } else {
            seen.add(def.name.toLowerCase());
          }
        }
        return seen.size;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Targeting
  // ---------------------------------------------------------------------------

  private validateTargetDeclarations(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): void {
    for (const declaration of declarations) {
      const selected =
        context.selected[declaration.id] ?? [];

      const max = this.evaluateNumber(declaration.count, context);
      const min = declaration.optional ? 0 : max;

      assert(
        selected.length >= min && selected.length <= max,
        `Target '${declaration.id}' requires ` +
          (min === max ? `${max}` : `${min}-${max}`) +
          " selection(s)."
      );

      assert(
        new Set(selected).size === selected.length,
        `Target '${declaration.id}' selected the same card more than once.`
      );

      const legal = new Set(
        this.targetCandidates(
          declaration.selector,
          context
        ).map(card => card.id)
      );

      for (const selectedId of selected) {
        assert(
          legal.has(selectedId),
          `Illegal target '${selectedId}' for '${declaration.id}'.`
        );
      }

      this.assertDistinctNames(declaration, selected);
    }
  }

  /**
   * Emit a `cardPicked` event for every in-play card just chosen as a
   * target of a `chooserSelectsTarget` effect ("you may pick a character.
   * If you do, ..." — the common effect-driven pick). "When this card is
   * picked, put a token on it" (Ferrous Ferret). Not fired for a triggered
   * ability's own `targets` declarations (`selectTargets` /
   * `autoSelectTargets`) — those resolve inside trigger processing where a
   * re-entrant `emit` would double-resolve the trigger.
   */
  private emitCardPicked(
    selectedMap: Record<string, readonly CardInstanceId[]>,
    pickerId: PlayerId,
    onlyKeys?: string[]
  ): void {
    const keys = onlyKeys ?? Object.keys(selectedMap);
    for (const key of keys) {
      if (key === "__candidate") continue;
      for (const cardId of selectedMap[key] ?? []) {
        if (this.state.cards[cardId]?.zone === "play") {
          this.emit({ type: "cardPicked", cardId, playerId: pickerId });
        }
      }
    }
  }

  /**
   * Open (or re-open) a `spendCountersMenu` pending choice — snapshots the
   * current marker count on each pool card; if no option is affordable it
   * just resumes the suspended frames. (Voidal Poisoning.)
   */
  private openSpendCountersMenu(
    playerId: PlayerId,
    pool: CardSelector,
    counter: string,
    options: Array<{ cost: number; label?: string; effects: Effect[] }>,
    context: ResolutionContext
  ): void {
    const available: Record<CardInstanceId, number> = {};
    let total = 0;
    for (const card of this.queryCards(pool, context)) {
      const n = card.counters?.[counter] ?? 0;
      if (n > 0) {
        available[card.id] = n;
        total += n;
      }
    }
    const minCost = Math.min(...options.map(o => o.cost));
    if (total < minCost) {
      this.resumeEffectFrames();
      return;
    }
    this.state.pendingChoice = {
      kind: "spendCountersMenu",
      id: nextId("choice"),
      playerId,
      pool,
      counter,
      options,
      available,
      context
    };
  }

  /** "N cards with different names" — `TargetDeclaration.distinctNames`. */
  private assertDistinctNames(
    declaration: TargetDeclaration,
    selected: readonly CardInstanceId[]
  ): void {
    if (!declaration.distinctNames) return;
    const names = selected.map(id => this.getDefinition(id).name);
    assert(
      new Set(names).size === names.length,
      `Target '${declaration.id}' requires cards with different names.`
    );
  }

  private autoSelectTargets(
    declarations: TargetDeclaration[],
    context: ResolutionContext
  ): void {
    for (const declaration of declarations) {
      if (context.selected[declaration.id]) {
        continue;
      }

      const candidates = this.targetCandidates(
        declaration.selector,
        context
      );

      // findUnresolvedTargetDeclarations already routes any optional
      // declaration with a legal candidate to a pendingChoice — reaching
      // here means it has none, i.e. an automatic decline.
      if (declaration.optional && candidates.length === 0) {
        context.selected[declaration.id] = [];
        continue;
      }

      assert(
        candidates.length === this.evaluateNumber(declaration.count, context),
        `Triggered ability '${context.abilityId}' requires a choice for target '${declaration.id}'.`
      );

      context.selected[declaration.id] =
        candidates.map(card => card.id);
    }
  }

  private matchesSelector(
    card: CardInstance,
    selector: CardSelector,
    context: ResolutionContext
  ): boolean {
    if (selector.controller) {
      const self = context.controllerId;
      const opponent = this.getOpponent(self).id;

      if (
        selector.controller === "self" &&
        card.controllerId !== self
      ) {
        return false;
      }

      if (
        selector.controller === "opponent" &&
        card.controllerId !== opponent
      ) {
        return false;
      }
    }

    if (selector.owner) {
      const self = context.controllerId;
      const opponent = this.getOpponent(self).id;

      if (
        selector.owner === "self" &&
        card.ownerId !== self
      ) {
        return false;
      }

      if (
        selector.owner === "opponent" &&
        card.ownerId !== opponent
      ) {
        return false;
      }
    }

    // CR §402.3 / §402.3a: a selector that doesn't name a game area affects
    // only the In-Play area ("pick a character" = a character in play). An
    // explicit `zone: "any"` opts a selector out of that default (used by
    // the few contexts that legitimately span zones — deployForFree,
    // cost modifiers, a chooser targeting a prior search result).
    if (selector.zone !== "any") {
      const zones: Zone[] =
        selector.zone === undefined
          ? ["play"]
          : Array.isArray(selector.zone)
            ? selector.zone
            : [selector.zone];

      if (!zones.includes(card.zone)) {
        return false;
      }
    }

    const definition = this.getDefinition(card.id);

    if (selector.faceDown !== undefined && card.faceDown !== selector.faceDown) {
      return false;
    }

    if (selector.name !== undefined && definition.name !== selector.name) {
      return false;
    }

    if (selector.nameVar !== undefined) {
      const named =
        this.state.cards[context.sourceId]?.namedValues?.[selector.nameVar];
      if (!named || definition.name !== named) {
        return false;
      }
    }

    if (selector.uniqueDesignation !== undefined) {
      const want = Array.isArray(selector.uniqueDesignation)
        ? selector.uniqueDesignation
        : [selector.uniqueDesignation];
      if (!definition.unique || !want.includes(definition.unique)) {
        return false;
      }
    }

    if (selector.type) {
      if (selector.type === "resource") {
        // A resource *card* is a resource in any zone; a face-down card is
        // an anonymous resource only while it's in play. (`isResource` is
        // deliberately play-only for icon/threshold math — a selector that
        // names `deck`/`hand`/`discard` still needs to reach real resource
        // cards there, e.g. "search your deck for a staple resource".)
        const isRes =
          definition.type === "resource" ||
          (card.faceDown && card.zone === "play");
        if (!isRes) return false;
      } else if (selector.faceDown === true) {
        // "a face-down tactic/item/… you control" — match on the card's
        // real (hidden) type, since a face-down card is otherwise an
        // anonymous resource.
        if (definition.type !== selector.type) return false;
      } else if (card.faceDown || !this.hasCardType(card.id, selector.type)) {
        return false;
      }
    }

    if (selector.subtypeVar) {
      const named = this.state.cards[context.sourceId]?.namedValues?.[
        selector.subtypeVar
      ];
      if (!named || !this.getSubtypes(card.id).includes(named)) {
        return false;
      }
    } else if (
      selector.subtype &&
      !this.getSubtypes(card.id).includes(selector.subtype)
    ) {
      return false;
    }

    if (selector.tradeVar) {
      const keys = Array.isArray(selector.tradeVar)
        ? selector.tradeVar
        : [selector.tradeVar];
      const named = this.state.cards[context.sourceId]?.namedValues ?? {};
      const wanted = keys
        .map(k => named[k]?.toLowerCase())
        .filter((v): v is string => !!v);
      if (!wanted.includes(definition.trade.toLowerCase())) {
        return false;
      }
    }

    if (
      selector.depleted !== undefined &&
      card.depleted !== selector.depleted
    ) {
      return false;
    }

    if (selector.fromTop !== undefined) {
      const deck = this.state.players[card.ownerId]?.deck ?? [];
      const index = deck.indexOf(card.id);
      const depth =
        typeof selector.fromTop === "number"
          ? selector.fromTop
          : this.evaluateNumber(selector.fromTop, context);
      if (index < 0 || index >= depth) return false;
    }

    if (
      selector.staple !== undefined &&
      isStapleResourceDefinition(definition) !== selector.staple
    ) {
      return false;
    }

    if (selector.attachedToFaction !== undefined) {
      const host = card.attachedTo
        ? this.state.cards[card.attachedTo]
        : undefined;
      const attachedToFaction =
        !!host && this.getDefinition(host.id).type === "faction";
      if (attachedToFaction !== selector.attachedToFaction) {
        return false;
      }
    }

    if (
      selector.conditions &&
      !selector.conditions.every(condition =>
        this.evaluateCondition(condition, {
          ...context,
          selected: {
            ...context.selected,
            __candidate: [card.id]
          }
        })
      )
    ) {
      return false;
    }

    return true;
  }

  private resolveTargetRef(
    ref: TargetRef,
    context: ResolutionContext
  ): CardInstanceId | undefined {
    // A malformed/omitted TargetRef resolves to nothing rather than
    // crashing on a property read.
    if (ref === undefined || ref === null) {
      return undefined;
    }

    if (ref === "source") {
      return context.sourceId;
    }

    if (ref === "attachedTo") {
      return (
        this.state.cards[context.sourceId]?.attachedTo ??
        this.departedLinks.get(context.sourceId)?.attachedTo
      );
    }

    if (ref === "eventCard") {
      return this.getEventCardId(context.event);
    }

    if (ref.type === "card") {
      return ref.id;
    }

    if (ref.type === "random") {
      const candidates = this.queryCards(ref.selector, context);
      if (candidates.length === 0) {
        return undefined;
      }
      return candidates[Math.floor(this.random() * candidates.length)].id;
    }

    if (ref.type === "deckPosition") {
      const deck = this.resolvePlayerRef(ref.player, context).deck;
      const index = ref.index ?? 0;
      return ref.from === "top"
        ? deck[index]
        : deck[deck.length - 1 - index];
    }

    if (ref.type === "respondedToCard") {
      return this.getRespondedToCardId(context);
    }

    if (ref.type === "respondedToPicked") {
      const item = this.getRespondedToStackItem(context);
      return item ? this.pickedCardOfType(item, ref.cardType) : undefined;
    }

    if (ref.type === "factionOf") {
      return this.resolvePlayerRef(ref.player, context).factionId;
    }

    if (ref.type === "remembered") {
      return (
        this.state.cards[context.sourceId]?.linkedTargets?.[ref.key] ??
        this.departedLinks.get(context.sourceId)?.linkedTargets?.[ref.key]
      );
    }

    if (ref.type === "damageSource") {
      return context.event?.type === "damageDealt"
        ? context.event.sourceId
        : undefined;
    }

    if (ref.type === "lastDeployedTactic") {
      return this.state.lastDeployedTacticId;
    }

    if (ref.type === "attachmentHost") {
      const cardId = this.resolveTargetRef(ref.target, context);
      return cardId ? this.state.cards[cardId]?.attachedTo : undefined;
    }

    if (ref.type === "respondedAbilitySource") {
      for (let i = this.responseStack.length - 1; i >= 0; i--) {
        const item = this.responseStack[i];
        if (item.kind === "ability" && item.sourceId !== context.sourceId) {
          return item.sourceId;
        }
      }
      // "Terminate the ability. Destroy the character." — the ability was
      // just pulled off the stack; fall back to what `terminate` stashed.
      return this.lastTerminatedAbility?.sourceId;
    }

    return context.selected[ref.id]?.[0];
  }

  /**
   * The card currently being responded to — the newest `kind: "card"` item
   * on the response stack that isn't the current ability's own source.
   * `undefined` outside a response window / with nothing else on the stack.
   */
  private getRespondedToCardId(
    context: ResolutionContext
  ): CardInstanceId | undefined {
    for (let i = this.responseStack.length - 1; i >= 0; i--) {
      const item = this.responseStack[i];
      if (item.kind === "card" && item.sourceId !== context.sourceId) {
        return item.sourceId;
      }
    }
    return undefined;
  }

  /**
   * The newest unresolved stack item that isn't the current ability's own
   * source — card OR ability. `getRespondedToCardId` is the `kind: "card"`
   * -only version; this one is for effects/conditions that must reach a
   * responded-to *ability* too (Mistaken Identity, Cock Block).
   */
  private getRespondedToStackItem(
    context: ResolutionContext
  ): StackItem | undefined {
    for (let i = this.responseStack.length - 1; i >= 0; i--) {
      const item = this.responseStack[i];
      if (item.sourceId !== context.sourceId) return item;
    }
    return undefined;
  }

  /** The other player in an in-flight MUSTACHE SHOWDOWN. */
  private partitionOpponent(
    pp: NonNullable<GameState["pendingPartition"]>,
    playerId: PlayerId
  ): PlayerId {
    return pp.order[0] === playerId ? pp.order[1] : pp.order[0];
  }

  /**
   * MUSTACHE SHOWDOWN resolution once both players have partitioned and
   * picked: compare the two chosen piles' total cost; if one is strictly
   * higher, pause for its owner to take up to `winnerTakes` of its cards
   * (`takeFromPile`); otherwise shuffle both decks and resume.
   */
  private settleMustacheShowdown(
    pp: NonNullable<GameState["pendingPartition"]>
  ): void {
    // Each player's chosen pile is the pile of THEIR cards that their
    // opponent selected.
    const chosenPile = (owner: PlayerId): CardInstanceId[] => {
      const picker = this.partitionOpponent(pp, owner);
      return pp.partitions[owner][pp.picks[picker]] ?? [];
    };
    const totalCost = (ids: CardInstanceId[]): number =>
      ids.reduce((sum, id) => sum + (this.getDefinition(id).cost ?? 0), 0);

    const [a, b] = pp.order;
    const costA = totalCost(chosenPile(a));
    const costB = totalCost(chosenPile(b));

    if (costA !== costB) {
      const winner = costA > costB ? a : b;
      const winningPile = chosenPile(winner);
      this.state.pendingChoice = {
        kind: "takeFromPile",
        id: nextId("choice"),
        playerId: winner,
        candidates: [...winningPile],
        max: Math.min(pp.winnerTakes, winningPile.length)
      };
      return;
    }

    // "If one pile has a higher total ..." — a tie means nobody takes.
    this.state.pendingChoice = undefined;
    this.state.pendingPartition = undefined;
    for (const p of pp.order) {
      this.shuffleInPlace(this.requirePlayer(p).deck);
    }
    this.resumeEffectFrames();
  }

  /**
   * The first id under `item.context.selected` that resolves to an in-play
   * card of `cardType` — "the <cardType> it picked as an extra cost". Used
   * by `respondedToPicked` / `retargetExtraCost` (Mistaken Identity).
   */
  private pickedCardOfType(
    item: StackItem,
    cardType: CardType
  ): CardInstanceId | undefined {
    for (const ids of Object.values(item.context.selected ?? {})) {
      for (const id of ids) {
        const card = this.state.cards[id];
        if (card && card.zone === "play" && this.hasCardType(id, cardType)) {
          return id;
        }
      }
    }
    return undefined;
  }

  resolvePlayerRef(
    ref: PlayerRef,
    context: ResolutionContext
  ): PlayerState {
    if (ref === "controller") {
      return this.requirePlayer(context.controllerId);
    }

    if (ref === "owner") {
      return this.requirePlayer(
        this.requireCard(context.sourceId).ownerId
      );
    }

    if (ref === "activePlayer") {
      return this.requirePlayer(
        this.state.activePlayerId
      );
    }

    if (ref === "opponent") {
      return this.getOpponent(context.controllerId);
    }

    if (ref.type === "ownerOf") {
      const cardId = this.resolveTargetRef(ref.target, context);
      assert(cardId, "Unable to resolve ownerOf target.");
      return this.requirePlayer(this.requireCard(cardId).ownerId);
    }

    if (ref.type === "controllerOf") {
      const cardId = this.resolveTargetRef(ref.target, context);
      assert(cardId, "Unable to resolve controllerOf target.");
      return this.requirePlayer(this.requireCard(cardId).controllerId);
    }

    return this.requirePlayer(ref.id);
  }

  // ---------------------------------------------------------------------------
  // Costs
  // ---------------------------------------------------------------------------

  private canPayCosts(
    costs: Cost[],
    context: ResolutionContext
  ): boolean {
    // Simulate the costs against a cheap clone so multi-cost abilities
    // are checked transactionally. Pass randomOverride (not `this.random`,
    // which is bound to *this* engine's state) so a dry-run probe draws
    // from the clone's own rngState and can never advance the real game's.
    // Drop `gameLog` before the deep clone — the probe never appends to it
    // and it grows unbounded over a game.
    const clone = structuredClone({ ...this.state, gameLog: [] });

    try {
      const engine = new SpoilsEngine(
        Object.values(this.definitions),
        clone,
        this.randomOverride
      );

      for (const cost of costs) {
        engine.payCost(cost, context, false);
      }

      return true;
    } catch {
      return false;
    }
  }

  private payCosts(
    costs: Cost[],
    context: ResolutionContext
  ): void {
    for (const cost of costs) {
      this.payCost(cost, context, true);
    }
  }

  private payCost(
    cost: Cost,
    context: ResolutionContext,
    emitEvents: boolean
  ): void {
    // CR §506.2: replacements never apply to something happening as part of
    // an extra cost — a card destroyed / discarded / removed as a cost is
    // really gone, its own "if this would be destroyed …" replacement
    // notwithstanding. (A replacement on a card *attached* to it still
    // applies — CR §506.2a — but that's handled when the attachment's own
    // leave-play is processed, not here.)
    switch (cost.type) {
      case "oneOf": {
        // "Pay 1 or destroy a Micromajig token you control." Auto-selects
        // the first branch that is fully payable (a player-choice variant
        // is future work — no current card meaningfully needs the choice).
        for (const branch of cost.options) {
          let payable = true;
          try {
            const clone = structuredClone({ ...this.state, gameLog: [] });
            const probe = new SpoilsEngine(
              Object.values(this.definitions),
              clone,
              this.randomOverride
            );
            for (const c of branch) probe.payCost(c, context, false);
          } catch {
            payable = false;
          }
          if (payable) {
            for (const c of branch) this.payCost(c, context, emitEvents);
            return;
          }
        }
        throw new Error("None of the alternative cost branches can be paid.");
      }

      case "payResources": {
        const amount = this.evaluateNumber(
          cost.amount,
          context
        );

        assert(amount >= 0, "Resource payment cannot be negative.");
        assert(
          this.getAvailableResourceCount(context.controllerId) >= amount,
          "Not enough unattached resources."
        );

        this.payNumericCost(context.controllerId, amount);
        return;
      }

      case "loseInfluence": {
        const player = this.resolvePlayerRef(cost.player ?? "controller", context);
        const amount = this.evaluateNumber(cost.amount, context);
        assert(amount >= 0, "Influence payment cannot be negative.");
        player.influence -= amount;
        return;
      }

      case "shuffleDeck": {
        const player = this.resolvePlayerRef(cost.player ?? "controller", context);
        this.shuffleInPlace(player.deck);
        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(
          cost.target,
          context
        );

        assert(targetId, "Missing depletion target.");

        const card = this.requireCard(targetId);

        assert(!card.depleted, "Card is already depleted.");

        card.depleted = true;

        if (emitEvents) {
          this.emit({
            type: "cardDepleted",
            cardId: card.id
          });
        }

        return;
      }

      case "discard": {
        const player = this.resolvePlayerRef(
          cost.player,
          context
        );

        const legal = new Set(
          this.queryCards(
            {
              ...cost.selector,
              controller:
                cost.selector.controller ?? "self",
              zone: cost.selector.zone ?? "hand"
            },
            context
          )
            .filter(card => card.controllerId === player.id)
            .map(card => card.id)
        );

        const selected = context.selected[cost.id] ?? [];

        assert(
          selected.length === cost.count,
          `Discard cost '${cost.id}' requires selecting exactly ${cost.count} card(s).`
        );
        assert(
          new Set(selected).size === selected.length,
          `Discard cost '${cost.id}' selected the same card more than once.`
        );

        for (const cardId of selected) {
          assert(
            legal.has(cardId),
            `Illegal discard-cost selection '${cardId}' for '${cost.id}'.`
          );
        }

        for (const cardId of selected) {
          this.moveCard(cardId, "discard", emitEvents, "bottom", true);
        }

        return;
      }

      case "moveSelected": {
        const player = this.resolvePlayerRef(cost.player, context);

        const legal = new Set(
          this.queryCards(
            {
              ...cost.selector,
              controller: cost.selector.controller ?? "self",
              zone: cost.selector.zone ?? "play"
            },
            context
          )
            .filter(card => card.controllerId === player.id)
            .map(card => card.id)
        );

        const selected = context.selected[cost.id] ?? [];
        assert(
          selected.length === cost.count,
          `Move-selected cost '${cost.id}' requires selecting exactly ${cost.count} card(s).`
        );
        assert(
          new Set(selected).size === selected.length,
          `Move-selected cost '${cost.id}' selected the same card more than once.`
        );
        for (const cardId of selected) {
          assert(
            legal.has(cardId),
            `Illegal move-selected-cost selection '${cardId}' for '${cost.id}'.`
          );
        }

        for (const cardId of selected) {
          this.moveCard(cardId, cost.to, emitEvents, cost.position ?? "bottom", true);
        }
        if (cost.shuffle && cost.to === "deck") {
          this.shuffleInPlace(this.requirePlayer(player.id).deck);
        }

        return;
      }

      case "destroy": {
        const targetId = this.resolveTargetRef(
          cost.target,
          context
        );

        assert(targetId, "Missing destroy-cost target.");

        this.destroyCard(targetId, emitEvents, true);
        return;
      }

      case "removeFromGame": {
        const targetId = this.resolveTargetRef(cost.target, context);
        assert(targetId, "Missing removeFromGame-cost target.");
        assert(
          this.state.cards[targetId],
          "removeFromGame-cost target is not a real card."
        );
        this.moveCard(targetId, "removed", emitEvents, "bottom", true);
        return;
      }

      case "dealDamage": {
        const targetId = this.resolveTargetRef(cost.target, context);
        assert(targetId, "Missing dealDamage-cost target.");
        const card = this.requireCard(targetId);
        const base = this.evaluateNumber(cost.amount, context);
        const amount = Math.max(
          0,
          base + this.damageDeltaFor(targetId, false, context.sourceId, base)
        );
        // CR §408.3 — a faction loses influence instead of taking markers.
        if (this.getDefinition(targetId).type === "faction") {
          this.applyInfluenceDelta(card.ownerId, -amount);
        } else {
          card.damage += amount;
        }
        if (emitEvents && amount > 0) {
          this.emit({
            type: "damageDealt",
            sourceId: context.sourceId,
            targetId,
            amount
          });
        }
        return;
      }

      case "sacrificeSelected": {
        const targetIds = context.selected[cost.declarationId] ?? [];
        const zone =
          cost.disposition === "removeFromGame"
            ? "removed"
            : "discard";

        for (const targetId of targetIds) {
          const card = this.state.cards[targetId];
          assert(card, "sacrificeSelected target is not a real card.");
          if (cost.disposition === "destroy" && card.zone === "play") {
            this.destroyCard(targetId, emitEvents, true);
          } else {
            this.moveCard(targetId, zone, emitEvents, "bottom", true);
          }
        }
        return;
      }

      case "removeCounter": {
        const targetId = this.resolveTargetRef(
          cost.target,
          context
        );

        assert(targetId, "Missing removeCounter-cost target.");

        const card = this.requireCard(targetId);
        const amount = this.evaluateNumber(cost.amount, context);
        const current = card.counters[cost.counter] ?? 0;

        assert(current >= amount, `Not enough '${cost.counter}' counters to remove.`);

        card.counters[cost.counter] = current - amount;
        if (emitEvents && amount > 0) {
          this.emit({ type: "counterChanged", cardId: targetId, counter: cost.counter });
        }
        return;
      }

      case "depleteSelected": {
        const targetIds = context.selected[cost.declarationId] ?? [];
        const cards = targetIds.map(targetId => this.requireCard(targetId));

        for (const card of cards) {
          assert(!card.depleted, "Card is already depleted.");
        }

        for (const card of cards) {
          card.depleted = true;

          if (emitEvents) {
            this.emit({
              type: "cardDepleted",
              cardId: card.id
            });
          }
        }

        return;
      }
    }
  }

  /**
   * Move an in-play card's control to `newControllerId`, keeping the
   * per-player `play` arrays (which `getAvailableResourceIds` / `getThresholds`
   * / attack-eligibility loops iterate) in sync. No-op if control is
   * unchanged or the card isn't in play.
   */
  /**
   * Fold every in-play `ContinuousAbility.abilityCostModifiers` that targets
   * this ability into its `payResources` costs (floored at each modifier's
   * `minCost`). First Unified Market of Abstract Secure Theoreticals.
   */
  private applyAbilityCostModifiers(
    sourceCardId: CardInstanceId,
    costs: Cost[],
    playerId: PlayerId,
    context: ResolutionContext
  ): Cost[] {
    let delta = 0;
    let minCost = 0;

    const isFactionAbility = this.getDefinition(sourceCardId).type === "faction";
    const isControlledCharacter =
      this.hasCardType(sourceCardId, "character") &&
      this.state.cards[sourceCardId]?.controllerId === playerId;

    for (const src of Object.values(this.state.cards)) {
      if (src.zone !== "play" || src.faceDown) continue;
      for (const ability of this.getDefinition(src.id).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.abilityCostModifiers) continue;
        if (this.abilitySuppressed(src.id, ability.id)) continue;
        const ctx: ResolutionContext = {
          sourceId: src.id,
          controllerId: src.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        for (const m of ability.abilityCostModifiers) {
          const applies =
            (m.scope === "factionAbilities" &&
              isFactionAbility &&
              src.controllerId === playerId) ||
            (m.scope === "self" && src.id === sourceCardId) ||
            (m.scope === "controlledCharacters" &&
              isControlledCharacter &&
              src.controllerId === playerId) ||
            (m.scope === "opponentCharacters" &&
              this.hasCardType(sourceCardId, "character") &&
              playerId === this.getOpponent(src.controllerId).id);
          if (!applies) continue;
          delta += this.evaluateNumber(m.delta, ctx);
          if (m.minCost !== undefined) minCost = Math.max(minCost, m.minCost);
        }
      }
    }

    if (delta === 0) return costs;

    return costs.map(cost => {
      if (cost.type !== "payResources") return cost;
      const value = this.evaluateNumber(cost.amount, context);
      return { ...cost, amount: Math.max(minCost, value + delta) };
    });
  }

  private reassignControl(
    cardId: CardInstanceId,
    newControllerId: PlayerId
  ): void {
    const card = this.state.cards[cardId];
    if (!card || card.controllerId === newControllerId) return;

    if (card.zone === "play") {
      const oldController = this.requirePlayer(card.controllerId);
      oldController.play = oldController.play.filter(id => id !== cardId);
      this.requirePlayer(newControllerId).play.push(cardId);
    }

    card.controllerId = newControllerId;
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  resolveEffect(
    effect: Effect,
    context: ResolutionContext
  ): void {
    // Whatever effect is resolving, its controller is the "cause" of any
    // destroy / move / damage it goes on to perform (and of the state-based
    // check that immediately follows in `runEffectFrame`). Read by
    // `applyReplacement` for `replaces.by` ("by an opposing card or effect").
    this.currentCause = context.controllerId;

    // "Any effects from <cardType> do not affect this card." (Parkour
    // Hoodlum) — a single-target mutation whose origin is a card of an
    // ignored type is a no-op against that card. Targeted picks are already
    // filtered by `targetCandidates`; this covers the non-pick vectors
    // (`"eventCard"`, `"attachedTo"`, a remembered ref). A `{random}` target
    // is skipped — resolving it here would consume the RNG twice.
    if (SOURCE_CLASS_GUARDED_EFFECTS.has(effect.type) && "target" in effect) {
      // Every effect in SOURCE_CLASS_GUARDED_EFFECTS carries a `target:
      // TargetRef` — the cast is safe (the union widens once effects with a
      // non-TargetRef `target`, e.g. `initiateAttack`, joined the type).
      const rawTarget = (effect as { target?: TargetRef }).target;
      if (
        rawTarget !== undefined &&
        !(typeof rawTarget === "object" && rawTarget.type === "random")
      ) {
        const guardedId = this.resolveTargetRef(rawTarget, context);
        if (
          guardedId &&
          this.sourceClassIgnoredByTarget(guardedId, context.sourceId)
        ) {
          return;
        }
      }
    }

    switch (effect.type) {
      case "draw": {
        const player = this.resolvePlayerRef(
          effect.player,
          context
        );

        const amount = this.evaluateNumber(
          effect.amount,
          context
        );

        this.drawCards(player.id, amount);
        return;
      }

      case "playResource": {
        const targetId = this.resolveTargetRef(effect.target, context);
        // RULES.md §12: an effect whose target can't be resolved (e.g. a
        // `{type:"random"}` selector matching nothing) is carried out as far
        // as possible — here, not at all — rather than aborting resolution.
        // The zone check (mirroring `destroy`) additionally covers a target
        // that resolved fine at activation time but left hand before this
        // effect actually reached the front of the response stack (RULES.md
        // §7's LIFO resolution can leave a lot of daylight between the two).
        if (!targetId || this.state.cards[targetId]?.zone !== "hand") return;

        const definition = this.getDefinition(targetId);
        const faceDown = effect.faceDown === "auto"
          ? definition.type !== "resource"
          : effect.faceDown;

        const resourcePlayer = effect.player
          ? this.resolvePlayerRef(effect.player, context).id
          : context.controllerId;
        this.playResourceCard(resourcePlayer, targetId, faceDown);
        return;
      }

      case "dealDamage": {
        const rawTargetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!rawTargetId) return;

        // "If the picked character would be dealt damage, deal damage to
        // this card instead." (6r4wny 60dy9u4rd5).
        const targetId = this.redirectTargetFor(rawTargetId) ?? rawTargetId;

        const target = this.requireCard(targetId);
        const base = this.evaluateNumber(effect.amount, context);
        const raw = Math.max(
          0,
          base + this.damageDeltaFor(targetId, false, context.sourceId, base)
        );

        const { toTarget: amount, redirects } = this.absorbDamage(targetId, raw);

        // CR §408.3: damage inflicted on a faction makes it lose an equal
        // amount of influence (after the same damage-modification pass —
        // only a direct "loses N influence" effect bypasses that). A
        // faction carries no damage markers.
        if (this.getDefinition(targetId).type === "faction") {
          if (amount > 0) {
            this.applyInfluenceDelta(target.ownerId, -amount);
            this.emit({
              type: "damageDealt",
              sourceId: context.sourceId,
              targetId,
              amount
            });
          }
        } else {
          target.damage += amount;

          if (amount > 0) {
            this.emit({
              type: "damageDealt",
              sourceId: context.sourceId,
              targetId,
              amount
            });
          }
        }

        for (const r of redirects) {
          const rc = this.state.cards[r.cardId];
          if (!rc || rc.zone !== "play") continue;
          rc.damage += r.amount;
          this.emit({
            type: "damageDealt",
            sourceId: context.sourceId,
            targetId: r.cardId,
            amount: r.amount
          });
        }

        return;
      }

      case "modifyInfluence": {
        const player = this.resolvePlayerRef(effect.player, context);
        this.applyInfluenceDelta(
          player.id,
          this.evaluateNumber(effect.amount, context)
        );
        return;
      }

      case "mill": {
        const player = this.resolvePlayerRef(effect.player, context);
        const count = this.evaluateNumber(effect.count, context);
        const top = player.deck.slice(0, Math.max(0, count));
        const to = effect.to ?? "discard";

        this.beginEventBatch();
        try {
          for (const cardId of top) {
            this.moveCard(cardId, to);
          }
        } finally {
          this.endEventBatch();
        }
        return;
      }

      case "reveal": {
        const owner = this.resolvePlayerRef(effect.of, context);
        const n =
          effect.zone === "hand"
            ? owner.hand.length
            : Math.max(0, this.evaluateNumber(effect.count ?? 1, context));
        const cardIds =
          effect.zone === "hand" ? [...owner.hand] : owner.deck.slice(0, n);
        if (cardIds.length === 0) return;
        this.emit({
          type: "cardsRevealed",
          cardIds,
          zone: effect.zone === "hand" ? "hand" : "deck",
          ownerId: owner.id,
          viewerId:
            effect.viewer === "all"
              ? "all"
              : effect.viewer
                ? this.resolvePlayerRef(effect.viewer, context).id
                : this.resolvePlayerRef("controller", context).id,
          byCardId: context.sourceId
        });
        return;
      }

      case "revealFromTopUntil": {
        const player = this.resolvePlayerRef(effect.player, context);
        const others: CardInstanceId[] = [];
        const revealed: CardInstanceId[] = [];
        let matchId: CardInstanceId | undefined;
        while (player.deck.length > 0) {
          const cardId = player.deck[0];
          revealed.push(cardId);
          const matched = this.evaluateCondition(effect.match, {
            ...context,
            selected: { ...context.selected, __candidate: [cardId] }
          });
          if (matched) {
            matchId = cardId;
            break;
          }
          others.push(player.deck.shift()!);
        }

        if (revealed.length > 0) {
          this.emit({
            type: "cardsRevealed",
            cardIds: revealed,
            zone: "deck",
            ownerId: player.id,
            viewerId: "all",
            byCardId: context.sourceId
          });
        }

        this.beginEventBatch();
        try {
          if (matchId) {
            const matchCtx: ResolutionContext = {
              ...context,
              selected: { ...context.selected, [effect.bindAs]: [matchId] }
            };
            for (const sub of effect.onMatch) this.resolveEffect(sub, matchCtx);
          } else {
            for (const sub of effect.onEmpty ?? []) this.resolveEffect(sub, context);
          }

          const rest = effect.rest ?? "shuffle";
          if (rest === "shuffle") {
            for (const id of others) player.deck.push(id);
            if (others.length > 0) this.shuffleInPlace(player.deck);
          } else {
            for (const id of others) {
              this.moveCard(id, rest === "bottom" ? "deck" : rest, true, "bottom");
            }
          }
        } finally {
          this.endEventBatch();
        }
        return;
      }

      case "rememberTarget": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const source = this.state.cards[context.sourceId];
        if (source && targetId) {
          (source.linkedTargets ??= {})[effect.key] = targetId;
        }
        return;
      }

      case "duplicate": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        const stackItem = this.responseStack.find(
          item => item.sourceId === targetId && item.kind === "card"
        );
        const definition = this.getDefinition(targetId);
        const dupEffects =
          definition.type === "tactic" ? this.getTacticEffects(definition) : [];
        if (dupEffects.length === 0) return;

        // The copy resolves the same effects with the same choices, under
        // the duplicator's control (RULES.md §12 — a copy uses the
        // original's already-made selections).
        const dupContext: ResolutionContext = {
          sourceId: targetId,
          controllerId: context.controllerId,
          abilityId: stackItem?.context.abilityId,
          selected: { ...(stackItem?.context.selected ?? {}) },
          variables: { ...(stackItem?.context.variables ?? {}) },
          deployedViaFlipUp: stackItem?.context.deployedViaFlipUp
        };
        this.runEffectFrame({ effects: dupEffects, index: 0, context: dupContext });
        return;
      }


      case "partitionAndPick": {
        const a = context.controllerId;
        const b = this.getOpponent(a).id;
        const revealed: Record<PlayerId, CardInstanceId[]> = {
          [a]: this.requirePlayer(a).deck.slice(0, effect.count),
          [b]: this.requirePlayer(b).deck.slice(0, effect.count)
        };

        // "divide them into N piles containing at least 1 card each" is
        // impossible for a player with fewer than N revealed cards — the
        // whole showdown fizzles rather than half-resolving.
        if (revealed[a].length < effect.piles || revealed[b].length < effect.piles) {
          return;
        }

        this.state.pendingPartition = {
          sourceId: context.sourceId,
          controllerId: a,
          compareBy: effect.compareBy,
          winnerTakes: effect.winnerTakes,
          order: [a, b],
          revealed,
          partitions: {},
          picks: {},
          phase: "partition"
        };

        this.state.pendingChoice = {
          kind: "partitionCards",
          id: nextId("choice"),
          playerId: a,
          cardIds: [...revealed[a]],
          piles: effect.piles
        };
        return;
      }

      case "retargetExtraCost": {
        const item = this.getRespondedToStackItem(context);
        if (!item) return;
        const fromId = this.pickedCardOfType(item, effect.cardType);
        const toId = this.resolveTargetRef(effect.to, context);
        if (!fromId || !toId || fromId === toId) return;

        for (const [key, ids] of Object.entries(item.context.selected ?? {})) {
          item.context.selected[key] = ids.map(id => (id === fromId ? toId : id));
        }
        return;
      }

      case "setCardType": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;

        this.state.cardTypeGrants.push({
          id: nextId("cardTypeGrant"),
          sourceId: context.sourceId,
          targetId,
          cardType: effect.cardType,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        for (const [stat, expr] of Object.entries(effect.grantStats ?? {})) {
          this.state.modifiers.push({
            id: nextId("modifier"),
            sourceId: context.sourceId,
            sourceAbilityId: context.abilityId,
            targetId,
            stat: stat as Stat,
            operation: "set",
            value: this.evaluateNumber(expr as NumberExpression, context),
            duration: effect.duration,
            createdTurn: this.state.turn
          });
        }

        this.checkStateBasedActions();
        return;
      }

      case "removeCardType": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        const dropped = this.state.cardTypeGrants.filter(
          g => g.targetId === targetId && g.cardType === effect.cardType
        );
        if (dropped.length === 0) return;

        this.state.cardTypeGrants = this.state.cardTypeGrants.filter(
          g => !dropped.includes(g)
        );
        // Drop the `set` stat modifiers that `setCardType.grantStats` pushed
        // alongside each removed grant (same source + target).
        const sources = new Set(dropped.map(g => g.sourceId));
        this.state.modifiers = this.state.modifiers.filter(
          m =>
            !(
              m.targetId === targetId &&
              m.operation === "set" &&
              sources.has(m.sourceId)
            )
        );

        this.checkStateBasedActions();
        return;
      }

      case "bind": {
        if (!context.variables) context.variables = {};
        context.variables[effect.id] = this.evaluateNumber(effect.value, context);
        return;
      }

      case "setRestoreLock": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        const card = this.state.cards[targetId];
        if (card) card.restoreLocked = effect.value ?? true;
        return;
      }

      case "skipRestoreRule": {
        const player = this.resolvePlayerRef(effect.player, context);
        this.state.restoreRuleSkips[player.id] =
          (this.state.restoreRuleSkips[player.id] ?? 0) + (effect.turns ?? 1);
        return;
      }

      case "skipNextRestore": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const card = targetId ? this.state.cards[targetId] : undefined;
        if (card) card.skipNextRestore = true;
        return;
      }

      case "modifyNumericCost": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        this.state.numericCostModifiers.push({
          id: nextId("numericCostMod"),
          targetId,
          delta: this.evaluateNumber(effect.delta, context),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "chooserSelectsNumber": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        this.state.pendingChoice = {
          kind: "chooseNumber",
          id: nextId("choice"),
          playerId: chooser.id,
          storeAs: effect.storeAs,
          min: effect.min ? this.evaluateNumber(effect.min, context) : 0,
          max: effect.max ? this.evaluateNumber(effect.max, context) : 99,
          effects: effect.effects,
          context
        };
        return;
      }

      case "terminate": {
        const doomed = new Set<string>();

        if (effect.scope === "othersOnStack") {
          for (const item of this.responseStack) {
            if (item.sourceId !== context.sourceId) doomed.add(item.id);
          }
        } else if (effect.scope === "respondedItem") {
          // "Terminate the ability" / "terminate the card" — the newest
          // unresolved non-self stack item, whatever its kind.
          for (let i = this.responseStack.length - 1; i >= 0; i--) {
            const item = this.responseStack[i];
            if (item.sourceId !== context.sourceId) {
              doomed.add(item.id);
              break;
            }
          }
        } else {
          const targetId = effect.target
            ? this.resolveTargetRef(effect.target, context)
            : undefined;
          if (!targetId) return;
          for (const item of this.responseStack) {
            if (item.sourceId === targetId) doomed.add(item.id);
          }
        }

        if (doomed.size === 0) return;

        const removed = this.responseStack.filter(item => doomed.has(item.id));
        this.state.responseStack = this.responseStack.filter(
          item => !doomed.has(item.id)
        );

        for (const item of removed) {
          if (item.kind === "ability" && item.abilityId) {
            this.lastTerminatedAbility = {
              sourceId: item.sourceId,
              abilityId: item.abilityId
            };
          }
          if (item.kind !== "card") continue;
          const card = this.state.cards[item.sourceId];
          if (card && (card.zone === "deploying" || card.zone === "play")) {
            // "Terminate the card, but put it into its owner's hand instead
            // of their discard pile." (Voidal Interference).
            this.moveCard(
              item.sourceId,
              effect.disposition === "hand" ? "hand" : "discard"
            );
          }
        }
        return;
      }

      case "moveCard": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        this.moveCard(targetId, effect.to, true, effect.position);
        return;
      }

      case "flipFaceDown": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (targetId) this.flipCardFaceDown(targetId);
        return;
      }

      case "putIntoPlay": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        const controller = this.resolvePlayerRef(effect.controller, context);
        this.putCardIntoPlay(
          targetId,
          controller.id,
          effect.faceDown ?? false,
          context,
          effect.borrowed ?? false
        );
        return;
      }

      case "deployFromZone": {
        const player = this.resolvePlayerRef(effect.player, context);
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;

        const freeSpec = effect.free ?? true;
        const isFree =
          typeof freeSpec === "boolean"
            ? freeSpec
            : this.evaluateCondition(freeSpec, {
                ...context,
                selected: { ...context.selected, __candidate: [targetId] }
              });

        this.state.pendingChoice = {
          kind: "deployForFree",
          id: nextId("choice"),
          playerId: player.id,
          candidates: [targetId],
          context,
          fromZone: true,
          ignoreThreshold: effect.ignoreThreshold ?? false,
          payCost: !isFree
        };
        return;
      }

      case "destroy": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        // "This turn, cards ... can only be destroyed by costs." (Limited
        // Liability) — the `destroy` EFFECT is inert; the `destroy` COST,
        // lethal-damage SBA and `removeFromGame` still work.
        if (this.state.destructionRestrictionWindows.length > 0) {
          return;
        }

        // RULES.md §12: destroying a card no longer in play is carried out
        // "as far as possible" — i.e. it's simply already done. An earlier
        // effect in the same ability (or a batched trigger) may well have
        // already destroyed this exact target.
        if (this.state.cards[targetId]?.zone === "play") {
          this.destroyCard(targetId);
        }

        return;
      }

      case "deplete": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);

        if (!card.depleted) {
          card.depleted = true;

          this.emit({
            type: "cardDepleted",
            cardId: targetId
          });
        }

        return;
      }

      case "preventDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;

        const redirectToId =
          effect.mode === "redirect" && effect.redirectTo
            ? this.resolveTargetRef(effect.redirectTo, context)
            : undefined;

        this.state.damageShields.push({
          id: nextId("shield"),
          targetId,
          amount: effect.wholeInstance
            ? 1
            : Math.max(0, this.evaluateNumber(effect.amount, context)),
          mode: effect.mode,
          redirectToId,
          wholeInstance: effect.wholeInstance,
          createdTurn: this.state.turn
        });
        return;
      }

      case "restore": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);

        if (
          card.depleted &&
          !this.hasRestriction(targetId, "cannotBeRestored")
        ) {
          card.depleted = false;

          this.emit({
            type: "cardRestored",
            cardId: targetId
          });
        }

        return;
      }

      case "addCounter": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);
        const delta = this.evaluateNumber(effect.amount, context);

        card.counters[effect.counter] =
          (card.counters[effect.counter] ?? 0) + delta;

        if (delta !== 0) {
          this.emit({ type: "counterChanged", cardId: targetId, counter: effect.counter });
        }

        return;
      }

      case "removeCounter": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);
        const before = card.counters[effect.counter] ?? 0;

        card.counters[effect.counter] = Math.max(
          0,
          before - this.evaluateNumber(effect.amount, context)
        );

        if (card.counters[effect.counter] !== before) {
          this.emit({ type: "counterChanged", cardId: targetId, counter: effect.counter });
        }

        return;
      }

      case "createModifier": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        this.state.modifiers.push({
          id: nextId("modifier"),
          sourceId: context.sourceId,
          sourceAbilityId: context.abilityId,
          targetId,
          stat: effect.stat,
          operation: effect.operation,
          value: this.evaluateNumber(
            effect.value,
            context
          ),
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "takeControl": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        const card = this.requireCard(targetId);
        const newController = this.resolvePlayerRef(effect.controller, context);

        if (card.controllerId === newController.id) {
          return;
        }

        // "Opponents cannot take control of this card." (Gigantitect's Giant
        // Giant) — the grab fizzles when the current controller and the
        // would-be controller differ.
        if (
          this.hasRestriction(targetId, "cannotBeTakenControl") &&
          card.controllerId !== newController.id
        ) {
          return;
        }

        // "This turn, take control of the character." (Mutiny Grant) —
        // record the reversion target before we overwrite it. A card can be
        // grabbed durationally only once at a time; a fresh grab replaces
        // the pending reversion (keeping the *original* previous controller).
        if (effect.duration && effect.duration.type !== "permanent") {
          const existing = this.state.controlGrants.find(
            g => g.cardId === targetId
          );
          if (!existing) {
            this.state.controlGrants.push({
              id: nextId("controlGrant"),
              cardId: targetId,
              previousControllerId: card.controllerId,
              duration: effect.duration,
              createdTurn: this.state.turn
            });
          }
        }

        // A card in play is filed under its controller's `play` array
        // (see moveCard) — that bookkeeping has to move with it, or
        // getAvailableResourceIds/getThresholds/attack-eligibility loops
        // (all of which iterate a specific player's `play`) go stale.
        this.reassignControl(targetId, newController.id);
        return;
      }

      case "removeFromGame": {
        const targetId = this.resolveTargetRef(
          effect.target,
          context
        );

        if (!targetId) return;

        // RULES.md §12: impossible to fully carry out if it's already gone
        // — as far as "removed from the game" is concerned, that's already
        // true, so this is a no-op rather than an error.
        if (this.state.cards[targetId]) {
          this.moveCard(targetId, "removed");
        }

        return;
      }

      case "forEach": {
        // Snapshot the match set before resolving anything — an earlier
        // iteration destroying/moving a card must not shrink who else is
        // hit by this same effect (RULES.md-style "simultaneous" resolution).
        const candidateIds = effect.selected
          ? context.selected[effect.selected] ?? []
          : this.queryCards(effect.selector!, context).map(card => card.id);

        const nestedCtx = (id: CardInstanceId): ResolutionContext => ({
          ...context,
          selected: { ...context.selected, __candidate: [id] }
        });

        // `sequential` — one iteration at a time through the suspendable
        // effect-frame path, so a per-iteration chooser pauses / resumes
        // (Degenerate Molestation). Mirrors `forEachPlayer`.
        if (effect.sequential) {
          for (let ci = 0; ci < candidateIds.length; ci++) {
            const done = this.runEffectFrame({
              effects: effect.effects,
              index: 0,
              context: nestedCtx(candidateIds[ci])
            });
            if (!done) {
              const remainder = this.state.pendingEffectFrames.pop()!;
              for (let rj = candidateIds.length - 1; rj > ci; rj--) {
                this.state.pendingEffectFrames.push({
                  effects: effect.effects,
                  index: 0,
                  context: nestedCtx(candidateIds[rj])
                });
              }
              this.state.pendingEffectFrames.push(remainder);
              return;
            }
          }
          return;
        }

        this.beginEventBatch();
        try {
          for (const candidateId of candidateIds) {
            for (const nested of effect.effects) {
              this.resolveEffect(nested, nestedCtx(candidateId));
            }
          }
        } finally {
          this.endEventBatch();
        }

        return;
      }

      case "grantVoidPlay": {
        const player = this.resolvePlayerRef(effect.player, context);
        for (const cardId of context.selected[effect.selected] ?? []) {
          if (this.state.cards[cardId]?.zone !== "void") continue;
          if (
            this.state.voidPlayGrants.some(
              g => g.cardId === cardId && g.playerId === player.id
            )
          ) {
            continue;
          }
          this.state.voidPlayGrants.push({
            cardId,
            playerId: player.id,
            ignoreThreshold: effect.ignoreThreshold ?? false
          });
        }
        return;
      }

      case "randomFromSelection": {
        const pool = [...(context.selected[effect.selected] ?? [])];
        const take = Math.min(
          pool.length,
          Math.max(0, this.evaluateNumber(effect.count, context))
        );
        // Fisher–Yates prefix using the seeded RNG.
        for (let i = 0; i < take; i++) {
          const j = i + Math.floor(this.random() * (pool.length - i));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const chosen = pool.slice(0, take);

        this.beginEventBatch();
        try {
          for (const candidateId of chosen) {
            const nestedContext: ResolutionContext = {
              ...context,
              selected: { ...context.selected, __candidate: [candidateId] }
            };
            for (const nested of effect.effects) {
              this.resolveEffect(nested, nestedContext);
            }
          }
        } finally {
          this.endEventBatch();
        }
        return;
      }

      case "attachTo": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const toId = this.resolveTargetRef(effect.to, context);
        if (!targetId || !toId) return;

        this.requireCard(targetId).attachedTo = toId;
        return;
      }

      case "grantKeyword": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        this.state.keywordGrants.push({
          id: nextId("keywordGrant"),
          sourceId: context.sourceId,
          targetId,
          keyword: effect.keyword,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "suppressKeyword": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        this.state.keywordSuppressions.push({
          id: nextId("keywordSuppression"),
          sourceId: context.sourceId,
          targetId,
          keyword: effect.keyword,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "grantRestriction": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;

        this.state.restrictions.push({
          id: nextId("restriction"),
          sourceId: context.sourceId,
          targetId,
          restriction: effect.restriction,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "transformBattleDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;
        this.state.battleDamageTransforms.push({
          id: nextId("bdTransform"),
          sourceId: context.sourceId,
          cardId: targetId,
          role: effect.role,
          kind: effect.kind,
          amount:
            effect.amount !== undefined
              ? Math.max(0, this.evaluateNumber(effect.amount, context))
              : undefined,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "suppressAbilities": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;
        this.state.abilitySuppressions.push({
          id: nextId("abilitySuppression"),
          sourceId: context.sourceId,
          targetId,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "grantKeywordToPlayer": {
        const player = this.resolvePlayerRef(effect.player, context);
        this.state.playerKeywordGrants.push({
          id: nextId("playerKeywordGrant"),
          sourceId: context.sourceId,
          playerId: player.id,
          keyword: effect.keyword,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "modifyOutgoingDamage": {
        const sourceId = this.resolveTargetRef(effect.source, context);
        if (!sourceId) return;
        this.state.outgoingDamageModifiers.push({
          id: nextId("outgoingDmgMod"),
          sourceId,
          delta: this.evaluateNumber(effect.delta, context),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "grantResourceIcons": {
        const player = this.resolvePlayerRef(effect.player, context);

        this.state.resourceGrants.push({
          id: nextId("resourceGrant"),
          playerId: player.id,
          icon: effect.icon,
          amount: this.evaluateNumber(effect.amount, context),
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "reduceThreshold": {
        const player = this.resolvePlayerRef(effect.player, context);
        const icon: ResourceIcon | undefined =
          typeof effect.icon === "string"
            ? effect.icon
            : (this.state.cards[context.sourceId]?.namedValues?.[
                effect.icon.fromNamed
              ] as ResourceIcon | undefined);
        if (!icon) return;

        this.state.thresholdReductions.push({
          id: nextId("thresholdReduction"),
          playerId: player.id,
          icon,
          amount: Math.max(0, this.evaluateNumber(effect.amount, context)),
          createdTurn: this.state.turn
        });
        return;
      }

      case "grantProvides": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId || !this.state.cards[targetId]) return;

        const icon: ResourceIcon | undefined =
          typeof effect.icon === "string"
            ? effect.icon
            : (this.state.cards[context.sourceId]?.namedValues?.[
                effect.icon.fromNamed
              ] as ResourceIcon | undefined);
        if (!icon) return;

        const amount = this.evaluateNumber(effect.amount, context);
        if (amount <= 0) return;

        this.state.provideGrants.push({
          id: nextId("provideGrant"),
          sourceId: context.sourceId,
          targetId,
          icon,
          amount,
          duration: effect.duration,
          createdTurn: this.state.turn
        });

        return;
      }

      case "detach": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (targetId && this.state.cards[targetId]) {
          this.state.cards[targetId].attachedTo = undefined;
        }
        return;
      }

      case "restrictPlay": {
        const player = this.resolvePlayerRef(effect.player, context);
        this.state.playRestrictions.push({
          id: nextId("playRestriction"),
          playerId: player.id,
          kind: effect.kind,
          cardType: effect.cardType,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "preventAllDamage": {
        this.state.damagePreventionWindows.push({
          id: nextId("damagePreventionWindow"),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "restrictDestruction": {
        this.state.destructionRestrictionWindows.push({
          id: nextId("destructionRestrictionWindow"),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "grantSubtype": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        this.state.subtypeGrants.push({
          id: nextId("subtypeGrant"),
          sourceId: context.sourceId,
          targetId,
          subtype: effect.subtype,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "redirectHandMoves": {
        this.state.handMoveRedirects.push({
          id: nextId("handMoveRedirect"),
          sourceControllerId: context.controllerId,
          who: effect.who,
          to: effect.to,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "installReplacement": {
        this.state.runtimeReplacements.push({
          id: nextId("runtimeReplacement"),
          sourceId: context.sourceId,
          controllerId: context.controllerId,
          replaces: effect.replaces,
          condition: effect.condition,
          effects: effect.effects,
          selected: structuredClone(context.selected ?? {}),
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "spendCountersMenu": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        this.openSpendCountersMenu(
          chooser.id,
          effect.pool,
          effect.counter,
          effect.options,
          context
        );
        return;
      }

      case "scheduleEffect": {
        this.state.scheduledEffects.push({
          id: nextId("scheduled"),
          when: effect.when,
          turnScheduled: this.state.turn,
          sourceId: context.sourceId,
          controllerId: context.controllerId,
          condition: effect.condition,
          effects: effect.effects
        });
        return;
      }

      case "useAnyAbility": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const candidates = this.requirePlayer(chooser.id).play.filter(cardId => {
          const card = this.state.cards[cardId];
          if (!card || card.controllerId !== chooser.id || card.faceDown) {
            return false;
          }
          if (
            effect.selector &&
            !this.matchesSelector(card, effect.selector, context)
          ) {
            return false;
          }
          return (this.getDefinition(cardId).behavior?.abilities ?? []).some(
            a => a.type === "activated"
          );
        });

        if (candidates.length === 0) return;

        this.state.pendingChoice = {
          kind: "useAnyAbility",
          id: nextId("choice"),
          playerId: chooser.id,
          candidateCardIds: candidates,
          context
        };
        return;
      }

      case "if": {
        if (!this.evaluateCondition(effect.condition, context)) {
          return;
        }

        for (const nested of effect.effects) {
          this.resolveEffect(nested, context);
        }

        return;
      }

      case "shuffleDeck": {
        const player = this.resolvePlayerRef(effect.player, context);
        this.shuffleInPlace(player.deck);
        return;
      }

      case "chooserSelectsTarget": {
        // RULES.md §12: an instruction impossible to fully carry out (no
        // legal candidate at all, e.g. an empty hand to discard from) is
        // carried out as far as possible, not left as an unanswerable
        // pendingChoice requiring a selection that can't exist.
        const cstCandidates = this.targetCandidates(
          effect.declaration.selector,
          context
        );
        if (cstCandidates.length === 0) {
          return;
        }

        const chooser = this.resolvePlayerRef(effect.chooser, context);

        const searchesDeck = this.selectorNamesZone(
          effect.declaration.selector,
          "deck"
        );
        const deckOwnerId = searchesDeck ? cstCandidates[0]?.ownerId : undefined;

        // "Your opponents must pay N to search their deck." (Department of
        // Rejections) — an in-play `ContinuousAbility.searchTax` on a player
        // searching their OWN deck. Unpayable => the search does nothing.
        if (deckOwnerId && deckOwnerId === chooser.id) {
          const tax = this.searchTaxFor(chooser.id);
          if (tax > 0) {
            if (this.getAvailableResourceIds(chooser.id).length < tax) {
              return;
            }
            this.payNumericCost(chooser.id, tax);
          }
        }

        this.state.pendingChoice = {
          kind: "chooserSelectsTarget",
          id: nextId("choice"),
          playerId: chooser.id,
          declaration: effect.declaration,
          effects: effect.effects,
          context
        };

        // "If a player would search their deck ..." (Golden Charm) — picking
        // a card from a player's own deck IS the search. The choice is now
        // outstanding, so `emit` defers the trigger (processImmediateQueue
        // bails on a pending choice); it resolves once the search completes.
        if (deckOwnerId) {
          this.emit({ type: "deckSearched", playerId: deckOwnerId });
        }

        return;
      }

      case "chooserSelectsOption": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);

        this.state.pendingChoice = {
          kind: "chooserSelectsOption",
          id: nextId("choice"),
          playerId: chooser.id,
          optionCount: effect.options.length,
          options: effect.options,
          context
        };

        return;
      }

      case "setDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        const card = this.state.cards[targetId];
        if (card) card.damage = Math.max(0, this.evaluateNumber(effect.amount, context));
        return;
      }

      case "healDamage": {
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        const card = this.state.cards[targetId];
        if (card) {
          card.damage = Math.max(
            0,
            (card.damage ?? 0) - Math.max(0, this.evaluateNumber(effect.amount, context))
          );
        }
        return;
      }

      case "removeFromBattle": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const battle = this.state.battle;
        if (!targetId || !battle) return;
        battle.attackingParty = battle.attackingParty.filter(x => x !== targetId);
        battle.blockingParty = battle.blockingParty.filter(x => x !== targetId);
        return;
      }

      case "addToBattle": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const battle = this.state.battle;
        if (!targetId || !battle || battle.phase === "finished") return;

        const card = this.state.cards[targetId];
        if (
          !card ||
          card.zone !== "play" ||
          card.faceDown ||
          !this.hasCardType(targetId, "character")
        ) {
          return;
        }

        const side =
          effect.side === "attacking" ? battle.attackingParty : battle.blockingParty;
        const sideOwner =
          effect.side === "attacking"
            ? battle.attackerPlayerId
            : battle.defenderPlayerId;
        if (card.controllerId !== sideOwner) return;
        if (!side.includes(targetId)) side.push(targetId);
        return;
      }

      case "nameValue": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        this.state.pendingChoice = {
          kind: "nameValue",
          id: nextId("choice"),
          playerId: chooser.id,
          valueKind: effect.valueKind,
          sourceId: context.sourceId,
          storeAs: effect.storeAs
        };
        return;
      }

      case "mayPay": {
        const player = this.resolvePlayerRef(effect.player, context);
        // The prospective payer isn't always the ability's controller
        // ("that player may pay 2", "any opponent may pay 3") — check
        // affordability against, and later pay from, THEIR resources.
        const payCtx =
          player.id === context.controllerId
            ? context
            : { ...context, controllerId: player.id };
        if (!this.canPayCosts(effect.costs, payCtx)) {
          for (const e of effect.elseEffects ?? []) this.resolveEffect(e, context);
          return;
        }
        this.state.pendingChoice = {
          kind: "mayPay",
          id: nextId("choice"),
          playerId: player.id,
          cost: structuredClone(effect.costs),
          effects: effect.effects,
          elseEffects: effect.elseEffects ?? [],
          context
        };
        return;
      }

      case "createTokens": {
        const controller = this.resolvePlayerRef(effect.controller, context);
        const count = Math.max(0, this.evaluateNumber(effect.count, context));
        const made: CardInstanceId[] = [];
        for (let i = 0; i < count; i++) {
          made.push(this.createTokenPermanent(controller.id, effect.token));
        }
        // "... This turn, all damage inflicted to that token is reduced to
        // 0." — per-token follow-up effects, the new token bound to
        // `__candidate` (Micromajigmakermachinemajig, Micromajig Recycling).
        for (const tokenId of made) {
          for (const sub of effect.effects ?? []) {
            this.resolveEffect(sub, {
              ...context,
              selected: { ...context.selected, __candidate: [tokenId] }
            });
          }
        }
        return;
      }

      case "useTargetAbility": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const targetId = this.resolveTargetRef(effect.target, context);
        if (!targetId) return;
        const abilities = (
          this.getDefinition(targetId).behavior?.abilities ?? []
        ).filter(a => a.type === "activated") as ActivatedAbility[];
        if (abilities.length === 0) return;
        this.state.pendingChoice = {
          kind: "useTargetAbility",
          id: nextId("choice"),
          playerId: chooser.id,
          targetCardId: targetId,
          abilityIds: abilities.map(a => a.id),
          times: effect.times ?? 1
        };
        return;
      }

      case "forEachPlayer": {
        const order = [
          this.state.activePlayerId,
          this.getOpponent(this.state.activePlayerId).id
        ];
        for (let pi = 0; pi < order.length; pi++) {
          const pctx: ResolutionContext = {
            ...context,
            controllerId: order[pi]
          };
          const done = this.runEffectFrame({
            effects: effect.effects,
            index: 0,
            context: pctx
          });
          if (!done) {
            // A nested effect paused for this player. runEffectFrame just
            // pushed this player's remainder on top of pendingEffectFrames;
            // move it above the still-to-go players so resume order is
            // [this player's remainder, next player, ...].
            const remainder = this.state.pendingEffectFrames.pop()!;
            for (let rj = order.length - 1; rj > pi; rj--) {
              this.state.pendingEffectFrames.push({
                effects: effect.effects,
                index: 0,
                context: { ...context, controllerId: order[rj] }
              });
            }
            this.state.pendingEffectFrames.push(remainder);
            return;
          }
        }
        return;
      }

      case "lookAndReorder": {
        const player = this.resolvePlayerRef(effect.player, context);
        const chooser = effect.chooser
          ? this.resolvePlayerRef(effect.chooser, context)
          : player;
        const count = this.evaluateNumber(effect.count, context);
        const cardIds = player.deck.slice(0, Math.max(0, count));

        if (cardIds.length === 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "reorderDeck",
          id: nextId("choice"),
          playerId: chooser.id,
          deckOwnerId: player.id,
          cardIds,
          to: effect.to ?? "top"
        };

        return;
      }

      case "reduceNextCost": {
        const player = this.resolvePlayerRef(effect.player, context);
        const amount = this.evaluateNumber(effect.amount, context);

        this.state.costReductions.push({
          id: nextId("costReduction"),
          playerId: player.id,
          amount,
          cardType: effect.cardType,
          createdTurn: this.state.turn
        });

        return;
      }

      case "deployForFree": {
        const player = this.resolvePlayerRef(effect.player, context);
        const perCardCap = this.evaluateNumber(effect.maxCost, context);
        const budget =
          effect.budget === undefined
            ? undefined
            : Math.max(0, this.evaluateNumber(effect.budget, context));
        const cap = budget === undefined ? perCardCap : Math.min(perCardCap, budget);

        const candidates = this.deployForFreeCandidates(
          player.id,
          cap,
          effect.selector,
          context
        );

        if (candidates.length === 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "deployForFree",
          id: nextId("choice"),
          playerId: player.id,
          candidates,
          payCost: effect.free === false,
          budgetRemaining: budget,
          perCardCap: budget === undefined ? undefined : perCardCap,
          selector: budget === undefined ? undefined : effect.selector,
          context
        };

        return;
      }

      case "distributeAmong": {
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const targets = context.selected[effect.selected] ?? [];
        const amount = this.evaluateNumber(effect.amount, context);

        if (targets.length === 0 || amount <= 0) {
          return;
        }

        this.state.pendingChoice = {
          kind: "distributeAmong",
          id: nextId("choice"),
          playerId: chooser.id,
          targets,
          amount,
          effects: effect.effects,
          context
        };

        return;
      }

      case "separateIntoPiles": {
        const splitter = this.resolvePlayerRef(effect.splitter, context);
        const cardIds = context.selected[effect.selected] ?? [];
        if (cardIds.length === 0) return;
        this.state.pendingChoice = {
          kind: "pileAssignment",
          id: nextId("choice"),
          playerId: splitter.id,
          cardIds: [...cardIds],
          pile1Effects: effect.pile1,
          pile2Effects: effect.pile2,
          context
        };
        return;
      }

      case "anyPlayerMayPay": {
        const order = [
          this.state.activePlayerId,
          this.getOpponent(this.state.activePlayerId).id
        ];
        this.state.pendingChoice = {
          kind: "anyPlayerMayPay",
          id: nextId("choice"),
          playerId: order[0],
          remaining: order.slice(1),
          cost: structuredClone(effect.costs),
          effects: effect.effects,
          context
        };
        return;
      }

      case "alternatingPayLoop": {
        const a = this.resolvePlayerRef(effect.first, context).id;
        const b = this.resolvePlayerRef(effect.opponent, context).id;
        this.state.pendingChoice = {
          kind: "alternatingPay",
          id: nextId("choice"),
          playerId: a,
          players: [a, b],
          turnIndex: 0,
          cost: structuredClone(effect.cost),
          roundsLeft: (effect.maxRounds ?? 20) * 2,
          tallies: { [a]: 0, [b]: 0 },
          onEnd: effect.onEnd,
          context
        };
        return;
      }

      case "lockAbilityThisTurn": {
        const locks: string[] = [];
        if (effect.target === "respondedAbility") {
          let found: { sourceId: string; abilityId: string } | undefined;
          for (let i = this.responseStack.length - 1; i >= 0; i--) {
            const item = this.responseStack[i];
            if (
              item.kind === "ability" &&
              item.abilityId &&
              item.sourceId !== context.sourceId
            ) {
              found = { sourceId: item.sourceId, abilityId: item.abilityId };
              break;
            }
          }
          found ??= this.lastTerminatedAbility;
          if (found) locks.push(`${found.sourceId}:${found.abilityId}`);
        } else {
          const cardId = this.resolveTargetRef(effect.target, context);
          if (cardId) {
            for (const a of this.getDefinition(cardId).behavior?.abilities ?? []) {
              if (a.type === "activated") locks.push(`${cardId}:${a.id}`);
            }
          }
        }
        for (const key of locks) {
          this.state.abilityUsesThisTurn[key] = Number.MAX_SAFE_INTEGER;
        }
        return;
      }

      case "flipCoin": {
        const flipper = this.resolvePlayerRef(
          effect.player ?? "controller",
          context
        );
        const won = this.random() < 0.5;

        if (!won) {
          const repl = this.findCoinFlipLossReplacement(flipper.id, context);
          if (repl) {
            this.state.pendingCoinFlip = {
              context,
              flipperId: flipper.id,
              winEffects: structuredClone(effect.winEffects),
              loseEffects: structuredClone(effect.loseEffects),
              replacementCost: structuredClone(repl.cost),
              replacementEffects: structuredClone(repl.effects),
              replacementSourceId: repl.sourceId
            };
            this.state.pendingChoice = {
              kind: "coinFlipReplace",
              id: nextId("choice"),
              playerId: flipper.id,
              cost: structuredClone(repl.cost)
            };
            return;
          }
        }

        this.emit({ type: "coinFlipped", playerId: flipper.id, won });
        for (const sub of won ? effect.winEffects : effect.loseEffects) {
          this.resolveEffect(sub, context);
          this.checkStateBasedActions();
        }
        return;
      }

      case "restrictBlockers": {
        const targetId = this.resolveTargetRef(effect.target ?? "source", context);
        if (!targetId) return;
        this.state.blockRestrictionGrants.push({
          id: nextId("blockRestriction"),
          sourceId: context.sourceId,
          targetId,
          minPartySize: effect.minPartySize,
          minSpeed: effect.minSpeed,
          condition: effect.condition,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "restrictParty": {
        const targetId = this.resolveTargetRef(effect.target ?? "source", context);
        if (!targetId) return;
        this.state.partyRestrictionGrants.push({
          id: nextId("partyRestriction"),
          sourceId: context.sourceId,
          targetId,
          role: effect.role,
          minMembers: effect.minMembers,
          maxMembers: effect.maxMembers,
          parity: effect.parity,
          duration: effect.duration,
          createdTurn: this.state.turn
        });
        return;
      }

      case "restrictBlockersToChosen": {
        const battle = this.state.battle;
        if (!battle || battle.phase === "finished") return;
        const chooser = this.resolvePlayerRef(effect.chooser, context);
        const candidates = this.targetCandidates(
          effect.declaration.selector,
          { ...context, controllerId: chooser.id }
        ).map(card => card.id);
        this.state.pendingChoice = {
          kind: "chooseChosenBlockers",
          id: nextId("choice"),
          playerId: chooser.id,
          candidates
        };
        return;
      }

      case "grantAbilitiesFrom": {
        const targetId = this.resolveTargetRef(effect.target, context);
        const fromId = this.resolveTargetRef(effect.from, context);
        if (!targetId || !fromId) return;
        const abilities = (
          this.getDefinition(fromId).behavior?.abilities ?? []
        ).filter(a => a.type === "activated" || a.type === "triggered");
        if (abilities.length === 0) return;
        this.state.abilityGrants.push({
          id: nextId("abilityGrant"),
          cardId: targetId,
          sourceId: context.sourceId,
          abilities: structuredClone(abilities)
        });
        return;
      }

      case "redirectAttackTarget": {
        const battle = this.state.battle;
        if (!battle || battle.phase === "finished") return;
        const toId = this.resolveTargetRef(effect.to, context);
        const toCard = toId ? this.state.cards[toId] : undefined;
        if (!toCard || toCard.zone !== "play") return;
        battle.target = { type: "card", cardId: toId! };
        battle.defenderPlayerId = toCard.controllerId;
        return;
      }

      case "initiateAttack": {
        const attackerIds = (context.selected[effect.attackerSelection] ?? [])
          .filter(id => {
            const c = this.state.cards[id];
            return (
              c &&
              c.zone === "play" &&
              !c.faceDown &&
              this.hasCardType(id, "character") &&
              !c.depleted &&
              !this.hasRestriction(id, "cannotAttack")
            );
          });
        if (attackerIds.length === 0) return;
        const defender = this.resolvePlayerRef(effect.target, context);
        this.runInitiatedAttack(attackerIds, defender.id);
        return;
      }

      case "auctionForCard": {
        const deckOwner = this.resolvePlayerRef(effect.revealFor, context);
        this.beginAuction(context, deckOwner.id);
        return;
      }
    }
  }

  /**
   * The `alternatingPay` loop step: `paid` records this decider's choice.
   * On accept, pay + tally + hand to the other player; on decline (or when
   * rounds run out) end the loop — merge the tallies into
   * `context.variables["paid:<playerId>"]` and queue `onEnd`.
   */
  private advanceAlternatingPay(
    pending: Extract<PendingChoice, { kind: "alternatingPay" }>,
    paid: boolean
  ): void {
    const decider = pending.players[pending.turnIndex];

    if (paid && this.canPayCosts(pending.cost, { ...pending.context, controllerId: decider })) {
      this.payCosts(pending.cost, { ...pending.context, controllerId: decider });
      pending.tallies[decider] = (pending.tallies[decider] ?? 0) + 1;

      const nextIndex = (pending.turnIndex === 0 ? 1 : 0) as 0 | 1;
      if (pending.roundsLeft > 1) {
        this.state.pendingChoice = {
          ...pending,
          id: nextId("choice"),
          playerId: pending.players[nextIndex],
          turnIndex: nextIndex,
          roundsLeft: pending.roundsLeft - 1
        };
        return;
      }
    }

    // Loop over — resume with the tallies bound. Both a role-keyed pair
    // (`__paidByFirst` / `__paidByOpponent`) and per-id keys
    // (`paid:<playerId>`) are exposed.
    this.state.pendingChoice = undefined;
    const merged: Record<string, number> = { ...pending.context.variables };
    merged.__paidByFirst = pending.tallies[pending.players[0]] ?? 0;
    merged.__paidByOpponent = pending.tallies[pending.players[1]] ?? 0;
    for (const p of pending.players) merged[`paid:${p}`] = pending.tallies[p] ?? 0;
    this.state.pendingEffectFrames.push({
      effects: pending.onEnd,
      index: 0,
      context: { ...pending.context, variables: merged }
    });
    this.resumeEffectFrames();
  }

  // ---------------------------------------------------------------------------
  // Continuous modifiers
  // ---------------------------------------------------------------------------

  /**
   * Decides whether a continuous modifier/keyword/restriction binding
   * (`{ target?, selector? }`) applies to `targetId`, and returns the
   * resolution context its `value` should be evaluated against, or
   * `undefined` if it doesn't apply.
   *
   * - `selector` form (an aura): applies to every in-play card the selector
   *   matches, with the candidate bound to `{ selected: "__candidate" }` so
   *   per-target amounts (`printedStat`/`stat` of `__candidate`) resolve.
   * - `target` form (the original): applies only to the one card
   *   `resolveTargetRef(target)` points at.
   * - neither set: malformed — applies to nothing.
   */
  private continuousBindingContext(
    binding: { target?: TargetRef; selector?: CardSelector },
    context: ResolutionContext,
    targetId: CardInstanceId
  ): ResolutionContext | undefined {
    if (binding.selector) {
      const auraContext: ResolutionContext = {
        ...context,
        selected: { ...context.selected, __candidate: [targetId] }
      };
      const card = this.state.cards[targetId];
      return card && this.matchesSelector(card, binding.selector, auraContext)
        ? auraContext
        : undefined;
    }

    if (
      binding.target &&
      this.resolveTargetRef(binding.target, context) === targetId
    ) {
      return context;
    }

    return undefined;
  }

  /**
   * Runs `baseCost` through every in-play `ContinuousAbility.costModifiers`
   * entry that targets `playerId`'s deploy of `cardId` — "opponents pay 1
   * more to deploy a tactic", "characters you play cost 2 less (min 1)".
   * Each modifier clamps the running total to its own `minCost` (default 0).
   */
  private applyCostModifiers(
    playerId: PlayerId,
    cardId: CardInstanceId,
    baseCost: number
  ): number {
    const card = this.state.cards[cardId];
    if (!card) return Math.max(0, baseCost);

    let cost = baseCost;

    // Per-card "this turn, the character loses/gains N numeric cost"
    // (`modifyNumericCost` — Guileful Astucion).
    for (const mod of this.state.numericCostModifiers) {
      if (mod.targetId === cardId) cost += mod.delta;
    }

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.costModifiers) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [cardId] }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const mod of ability.costModifiers) {
          if (this.resolvePlayerRef(mod.affects, context).id !== playerId) {
            continue;
          }
          if (mod.selector && !this.matchesSelector(card, mod.selector, context)) {
            continue;
          }
          cost = Math.max(
            mod.minCost ?? 0,
            cost + this.evaluateNumber(mod.delta, context)
          );
        }
      }
    }

    return Math.max(0, cost);
  }

  /**
   * The net adjustment every in-play `ContinuousAbility.damageModifiers`
   * entry makes to a single instance of damage being inflicted to
   * `targetId` — "reduce battle damage to your characters by 2". The caller
   * floors the final amount at 0.
   */
  private damageDeltaFor(
    targetId: CardInstanceId,
    isBattle: boolean,
    damageSourceId?: CardInstanceId,
    incomingAmount?: number
  ): number {
    const target = this.state.cards[targetId];
    if (!target) return 0;

    // "This turn ... all inflicted damage is reduced to 0." (Limited
    // Liability) — a blanket window; drive every incoming instance to 0.
    if (this.state.damagePreventionWindows.length > 0) {
      return -(incomingAmount ?? 1e9);
    }

    let delta = 0;
    // "When any amount of damage greater than 4 is inflicted to this card,
    // reduce it to 0." (Class Action Defender) — `{ minAmount, setTo }`
    // clamps applied after the additive delta.
    let clampTo: number | undefined;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.damageModifiers) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [targetId] }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const mod of ability.damageModifiers) {
          if (mod.battleOnly && !isBattle) continue;
          if (!this.matchesSelector(target, mod.selector, context)) continue;
          if (mod.sourceSelector) {
            const dealer = damageSourceId
              ? this.state.cards[damageSourceId]
              : undefined;
            // `sourceSelector.conditions` bind `__candidate` to the DEALER,
            // not the damaged card.
            if (
              !dealer ||
              !this.matchesSelector(dealer, mod.sourceSelector, {
                ...context,
                selected: { ...context.selected, __candidate: [dealer.id] }
              })
            ) {
              continue;
            }
          }
          delta += this.evaluateNumber(mod.delta, context);

          if (mod.minAmount !== undefined && incomingAmount !== undefined) {
            const min = this.evaluateNumber(mod.minAmount, context);
            if (incomingAmount + delta >= min) {
              const setTo =
                mod.setTo !== undefined
                  ? this.evaluateNumber(mod.setTo, context)
                  : 0;
              clampTo = clampTo === undefined ? setTo : Math.min(clampTo, setTo);
            }
          }
        }
      }
    }

    // "This turn, reduce damage inflicted BY <card> by N." (Sockem Bot).
    if (damageSourceId) {
      for (const mod of this.state.outgoingDamageModifiers) {
        if (mod.sourceId === damageSourceId) delta += mod.delta;
      }
    }

    if (clampTo !== undefined && incomingAmount !== undefined) {
      return clampTo - incomingAmount;
    }

    return delta;
  }

  /**
   * Consume `preventDamage` shields on `targetId` against `amount` incoming
   * points (after `damageDeltaFor`). Returns how much still lands on the
   * target, plus any redirected chunks (which are applied raw — no further
   * modifiers/shields on the redirect target). Shields are consumed in
   * registration order and dropped once emptied.
   */
  private absorbDamage(
    targetId: CardInstanceId,
    amount: number
  ): { toTarget: number; redirects: Array<{ cardId: CardInstanceId; amount: number }> } {
    const redirects: Array<{ cardId: CardInstanceId; amount: number }> = [];
    let remaining = amount;

    for (const shield of this.state.damageShields) {
      if (remaining <= 0) break;
      if (shield.targetId !== targetId || shield.amount <= 0) continue;

      // "Reduce the next damage instance to 0" — swallow the whole instance,
      // then the shield is spent (Visible Loaf).
      if (shield.wholeInstance) {
        remaining = 0;
        shield.amount = 0;
        continue;
      }

      const absorbed = Math.min(shield.amount, remaining);
      shield.amount -= absorbed;
      remaining -= absorbed;

      if (shield.mode === "redirect" && shield.redirectToId) {
        redirects.push({ cardId: shield.redirectToId, amount: absorbed });
      }
    }

    this.state.damageShields = this.state.damageShields.filter(s => s.amount > 0);

    return { toTarget: Math.max(0, remaining), redirects };
  }

  private getContinuousModifiers(
    targetId: CardInstanceId
  ): RuntimeModifier[] {
    const results: RuntimeModifier[] = [];

    for (const source of Object.values(
      this.state.cards
    )) {
      if (source.zone !== "play" || source.faceDown) {
        continue;
      }
      // "Effects from <cardType> do not affect this card." (Parkour Hoodlum)
      if (this.sourceClassIgnoredByTarget(targetId, source.id)) {
        continue;
      }

      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        if (this.abilitySuppressed(source.id, ability.id)) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {
            target: [targetId]
          }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(
            ability.condition,
            context
          )
        ) {
          continue;
        }

        for (const modifier of ability.modifiers ?? []) {
          const auraContext = this.continuousBindingContext(
            modifier,
            context,
            targetId
          );

          if (!auraContext) {
            continue;
          }

          results.push({
            id: `continuous:${source.id}:${ability.id}:${targetId}:${modifier.stat}`,
            sourceId: source.id,
            sourceAbilityId: ability.id,
            targetId,
            stat: modifier.stat,
            operation: modifier.operation,
            value: this.evaluateNumber(
              modifier.value,
              auraContext
            ),
            duration: {
              type: "whileSourceInPlay"
            },
            createdTurn: this.state.turn
          });
        }
      }
    }

    return results;
  }

  /** Mirrors getContinuousModifiers, but for `ContinuousAbility.keywords`. */
  private getContinuousKeywordGrants(
    targetId: CardInstanceId
  ): Keyword[] {
    const results: Keyword[] = [];

    for (const source of Object.values(this.state.cards)) {
      if (this.sourceClassIgnoredByTarget(targetId, source.id)) {
        continue;
      }

      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        if (!ability.keywords) {
          continue;
        }
        // A continuous ability is live only while its source sits in
        // `activeZone` (default "play", face-up) — "while this card is in
        // your hand, it gains TACTICAL" (Parkour Hoodlum); "all characters
        // in your hand gain TACTICAL" (Gloamspike-Gosche Bridge, an aura).
        const activeZone = ability.activeZone ?? "play";
        if (activeZone === "play") {
          if (source.zone !== "play" || source.faceDown) continue;
        } else if (source.zone !== activeZone) {
          continue;
        }
        if (this.abilitySuppressed(source.id, ability.id)) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {
            target: [targetId]
          }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const grant of ability.keywords) {
          if (!this.continuousBindingContext(grant, context, targetId)) {
            continue;
          }

          results.push(grant.keyword);
        }
      }
    }

    return results;
  }

  /** Mirrors getContinuousKeywordGrants, but for `ContinuousAbility.suppressKeywords` ("it loses COVERT"). */
  private getContinuousKeywordSuppressions(
    targetId: CardInstanceId
  ): Keyword[] {
    const results: Keyword[] = [];

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      if (this.sourceClassIgnoredByTarget(targetId, source.id)) continue;

      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        if (!ability.suppressKeywords) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { target: [targetId] }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const grant of ability.suppressKeywords) {
          if (!this.continuousBindingContext(grant, context, targetId)) continue;
          results.push(grant.keyword);
        }
      }
    }

    return results;
  }

  /** Mirrors getContinuousKeywordGrants, but for `ContinuousAbility.restrictions`. */
  private getContinuousRestrictionGrants(
    targetId: CardInstanceId
  ): Restriction[] {
    const results: Restriction[] = [];

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) {
        continue;
      }
      if (this.sourceClassIgnoredByTarget(targetId, source.id)) {
        continue;
      }

      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        if (!ability.restrictions) {
          continue;
        }
        if (this.abilitySuppressed(source.id, ability.id)) {
          continue;
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {
            target: [targetId]
          }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        for (const grant of ability.restrictions) {
          if (!this.continuousBindingContext(grant, context, targetId)) {
            continue;
          }

          results.push(grant.restriction);
        }
      }
    }

    return results;
  }

  /**
   * A live `ContinuousAbility.voidPlay` grant (Voidal Tactician) that lets
   * `playerId` deploy the void-zone card `cardId` as though from hand — or
   * `undefined`. The granting source must be in play, face-up, controlled
   * by `playerId`, its `condition` (if any) holding, and its
   * `voidPlay.selector` matching `cardId`.
   */
  private continuousVoidPlayGrantFor(
    cardId: CardInstanceId,
    playerId: PlayerId
  ): { ignoreThreshold: boolean } | undefined {
    const card = this.state.cards[cardId];
    if (!card) return undefined;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      if (source.controllerId !== playerId) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.voidPlay) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }
        if (!this.matchesSelector(card, ability.voidPlay.selector, context)) {
          continue;
        }
        return { ignoreThreshold: !!ability.voidPlay.ignoreThreshold };
      }
    }

    return undefined;
  }

  /**
   * True when an in-play `ContinuousAbility.playRestrictions` entry (Lockbox
   * of the Aeons, Geldale City-Fortress, Incriminating Photograph) currently
   * forbids `playerId` from the given play — `{ kind: "flipUp" }`,
   * `{ cardType }`, or `{ name }` (a named-card ban).
   */
  private continuousPlayRestricted(
    playerId: PlayerId,
    query: { kind: "flipUp" } | { cardType: CardType } | { name: string }
  ): boolean {
    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        if (!ability.playRestrictions) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, {
            sourceId: source.id,
            controllerId: source.controllerId,
            abilityId: ability.id,
            selected: {}
          })
        ) {
          continue;
        }

        for (const entry of ability.playRestrictions) {
          const targeted =
            entry.player === "any"
              ? true
              : entry.player === "self"
                ? source.controllerId === playerId
                : this.getOpponent(source.controllerId).id === playerId;
          if (!targeted) continue;
          if (
            entry.timing === "notActivePlayer" &&
            playerId === this.state.activePlayerId
          ) {
            continue;
          }
          if ("kind" in query) {
            if (entry.kind === "flipUp") return true;
          } else if (typeof entry.kind === "object" && "cardType" in entry.kind) {
            if (
              "cardType" in query &&
              entry.kind.cardType === query.cardType
            ) {
              return true;
            }
          } else if (typeof entry.kind === "object" && "named" in entry.kind) {
            const banned = source.namedValues?.[entry.kind.named];
            if ("name" in query && banned && banned === query.name) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * The zone a card that would enter a hand should go to instead, per an
   * active `redirectHandMoves` window (Quotidian Misfire — `"discard"`), or
   * `undefined` if none applies. The most-recently-installed window wins.
   */
  private handMoveRedirectFor(cardId: CardInstanceId): Zone | undefined {
    const card = this.state.cards[cardId];
    if (!card) return undefined;
    let redirect: Zone | undefined;
    for (const w of this.state.handMoveRedirects) {
      if (
        this.scopeMatchesPlayer(w.who, w.sourceControllerId, card.ownerId)
      ) {
        redirect = w.to;
      }
    }
    return redirect;
  }

  /**
   * True when an in-play `ContinuousAbility.restrictReturnToHand` entry
   * (Lockbox of the Aeons) forbids moving `cardId` to its owner's hand from
   * `fromZone`.
   */
  private returnToHandRestricted(
    cardId: CardInstanceId,
    fromZone: Zone
  ): boolean {
    const card = this.state.cards[cardId];
    if (!card) return false;

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getEffectiveContinuousAbilities(source.id)) {
        const rule = ability.restrictReturnToHand;
        if (!rule) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, {
            sourceId: source.id,
            controllerId: source.controllerId,
            abilityId: ability.id,
            selected: {}
          })
        ) {
          continue;
        }
        const targeted =
          rule.player === "any"
            ? true
            : rule.player === "self"
              ? source.controllerId === card.ownerId
              : this.getOpponent(source.controllerId).id === card.ownerId;
        if (targeted && rule.fromZones.includes(fromZone)) return true;
      }
    }
    return false;
  }

  /** Public: a renderer needs a card's live restriction set; same check battle legality uses. */
  hasRestriction(cardId: CardInstanceId, restriction: Restriction): boolean {
    if (
      this.state.restrictions.some(
        grant => grant.targetId === cardId && grant.restriction === restriction
      )
    ) {
      return true;
    }

    return this.getContinuousRestrictionGrants(cardId).includes(restriction);
  }

  /** Every restriction `cardId` currently has (see `hasRestriction`). */
  getRestrictions(cardId: CardInstanceId): Restriction[] {
    const all: Restriction[] = [
      "cannotAttack",
      "cannotBlock",
      "mustAttack",
      "mustBlock",
      "cannotBeRestored",
      "cannotBeRestoredByRule",
      "cannotBePicked",
      "attackOncePerTurn",
      "cannotBeTakenControl"
    ];
    return all.filter(restriction => this.hasRestriction(cardId, restriction));
  }

  /**
   * True when some in-play `ContinuousAbility.suppressAllAbilities` (whose
   * `condition` holds and whose `target`/`selector` resolves to `cardId`)
   * turns off `cardId`'s ability `abilityId` — "this card loses all other
   * rules text" / "the attached character has no rules text". The
   * suppressing ability itself is never suppressed (so a paragraph like
   * "loses all other rules text and loses 1 speed" keeps its own -1 speed).
   * Consulted by every ability-enumeration site (activated, triggered,
   * continuous recompute, replacement scan, `hasAbility`).
   */
  private abilitySuppressed(
    cardId: CardInstanceId,
    abilityId: AbilityId
  ): boolean {
    // Duration'd "this card loses all rules text" (iDumb De-Itemizer — RESET).
    // Entries sit in the list (like `keywordGrants`) until the start-of-turn
    // sweep clears them; only `whileSourceInPlay` needs a live source check.
    if (
      this.state.abilitySuppressions.some(
        s =>
          s.targetId === cardId &&
          (s.duration.type !== "whileSourceInPlay" ||
            (!!s.sourceId && this.state.cards[s.sourceId]?.zone === "play"))
      )
    ) {
      return true;
    }

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.suppressAllAbilities) {
          continue;
        }
        if (source.id === cardId && ability.id === abilityId) continue;

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        const spec = ability.suppressAllAbilities;
        if (spec.selector) {
          if (
            this.queryCards(spec.selector, context).some(c => c.id === cardId)
          ) {
            return true;
          }
        } else if (
          this.resolveTargetRef(spec.target ?? "source", context) === cardId
        ) {
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // State-based actions
  // ---------------------------------------------------------------------------

  private checkStateBasedActions(): void {
    let changed = true;

    while (changed) {
      changed = false;

      // A pending choice freezes the whole engine until it's answered — and
      // in particular an *optional replacement* awaiting accept/decline
      // leaves its would-be-destroyed card sitting with lethal damage. Don't
      // keep re-triggering the replacement (or anything else) here; every
      // `resolvePendingChoice` branch re-runs this check once it's settled.
      if (this.state.pendingChoice) return;

      for (const card of Object.values(this.state.cards)) {
        if (card.zone !== "play" || card.faceDown) {
          continue;
        }

        const definition = this.getDefinition(card.id);
        const isCharacter = this.hasCardType(card.id, "character");
        const isLocation = this.hasCardType(card.id, "location");

        // CR §208.4 — a card that has lost the character type while in a
        // battle is pulled from it immediately (whatever caused the loss:
        // a `setCardType` grant expiring, its source leaving play).
        if (this.state.battle && !isCharacter) {
          const b = this.state.battle;
          if (
            b.attackingParty.includes(card.id) ||
            b.blockingParty.includes(card.id)
          ) {
            b.attackingParty = b.attackingParty.filter(x => x !== card.id);
            b.blockingParty = b.blockingParty.filter(x => x !== card.id);
            changed = true;
            break;
          }
        }

        // Lethal damage: characters clear it every turn, locations carry it
        // across turns (see RULES.md §3), but both die the same way once
        // accumulated damage reaches their capacity — `life` for a
        // character, `structure` for a location (distinct stats/fields).
        if (isCharacter || isLocation) {
          const capacity = this.getStat(
            card.id,
            isCharacter ? "life" : "structure"
          );

          if (capacity > 0 && card.damage >= capacity) {
            // Attribute the destruction to whoever last dealt the damage, so
            // a `replaces.by: "opponent"` guard (Giada) fires for a lethal
            // hit from an opposing character. Battle damage records this;
            // non-battle `dealDamage` leaves `currentCause` set from its
            // effect's controller.
            const battleCause = this.lethalDamageCause.get(card.id);
            if (battleCause) this.currentCause = battleCause;
            this.destroyCard(card.id, true, false, battleCause !== undefined);
            this.lethalDamageCause.delete(card.id);
            changed = true;
            break;
          }
        }

        // Attach to X (RULES.md §9): two different outcomes —
        //  - host still in play but no longer the required type: CR §507.2e,
        //    destroy the attaching card;
        //  - no valid host at all (none was pickable on entry, or the host
        //    has since left play): CR §507.2c, put the attaching card into
        //    its owner's discard pile — a move, not a destruction (fires
        //    `cardMoved`, honours discard replacements).
        if (definition.attachTo) {
          const target = card.attachedTo
            ? this.state.cards[card.attachedTo]
            : undefined;

          const hostInPlay = !!target && target.zone === "play";
          const hostRightType =
            hostInPlay &&
            this.hasCardType(target!.id, definition.attachTo);

          if (hostInPlay && !hostRightType) {
            this.destroyCard(card.id);
            changed = true;
            break;
          }

          if (!hostInPlay) {
            // "This card does not leave play if the attached card leaves
            // play" (Everlasting Blade of Light) — it stays in play,
            // unattached, instead of going to the discard pile.
            if (definition.behavior?.keepOnHostLeave) {
              if (card.attachedTo !== undefined) {
                card.attachedTo = undefined;
                changed = true;
                break;
              }
            } else {
              this.moveCard(card.id, "discard");
              changed = true;
              break;
            }
          }
        }
      }

      if (changed) continue;

      // Unique: a player may not control more than one in-play card per
      // Unique designation (RULES.md §9). Which copy survives is the
      // player's decision, so this pauses the engine on a pendingChoice
      // rather than guessing — see resolvePendingChoice.
      if (!this.state.pendingChoice) {
        const groups = new Map<
          string,
          { controllerId: PlayerId; unique: string; cardIds: CardInstanceId[] }
        >();

        for (const card of Object.values(this.state.cards)) {
          if (card.zone !== "play" || card.faceDown) continue;

          const unique = this.getEffectiveUnique(card.id);
          if (!unique) continue;

          const key = `${card.controllerId} ${unique}`;
          const group = groups.get(key) ?? {
            controllerId: card.controllerId,
            unique,
            cardIds: []
          };

          group.cardIds.push(card.id);
          groups.set(key, group);
        }

        const conflict = [...groups.values()].find(
          group => group.cardIds.length > 1
        );

        if (conflict) {
          this.state.pendingChoice = {
            kind: "uniqueSurvivor",
            id: nextId("choice"),
            playerId: conflict.controllerId,
            unique: conflict.unique,
            candidates: conflict.cardIds
          };

          return;
        }
      }

      // Victory: a faction at 0 influence ends the game (RULES.md §1) —
      // unless an in-play `preventsDefeat` ability shields that faction
      // (Armored Keep — "You do not lose the game because your faction has
      // 0 influence").
      if (!this.state.winner) {
        const shielded = new Set<PlayerId>();
        this.forEachActiveContinuous((source, ability) => {
          const rule = ability.preventsDefeat;
          if (!rule) return;
          for (const p of Object.values(this.state.players)) {
            if (
              this.scopeMatchesPlayer(rule.player, source.controllerId, p.id)
            ) {
              shielded.add(p.id);
            }
          }
        });

        const losers = Object.values(this.state.players).filter(
          player => player.influence <= 0 && !shielded.has(player.id)
        );

        if (losers.length >= 2) {
          this.state.winner = "draw";
        } else if (losers.length === 1) {
          this.state.winner = this.getOpponent(losers[0].id).id;
        }
      }
    }
  }

  private resolvePendingChoice(
    playerId: PlayerId,
    choice: Extract<GameAction, { type: "resolvePendingChoice" }>["choice"]
  ): void {
    const pending = this.state.pendingChoice;

    assert(pending, "There is no pending choice.");
    assert(
      pending.kind === choice.kind,
      "This choice does not match the pending decision."
    );
    assert(pending.playerId === playerId, "It is not your decision to make.");

    switch (choice.kind) {
      case "uniqueSurvivor": {
        assert(pending.kind === "uniqueSurvivor", "This choice does not match the pending decision.");
        assert(
          pending.candidates.includes(choice.keep),
          "That card is not one of the Unique candidates."
        );

        this.state.pendingChoice = undefined;

        for (const cardId of pending.candidates) {
          if (cardId !== choice.keep) {
            this.destroyCard(cardId);
          }
        }

        this.checkStateBasedActions();
        return;
      }

      case "selectTargets": {
        assert(pending.kind === "selectTargets", "This choice does not match the pending decision.");

        const trigger = this.immediateQueue[0];

        assert(
          trigger &&
            trigger.sourceId === pending.sourceId &&
            trigger.ability.id === pending.abilityId,
          "The pending trigger is no longer waiting to resolve."
        );

        for (const declaration of pending.declarations) {
          const selection = choice.selected[declaration.id];

          assert(selection, `Missing selection for target '${declaration.id}'.`);

          const max = this.evaluateNumber(declaration.count, trigger.context);
          const min = declaration.optional ? 0 : max;

          assert(
            selection.length >= min && selection.length <= max,
            `Target '${declaration.id}' requires ` +
              (min === max ? `${max}` : `${min}-${max}`) +
              " selection(s)."
          );
          assert(
            new Set(selection).size === selection.length,
            `Target '${declaration.id}' selected the same card more than once.`
          );

          const legal = new Set(
            this.targetCandidates(declaration.selector, trigger.context).map(card => card.id)
          );

          for (const cardId of selection) {
            assert(legal.has(cardId), `Illegal target '${cardId}' for '${declaration.id}'.`);
          }

          this.assertDistinctNames(declaration, selection);
        }

        trigger.context.selected = {
          ...trigger.context.selected,
          ...choice.selected
        };

        this.state.pendingChoice = undefined;
        this.processImmediateQueue();
        return;
      }

      case "orderTriggers": {
        assert(pending.kind === "orderTriggers", "This choice does not match the pending decision.");

        const batchId = this.immediateQueue[0]?.batchId;
        const batch = batchId ? this.getUnorderedTriggerBatch(batchId) : [];

        // CR §503.4a: the order is decided one trigger at a time — the
        // deciding player picks which happens *next*, it resolves fully,
        // then (if 2+ remain) they pick again. Not a full permutation up
        // front, since resolving one trigger can change another's legality
        // or targets.
        const pickIndex = batch.findIndex(
          queued =>
            queued.sourceId === choice.next.sourceId &&
            queued.ability.id === choice.next.abilityId
        );

        assert(
          pickIndex !== -1,
          `'${choice.next.sourceId}:${choice.next.abilityId}' is not one of the triggers waiting to resolve.`
        );

        const [picked] = batch.splice(pickIndex, 1);
        // Fresh, unshared batch id so the picked trigger resolves alone and
        // isn't re-detected as needing an ordering decision.
        picked.batchId = nextId("batch");

        // Queue head becomes: picked, then the still-unordered rest (their
        // shared batch id intact, so 2+ of them re-prompt after `picked`).
        this.immediateQueue.splice(0, 1 + batch.length, picked, ...batch);

        this.state.pendingChoice = undefined;
        this.processImmediateQueue();
        return;
      }

      case "chooserSelectsTarget": {
        assert(pending.kind === "chooserSelectsTarget", "This choice does not match the pending decision.");

        const declaration = pending.declaration;
        const selection = choice.selected;

        const max = this.evaluateNumber(declaration.count, pending.context);
        const min = declaration.optional ? 0 : max;

        assert(
          selection.length >= min && selection.length <= max,
          `Target '${declaration.id}' requires ` +
            (min === max ? `${max}` : `${min}-${max}`) +
            " selection(s)."
        );
        assert(
          new Set(selection).size === selection.length,
          `Target '${declaration.id}' selected the same card more than once.`
        );

        const legal = new Set(
          this.targetCandidates(declaration.selector, pending.context).map(card => card.id)
        );

        for (const cardId of selection) {
          assert(legal.has(cardId), `Illegal target '${cardId}' for '${declaration.id}'.`);
        }

        this.assertDistinctNames(declaration, selection);

        pending.context.selected = {
          ...pending.context.selected,
          [declaration.id]: selection
        };

        this.state.pendingChoice = undefined;
        this.emitCardPicked({ [declaration.id]: selection }, pending.playerId);
        this.state.pendingEffectFrames.push({
          effects: pending.effects,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        // A `deckSearched` trigger deferred while this search was
        // outstanding (Golden Charm) may still be queued if the search's
        // follow-up effects didn't themselves emit anything.
        if (!this.state.pendingChoice) this.processImmediateQueue();
        return;
      }

      case "chooserSelectsOption": {
        assert(pending.kind === "chooserSelectsOption", "This choice does not match the pending decision.");
        assert(
          Number.isInteger(choice.index) &&
            choice.index >= 0 &&
            choice.index < pending.optionCount,
          "Invalid option index."
        );

        this.state.pendingChoice = undefined;
        this.state.pendingEffectFrames.push({
          effects: pending.options[choice.index].effects,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        return;
      }

      case "replacementChoice": {
        assert(pending.kind === "replacementChoice", "This choice does not match the pending decision.");
        const pr = this.state.pendingReplacement;
        assert(pr, "No pending replacement to resolve.");

        this.state.pendingChoice = undefined;
        this.state.pendingReplacement = undefined;

        const ctx: ResolutionContext = {
          sourceId: pr.sourceId,
          controllerId: playerId,
          abilityId: pr.abilityId,
          selected: { __candidate: [pr.affectedCardId] }
        };

        if (choice.apply) {
          this.payCosts(pr.cost, ctx);
          this.replacing.add(pr.affectedCardId);
          try {
            for (const effect of pr.effects) this.resolveEffect(effect, ctx);
          } finally {
            this.replacing.delete(pr.affectedCardId);
          }

          // CR §506.6 / §408.4b / §408.5c: replacing a card's destruction
          // reduces to 0 the damage it took from that destruction's source,
          // so a replaced-lethal card doesn't immediately re-die on the
          // next state-based check. (No per-source damage tracking — the
          // accumulator is cleared.)
          if (pr.original.event === "destroy") {
            const saved = this.state.cards[pr.affectedCardId];
            if (saved) saved.damage = 0;
          }
        } else if (this.state.cards[pr.affectedCardId]?.zone === "play") {
          // Declined — carry out the original event, bypassing the
          // replacement check this time.
          if (pr.original.event === "destroy") {
            this.destroyCard(pr.affectedCardId, true, true);
          } else {
            this.moveCard(
              pr.affectedCardId,
              pr.original.zone,
              true,
              "bottom",
              true
            );
          }
        }

        this.processImmediateQueue();
        this.checkStateBasedActions();
        this.resumeEffectFrames();
        return;
      }

      case "nameValue": {
        assert(pending.kind === "nameValue", "This choice does not match the pending decision.");
        assert(
          typeof choice.value === "string" && choice.value.length > 0,
          "A non-empty value must be named."
        );
        assert(
          pending.valueKind !== "resourceIcon" ||
            ["rage", "greed", "deception", "elitism", "obsession", "volition"].includes(
              choice.value
            ),
          "A resource icon must be named."
        );
        assert(
          pending.valueKind !== "trade" ||
            ["arcanist", "banker", "gearsmith", "rogue", "warlord", "universal"].includes(
              choice.value.toLowerCase()
            ),
          "A trade must be named."
        );

        const src = this.state.cards[pending.sourceId];
        if (src) {
          (src.namedValues ??= {})[pending.storeAs] = choice.value;
        }

        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        return;
      }

      case "mayPay": {
        assert(pending.kind === "mayPay", "This choice does not match the pending decision.");

        this.state.pendingChoice = undefined;

        // Pay from the decider's resources ("that player may pay 2"), while
        // the chosen branch still resolves under the ability's controller.
        const mayPayCtx =
          pending.playerId === pending.context.controllerId
            ? pending.context
            : { ...pending.context, controllerId: pending.playerId };

        const branch =
          choice.pay && this.canPayCosts(pending.cost, mayPayCtx)
            ? (() => {
                this.payCosts(pending.cost, mayPayCtx);
                return pending.effects;
              })()
            : pending.elseEffects;

        this.state.pendingEffectFrames.push({
          effects: branch,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        return;
      }

      case "alternatingPay": {
        assert(pending.kind === "alternatingPay", "This choice does not match the pending decision.");
        this.advanceAlternatingPay(pending, choice.pay);
        return;
      }

      case "spendCountersMenu": {
        assert(
          pending.kind === "spendCountersMenu",
          "This choice does not match the pending decision."
        );

        // Stop the loop.
        if (choice.optionIndex === null || choice.optionIndex === undefined) {
          this.state.pendingChoice = undefined;
          this.resumeEffectFrames();
          return;
        }

        assert(
          Number.isInteger(choice.optionIndex) &&
            choice.optionIndex >= 0 &&
            choice.optionIndex < pending.options.length,
          "Invalid spend-counters option."
        );
        const option = pending.options[choice.optionIndex];
        const sources = choice.sources ?? [];
        assert(
          sources.length === option.cost,
          `That option costs ${option.cost} ${pending.counter}(s); name one card per marker.`
        );
        // Tally how many markers to pull from each named pool card and
        // validate against what's actually available.
        const pull: Record<CardInstanceId, number> = {};
        for (const id of sources) pull[id] = (pull[id] ?? 0) + 1;
        for (const [id, n] of Object.entries(pull)) {
          assert(
            (pending.available[id] ?? 0) >= n,
            `Not enough ${pending.counter} markers on '${id}'.`
          );
        }

        this.state.pendingChoice = undefined;
        for (const [id, n] of Object.entries(pull)) {
          this.resolveEffect(
            {
              type: "removeCounter",
              target: { type: "card", id },
              counter: pending.counter,
              amount: n
            },
            pending.context
          );
        }

        // Run the option's effects, then re-open the menu (LIFO: push the
        // re-opener first so the option's effects finish — and any pause
        // resumes — before it fires).
        this.state.pendingEffectFrames.push({
          effects: [
            {
              type: "spendCountersMenu",
              chooser: { type: "player", id: pending.playerId },
              pool: pending.pool,
              counter: pending.counter,
              options: pending.options
            }
          ],
          index: 0,
          context: pending.context
        });
        this.state.pendingEffectFrames.push({
          effects: option.effects,
          index: 0,
          context: pending.context
        });
        this.resumeEffectFrames();
        return;
      }

      case "anyPlayerMayPay": {
        assert(pending.kind === "anyPlayerMayPay", "This choice does not match the pending decision.");

        const payCtx = { ...pending.context, controllerId: pending.playerId };
        if (choice.pay && this.canPayCosts(pending.cost, payCtx)) {
          this.state.pendingChoice = undefined;
          this.payCosts(pending.cost, payCtx);
          this.state.pendingEffectFrames.push({
            effects: pending.effects,
            index: 0,
            context: payCtx
          });
          this.resumeEffectFrames();
          return;
        }

        // Declined — offer to the next player, or end.
        if (pending.remaining.length > 0) {
          this.state.pendingChoice = {
            ...pending,
            id: nextId("choice"),
            playerId: pending.remaining[0],
            remaining: pending.remaining.slice(1)
          };
          return;
        }
        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        return;
      }

      case "chooseNumber": {
        assert(pending.kind === "chooseNumber", "This choice does not match the pending decision.");
        assert(
          Number.isInteger(choice.value) &&
            choice.value >= pending.min &&
            choice.value <= pending.max,
          `Choose an integer in [${pending.min}, ${pending.max}].`
        );

        this.state.pendingChoice = undefined;
        this.state.pendingEffectFrames.push({
          effects: pending.effects,
          index: 0,
          context: {
            ...pending.context,
            variables: {
              ...pending.context.variables,
              [pending.storeAs]: choice.value
            }
          }
        });
        this.resumeEffectFrames();
        return;
      }

      case "useTargetAbility": {
        assert(pending.kind === "useTargetAbility", "This choice does not match the pending decision.");

        this.state.pendingChoice = undefined;

        if (choice.abilityId) {
          assert(
            pending.abilityIds.includes(choice.abilityId),
            "That ability is not one of the target card's abilities."
          );

          const ability = (
            this.getDefinition(pending.targetCardId).behavior?.abilities ?? []
          ).find(
            a => a.id === choice.abilityId && a.type === "activated"
          ) as ActivatedAbility | undefined;

          if (ability) {
            const ctx: ResolutionContext = {
              sourceId: pending.targetCardId,
              controllerId: playerId,
              abilityId: ability.id,
              selected: choice.selected ?? {},
              variables: choice.variables ?? {}
            };
            this.applyVariableRolls(ability.variables, ctx);
            this.validateTargetDeclarations(ability.targets ?? [], ctx);
            this.payCosts(ability.costs ?? [], ctx);
            for (let n = 0; n < Math.max(1, pending.times); n++) {
              for (const effect of ability.effects) this.resolveEffect(effect, ctx);
            }
          }
        }

        this.processImmediateQueue();
        this.checkStateBasedActions();
        this.resumeEffectFrames();
        return;
      }

      case "useAnyAbility": {
        assert(pending.kind === "useAnyAbility", "This choice does not match the pending decision.");

        this.state.pendingChoice = undefined;

        if (!choice.cardId) {
          this.resumeEffectFrames();
          return;
        }

        assert(
          pending.candidateCardIds.includes(choice.cardId),
          "That card is not one you may use an ability of."
        );

        const abilities = (
          this.getDefinition(choice.cardId).behavior?.abilities ?? []
        ).filter(a => a.type === "activated") as ActivatedAbility[];

        // Narrow to a follow-up "use one of THIS card's abilities" choice,
        // reusing the useTargetAbility resolution path.
        this.state.pendingChoice = {
          kind: "useTargetAbility",
          id: nextId("choice"),
          playerId: pending.playerId,
          targetCardId: choice.cardId,
          abilityIds: abilities.map(a => a.id),
          times: 1
        };
        return;
      }

      case "partitionCards": {
        assert(pending.kind === "partitionCards", "This choice does not match the pending decision.");
        const pp = this.state.pendingPartition;
        assert(pp && pp.phase === "partition", "No MUSTACHE SHOWDOWN is waiting for a partition.");

        assert(
          choice.piles.length === pending.piles,
          `Split into exactly ${pending.piles} piles.`
        );
        assert(
          choice.piles.every(pile => pile.length >= 1),
          "Every pile must contain at least 1 card."
        );
        const flat = choice.piles.flat();
        const expected = [...pending.cardIds].sort();
        assert(
          flat.length === pending.cardIds.length &&
            new Set(flat).size === flat.length &&
            [...flat].sort().every((cardId, i) => cardId === expected[i]),
          "The piles must partition exactly the revealed cards, each once."
        );

        pp.partitions[playerId] = choice.piles.map(pile => [...pile]);

        const nextToPartition = pp.order.find(p => !pp.partitions[p]);
        if (nextToPartition) {
          this.state.pendingChoice = {
            kind: "partitionCards",
            id: nextId("choice"),
            playerId: nextToPartition,
            cardIds: [...pp.revealed[nextToPartition]],
            piles: pending.piles
          };
          return;
        }

        pp.phase = "pick";
        const firstPicker = pp.order[0];
        this.state.pendingChoice = {
          kind: "pickPile",
          id: nextId("choice"),
          playerId: firstPicker,
          piles: pp.partitions[this.partitionOpponent(pp, firstPicker)].map(p => [...p])
        };
        return;
      }

      case "pickPile": {
        assert(pending.kind === "pickPile", "This choice does not match the pending decision.");
        const pp = this.state.pendingPartition;
        assert(pp && pp.phase === "pick", "No MUSTACHE SHOWDOWN is waiting for a pile pick.");
        assert(
          Number.isInteger(choice.index) &&
            choice.index >= 0 &&
            choice.index < pending.piles.length,
          "Invalid pile index."
        );

        pp.picks[playerId] = choice.index;

        const nextToPick = pp.order.find(p => pp.picks[p] === undefined);
        if (nextToPick) {
          this.state.pendingChoice = {
            kind: "pickPile",
            id: nextId("choice"),
            playerId: nextToPick,
            piles: pp.partitions[this.partitionOpponent(pp, nextToPick)].map(p => [...p])
          };
          return;
        }

        this.settleMustacheShowdown(pp);
        return;
      }

      case "takeFromPile": {
        assert(pending.kind === "takeFromPile", "This choice does not match the pending decision.");
        const pp = this.state.pendingPartition;
        assert(pp, "No MUSTACHE SHOWDOWN is waiting to finish.");
        assert(
          choice.cardIds.length <= pending.max &&
            new Set(choice.cardIds).size === choice.cardIds.length &&
            choice.cardIds.every(cardId => pending.candidates.includes(cardId)),
          `Take up to ${pending.max} card(s) from the winning pile.`
        );

        for (const cardId of choice.cardIds) {
          this.moveCard(cardId, "hand");
        }

        this.state.pendingChoice = undefined;
        this.state.pendingPartition = undefined;
        // "Shuffle the remaining cards into their owner's deck."
        for (const p of pp.order) {
          this.shuffleInPlace(this.requirePlayer(p).deck);
        }
        this.resumeEffectFrames();
        return;
      }

      case "reorderDeck": {
        assert(pending.kind === "reorderDeck", "This choice does not match the pending decision.");

        const original = new Set(pending.cardIds);
        const player = this.requirePlayer(pending.deckOwnerId ?? pending.playerId);

        if ((pending.to ?? "top") === "split") {
          const top = choice.order;
          const bottom = choice.bottom ?? [];
          const seen = new Set([...top, ...bottom]);
          assert(
            top.length + bottom.length === pending.cardIds.length &&
              seen.size === original.size &&
              [...original].every(cardId => seen.has(cardId)),
            "The top and bottom piles together must be exactly the looked-at cards, each once."
          );
          player.deck.splice(0, pending.cardIds.length);
          player.deck.unshift(...top);
          player.deck.push(...bottom);
          this.state.pendingChoice = undefined;
          this.resumeEffectFrames();
          return;
        }

        const reordered = new Set(choice.order);
        assert(
          choice.order.length === pending.cardIds.length &&
            reordered.size === original.size &&
            [...original].every(cardId => reordered.has(cardId)),
          "The new order must contain exactly the same cards, each once."
        );

        player.deck.splice(0, pending.cardIds.length);
        if ((pending.to ?? "top") === "bottom") {
          player.deck.push(...choice.order);
        } else {
          player.deck.unshift(...choice.order);
        }

        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        return;
      }

      case "deployForFree": {
        assert(pending.kind === "deployForFree", "This choice does not match the pending decision.");

        if (!choice.cardId) {
          this.state.pendingChoice = undefined;
          this.resumeEffectFrames();
          return;
        }

        assert(
          pending.candidates.includes(choice.cardId),
          "That card is not a legal free-deploy candidate."
        );

        // "Deploy any number of cards for free with total numeric cost X or
        // less." (Reality Shift) — deploy this pick, then re-prompt with the
        // pool reduced by its printed cost until it's spent / nothing fits /
        // the player declines.
        if (pending.budgetRemaining !== undefined) {
          const printedCost = this.getDefinition(choice.cardId).cost ?? 0;
          this.deployCard(
            pending.playerId,
            choice.cardId,
            choice.selected ?? {},
            choice.variables ?? {},
            !(pending.payCost ?? false),
            false,
            undefined,
            false
          );
          this.state.pendingChoice = undefined;
          const settled = this.resolveTopOfStack();
          // A chooser pause from the deployed card's own resolution takes
          // priority and ends the free-deploy loop; the ability that paused
          // on `deployForFree` resumes once that choice is answered.
          if (this.state.pendingChoice) return;

          const remaining = Math.max(0, pending.budgetRemaining - printedCost);
          const cap = Math.min(pending.perCardCap ?? remaining, remaining);
          const next = this.deployForFreeCandidates(
            pending.playerId,
            cap,
            pending.selector,
            pending.context
          );
          if (next.length > 0) {
            this.state.pendingChoice = {
              kind: "deployForFree",
              id: nextId("choice"),
              playerId: pending.playerId,
              candidates: next,
              payCost: pending.payCost,
              budgetRemaining: remaining,
              perCardCap: pending.perCardCap,
              selector: pending.selector,
              context: pending.context
            };
            return;
          }
          if (settled) this.resumeEffectFrames();
          return;
        }

        // Deliberately not clearing pendingChoice here: deployCardForFree
        // validates (throwing before any mutation, e.g. a missing
        // extra-cost target) before it commits — see deployCard. If it
        // throws, this same choice must still be answerable, so the player
        // can retry with a corrected answer instead of getting stuck.
        this.deployCardForFree(
          pending.playerId,
          choice.cardId,
          choice.selected ?? {},
          choice.variables ?? {},
          pending.fromZone ?? false,
          pending.ignoreThreshold ?? false,
          pending.payCost ?? false
        );
        return;
      }

      case "pileAssignment": {
        assert(pending.kind === "pileAssignment", "This choice does not match the pending decision.");

        const all = [...choice.pile1, ...choice.pile2];
        const original = new Set(pending.cardIds);
        assert(
          all.length === pending.cardIds.length &&
            new Set(all).size === all.length &&
            all.every(cardId => original.has(cardId)),
          "The two piles together must be exactly the revealed cards, each once."
        );

        this.state.pendingChoice = undefined;

        const runPile = (ids: CardInstanceId[], effects: Effect[]) => {
          this.beginEventBatch();
          try {
            for (const cardId of ids) {
              const nestedContext: ResolutionContext = {
                ...pending.context,
                selected: { ...pending.context.selected, __candidate: [cardId] }
              };
              for (const nested of effects) {
                this.resolveEffect(nested, nestedContext);
                this.checkStateBasedActions();
              }
            }
          } finally {
            this.endEventBatch();
          }
        };
        runPile(choice.pile1, pending.pile1Effects);
        runPile(choice.pile2, pending.pile2Effects);

        this.resumeEffectFrames();
        return;
      }

      case "distributeAmong": {
        assert(pending.kind === "distributeAmong", "This choice does not match the pending decision.");

        const entries = Object.entries(choice.shares).filter(([, share]) => share > 0);

        for (const [cardId, share] of entries) {
          assert(
            pending.targets.includes(cardId),
            `'${cardId}' is not one of the distribution targets.`
          );
          assert(
            Number.isInteger(share) && share > 0,
            `Share for '${cardId}' must be a positive integer.`
          );
        }

        const total = entries.reduce((sum, [, share]) => sum + share, 0);
        assert(
          total <= pending.amount,
          `Shares must add up to at most ${pending.amount}, got ${total}.`
        );

        this.state.pendingChoice = undefined;

        this.beginEventBatch();

        try {
          for (const [cardId, share] of entries) {
            const nestedContext: ResolutionContext = {
              ...pending.context,
              selected: { ...pending.context.selected, __candidate: [cardId] },
              variables: { ...pending.context.variables, __amount: share }
            };

            for (const nested of pending.effects) {
              this.resolveEffect(nested, nestedContext);
              this.checkStateBasedActions();
            }
          }
        } finally {
          this.endEventBatch();
        }

        this.resumeEffectFrames();
        return;
      }

      case "chooseChosenBlockers": {
        assert(
          pending.kind === "chooseChosenBlockers",
          "This choice does not match the pending decision."
        );
        assert(
          new Set(choice.cardIds).size === choice.cardIds.length &&
            choice.cardIds.every(id => pending.candidates.includes(id)),
          "Chosen blockers must be a subset of the candidates."
        );
        if (this.state.battle && this.state.battle.phase !== "finished") {
          this.state.battle.chosenBlockers = [...choice.cardIds];
        }
        this.state.pendingChoice = undefined;
        this.resumeEffectFrames();
        return;
      }

      case "coinFlipReplace": {
        assert(
          pending.kind === "coinFlipReplace",
          "This choice does not match the pending decision."
        );
        const cf = this.state.pendingCoinFlip;
        assert(cf, "No coin flip is waiting on a reflip decision.");

        this.state.pendingChoice = undefined;
        this.state.pendingCoinFlip = undefined;

        // The reflip cost / rider effects resolve with the replacement card
        // as `source` ("Shuffle THIS card into its owner's deck").
        const replContext: ResolutionContext = {
          sourceId: cf.replacementSourceId,
          controllerId: cf.flipperId,
          selected: {}
        };

        let won = false;
        let rider: Effect[] = [];
        if (choice.reflip && this.canPayCosts(cf.replacementCost, replContext)) {
          this.payCosts(cf.replacementCost, replContext);
          won = this.random() < 0.5;
          rider = cf.replacementEffects;
        }

        this.emit({ type: "coinFlipped", playerId: cf.flipperId, won });
        // LIFO: the coin-flip branch resolves, then the replacement's rider.
        if (rider.length > 0) {
          this.state.pendingEffectFrames.push({
            effects: rider,
            index: 0,
            context: replContext
          });
        }
        this.state.pendingEffectFrames.push({
          effects: won ? cf.winEffects : cf.loseEffects,
          index: 0,
          context: cf.context
        });
        this.resumeEffectFrames();
        return;
      }

      case "auctionBid": {
        assert(
          pending.kind === "auctionBid",
          "This choice does not match the pending decision."
        );
        this.advanceAuction(playerId, choice.bid);
        return;
      }
    }
  }

  /**
   * The optional "if you would lose a coin flip, you may <cost> to reflip"
   * replacement (Two-Headed Coin) available to `flipperId` — an in-play,
   * face-up card they control with a `replaces: { event: "coinFlip",
   * result: "lose" }` replacement ability whose `condition` holds and whose
   * `optionalCost` is affordable. `undefined` if none.
   */
  private findCoinFlipLossReplacement(
    flipperId: PlayerId,
    context: ResolutionContext
  ): { sourceId: CardInstanceId; cost: Cost[]; effects: Effect[] } | undefined {
    for (const source of Object.values(this.state.cards)) {
      if (
        source.zone !== "play" ||
        source.faceDown ||
        source.controllerId !== flipperId
      ) {
        continue;
      }
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "replacement") continue;
        if (ability.replaces.event !== "coinFlip") continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: flipperId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        const cost = ability.optionalCost ?? [];
        if (cost.length && !this.canPayCosts(cost, ctx)) continue;
        return {
          sourceId: source.id,
          cost,
          effects: ability.effects
        };
      }
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Zones / destruction
  // ---------------------------------------------------------------------------

  private moveCard(
    cardId: CardInstanceId,
    to: Zone,
    emitEvents = true,
    position: "top" | "bottom" = "bottom",
    skipReplacement = false
  ): void {
    const card = this.requireCard(cardId);
    const from = card.zone;

    if (from === to) {
      // Every zone but the deck is an unordered set, so a same-zone move is
      // a no-op. The deck is ordered: "put the top card of your deck on the
      // bottom" (Cheats McGuillicutty, Bottlebeard, Flimflam Man, …) is a
      // real reposition within `owner.deck`.
      if (to === "deck") {
        const deck = this.state.players[card.ownerId]?.deck;
        const at = deck?.indexOf(cardId) ?? -1;
        if (deck && at !== -1) {
          deck.splice(at, 1);
          if (position === "top") deck.unshift(cardId);
          else deck.push(cardId);
        }
      }
      return;
    }

    // "cards cannot be put into your opponents' hands from the void, discard
    // pile or play" (Lockbox of the Aeons) — the move simply fizzles.
    if (to === "hand" && this.returnToHandRestricted(cardId, from)) {
      return;
    }

    // "This turn, if a card would be put into a player's hand, put it into
    // their discard pile instead." (Quotidian Misfire) — a `redirectHandMoves`
    // window. Applies to a card entering a hand from ANY zone.
    if (to === "hand" && !skipReplacement) {
      const redirect = this.handMoveRedirectFor(cardId);
      if (redirect && redirect !== "hand") {
        this.moveCard(cardId, redirect, emitEvents, position, true);
        return;
      }
    }

    // "If a character would be put into a player's hand, destroy it instead."
    if (
      !skipReplacement &&
      from === "play" &&
      this.applyReplacement(cardId, { event: "moveToZone", zone: to })
    ) {
      return;
    }

    // "If the picked character would leave play, THIS character leaves play
    // in that way instead." (6r4wny 60dy9u4rd5).
    if (from === "play" && to !== "play") {
      const redirected = this.redirectTargetFor(cardId);
      if (redirected) {
        this.moveCard(redirected, to, emitEvents, position, skipReplacement);
        return;
      }
    }

    // A borrowed card (Barracks of Precipitancy) is removed from the game
    // the moment it would otherwise leave play.
    if (
      card.borrowedUntilEndOfTurn &&
      from === "play" &&
      to !== "play" &&
      to !== "removed"
    ) {
      to = "removed";
    }

    // A token permanent leaving play ceases to exist outright.
    if (card.isToken && from === "play" && to !== "play") {
      this.removeFromAllPlayerZones(cardId);
      for (const other of Object.values(this.state.cards)) {
        if (other.attachedTo === cardId) other.attachedTo = undefined;
      }
      delete this.state.cards[cardId];
      if (emitEvents) {
        this.emit({ type: "cardMoved", cardId, from, to });
      }
      return;
    }

    this.removeFromAllPlayerZones(cardId);

    card.zone = to;

    if (to !== "play") {
      card.faceDown = false;
      // Depletion and damage are play-zone concepts (a "tapped" or damaged
      // card in hand/deck/discard is meaningless) — leaving play clears
      // both, the same way a location's turn-spanning damage still resets
      // once it's no longer in play at all.
      card.depleted = false;
      card.damage = 0;
      card.restoreLocked = undefined;
      this.lethalDamageCause.delete(cardId);
      // Snapshot the card's own links before clearing them, so a "when this
      // card leaves play" trigger (which may resolve later, behind an event
      // batch) can still read `"attachedTo"` / `{ remembered }` via the
      // `departedLinks` fallback in `resolveTargetRef`.
      if (from === "play" && (card.attachedTo || card.linkedTargets)) {
        this.departedLinks.set(cardId, {
          attachedTo: card.attachedTo,
          linkedTargets: card.linkedTargets
            ? { ...card.linkedTargets }
            : undefined
        });
      }
      card.attachedTo = undefined;
      card.linkedTargets = undefined;

      // Snapshot-copied abilities (Skin Suit) and a pending durationed
      // take-control reversion / block restriction die with the card.
      this.state.abilityGrants = this.state.abilityGrants.filter(
        g => g.cardId !== cardId
      );
      this.state.controlGrants = this.state.controlGrants.filter(
        g => g.cardId !== cardId
      );
      this.state.blockRestrictionGrants = this.state.blockRestrictionGrants.filter(
        g => g.targetId !== cardId && g.sourceId !== cardId
      );
      this.state.partyRestrictionGrants = this.state.partyRestrictionGrants.filter(
        g => g.targetId !== cardId
      );
      this.state.subtypeGrants = this.state.subtypeGrants.filter(
        g => g.targetId !== cardId
      );
      // `runtimeReplacements` (installReplacement) are NOT pruned here — a
      // tactic installs one and then goes to the discard; they expire only
      // by their own `duration` (untilEndOfTurn / endOfBattle).
    }

    // If a target leaves play, its attachments become unattached. This is
    // sufficient for faction/resource bookkeeping; card-specific attachment
    // departure effects can be layered on later.
    if (from === "play" && to !== "play") {
      for (const other of Object.values(this.state.cards)) {
        if (other.attachedTo === cardId) other.attachedTo = undefined;
      }
    }

    const owner = this.requirePlayer(card.ownerId);
    const controller = this.requirePlayer(
      card.controllerId
    );

    const zoneOwner =
      to === "deck" ||
      to === "hand" ||
      to === "discard" ||
      to === "void" ||
      to === "removed"
        ? owner
        : controller;

    const array = this.getZoneArray(zoneOwner, to);

    if (array) {
      // Deck index 0 is the top (see `drawCards`); everything else only has
      // one meaningful end, so `position` is deck-only.
      if (to === "deck" && position === "top") {
        array.unshift(cardId);
      } else {
        array.push(cardId);
      }
    }

    if (emitEvents) {
      this.emit({
        type: "cardMoved",
        cardId,
        from,
        to
      });

      // "When a player discards ... cards" (Bewilderbeast) — a hand→discard
      // move is a discard. Emitted once per card (a multi-card discard =
      // several events); a "+X for each discarded" trigger sums correctly.
      if (from === "hand" && to === "discard") {
        this.emit({ type: "cardsDiscarded", playerId: card.ownerId, count: 1 });
      }
    }

    // A "deploy this from the void" grant (Cheats) dies once the card
    // actually leaves the void (deployed, milled elsewhere, ...).
    if (from === "void" && this.state.voidPlayGrants.length) {
      this.state.voidPlayGrants = this.state.voidPlayGrants.filter(
        g => g.cardId !== cardId
      );
    }
  }

  /**
   * "If <X> would happen to `cardId`, instead <Y>." Scans every in-play
   * card for a matching mandatory `ReplacementAbility`; if one applies, runs
   * its effects (with `cardId` bound to `{ selected: "__candidate" }`) and
   * returns true so the caller skips the original mutation. Recursion-
   * guarded via `this.replacing`.
   */
  private applyReplacement(
    cardId: CardInstanceId,
    trigger:
      | { event: "moveToZone"; zone: Zone }
      | { event: "destroy" }
  ): boolean {
    if (this.replacing.has(cardId)) return false;

    const affected = this.state.cards[cardId];
    if (!affected) return false;
    const affectedType = this.getDefinition(cardId).type;

    // Runtime replacements installed by an `installReplacement` effect
    // (Sarcophyle Matriculation — "if the character would be destroyed
    // during this battle, take control of it instead").
    for (const rr of this.state.runtimeReplacements) {
      if (rr.replaces.event !== trigger.event) continue;
      if (
        rr.replaces.event === "moveToZone" &&
        rr.replaces.zone !== (trigger as { zone: Zone }).zone
      ) {
        continue;
      }
      if (rr.replaces.cardType && rr.replaces.cardType !== affectedType) continue;

      const context: ResolutionContext = {
        sourceId: rr.sourceId,
        controllerId: rr.controllerId,
        selected: { ...rr.selected, __candidate: [cardId] }
      };
      if (rr.condition && !this.evaluateCondition(rr.condition, context)) continue;

      this.replacing.add(cardId);
      try {
        for (const effect of rr.effects) this.resolveEffect(effect, context);
      } finally {
        this.replacing.delete(cardId);
      }
      if (trigger.event === "destroy") {
        const saved = this.state.cards[cardId];
        if (saved) saved.damage = 0;
      }
      return true;
    }

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;

      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "replacement") continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const r = ability.replaces;
        if (r.event !== trigger.event) continue;
        if (r.event === "moveToZone" && r.zone !== (trigger as { zone: Zone }).zone) {
          continue;
        }
        if (r.cardType && r.cardType !== affectedType) continue;

        const rel = r.controlledBy ?? "any";
        if (rel !== "any") {
          const sameController = affected.controllerId === source.controllerId;
          if (rel === "self" && !sameController) continue;
          if (rel === "opponent" && sameController) continue;
        }

        // `by` scopes to *who initiated* the event ("destroyed by an
        // opposing card or effect"). An unknown initiator (`currentCause`
        // undefined — e.g. a bare state-based check) satisfies neither
        // "self" nor "opponent".
        const by = r.by ?? "any";
        if (by !== "any") {
          const causedBySelf = this.currentCause === source.controllerId;
          if (by === "self" && !causedBySelf) continue;
          if (by === "opponent" && (causedBySelf || this.currentCause === undefined)) {
            continue;
          }
        }

        const context: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: { __candidate: [cardId] }
        };

        if (
          ability.condition &&
          !this.evaluateCondition(ability.condition, context)
        ) {
          continue;
        }

        // Optional replacement ("you may pay/choose ... instead"): pause for
        // the chooser (the source's controller by default, or a `PlayerRef`
        // resolved relative to the affected card's controller — Phantasmagoric
        // Tollbooth / Unloyal Necromorph). `state.pendingReplacement` carries
        // what to do on accept (pay + effects) or decline (the original event).
        if (ability.optional) {
          const cost = ability.optionalCost ?? [];
          const chooserId = ability.chooser
            ? this.resolvePlayerRef(ability.chooser, {
                ...context,
                controllerId:
                  this.state.cards[cardId]?.controllerId ?? source.controllerId
              }).id
            : source.controllerId;
          const chooserContext: ResolutionContext = {
            ...context,
            controllerId: chooserId
          };
          if (cost.length && !this.canPayCosts(cost, chooserContext)) {
            return false;
          }
          this.state.pendingChoice = {
            kind: "replacementChoice",
            id: nextId("choice"),
            playerId: chooserId,
            sourceId: source.id,
            abilityId: ability.id,
            affectedCardId: cardId,
            original:
              trigger.event === "destroy"
                ? { event: "destroy" }
                : { event: "moveToZone", zone: (trigger as { zone: Zone }).zone },
            cost: structuredClone(cost),
            label: ability.name
          };
          this.state.pendingReplacement = {
            affectedCardId: cardId,
            sourceId: source.id,
            abilityId: ability.id,
            original:
              trigger.event === "destroy"
                ? { event: "destroy" }
                : { event: "moveToZone", zone: (trigger as { zone: Zone }).zone },
            cost: structuredClone(cost),
            effects: structuredClone(ability.effects)
          };
          return true;
        }

        this.replacing.add(cardId);
        try {
          for (const effect of ability.effects) {
            this.resolveEffect(effect, context);
          }
        } finally {
          this.replacing.delete(cardId);
        }

        // CR §506.6 / §408.4b / §408.5c: replacing a card's destruction
        // reduces to 0 the damage it took from that destruction's source,
        // so a replaced-lethal card doesn't immediately re-die on the next
        // state-based check.
        if (trigger.event === "destroy") {
          const saved = this.state.cards[cardId];
          if (saved) saved.damage = 0;
        }

        return true;
      }
    }

    return false;
  }

  private destroyCard(
    cardId: CardInstanceId,
    emitEvents = true,
    skipReplacement = false,
    byBattleDamage = false
  ): void {
    const card = this.requireCard(cardId);

    if (card.zone !== "play") {
      throw new Error(
        `Cannot destroy '${cardId}' from zone '${card.zone}'.`
      );
    }

    // "If the picked character would leave play, THIS character leaves play
    // in that way instead." (6r4wny 60dy9u4rd5) — the destroy lands on the
    // redirect target, and the originally-doomed card is spared.
    const redirected = this.redirectTargetFor(cardId);
    if (redirected) {
      this.destroyCard(redirected, emitEvents, skipReplacement, byBattleDamage);
      return;
    }

    // "If this card would be destroyed, ... instead." Checked before the
    // discard move so the replacement effects run in its place.
    if (!skipReplacement && this.applyReplacement(cardId, { event: "destroy" })) {
      return;
    }

    const previousController =
      card.controllerId;

    this.moveCard(cardId, "discard", emitEvents);

    if (emitEvents) {
      this.emit({
        type: "cardDestroyed",
        cardId,
        controllerId: previousController,
        byBattleDamage: byBattleDamage || undefined
      });
    }
  }

  /**
   * "Flip <cardId> face-down under its owner's control" (RULES.md §2, CR
   * §411.3 / §411.4). The card stays in the In-Play area but becomes an
   * anonymous face-down resource: this is a leaves-play / enters-play
   * boundary, so accumulated damage, counters, attachments, temporary
   * modifiers / keyword grants / restrictions and named values are all
   * wiped, and control reverts to the owner. "Leaves play" triggers key
   * off the emitted `cardMoved` with `from: "play"`.
   */
  private flipCardFaceDown(cardId: CardInstanceId): void {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play" || card.faceDown) return;

    // Detach anything attached to this card; drop its own attachment.
    for (const other of Object.values(this.state.cards)) {
      if (other.attachedTo === cardId) other.attachedTo = undefined;
    }

    this.state.modifiers = this.state.modifiers.filter(m => m.targetId !== cardId);
    this.state.keywordGrants = this.state.keywordGrants.filter(g => g.targetId !== cardId);
    this.state.keywordSuppressions = this.state.keywordSuppressions.filter(g => g.targetId !== cardId);
    this.state.abilitySuppressions = this.state.abilitySuppressions.filter(g => g.targetId !== cardId);
    this.state.restrictions = this.state.restrictions.filter(g => g.targetId !== cardId);
    this.state.provideGrants = this.state.provideGrants.filter(g => g.targetId !== cardId);

    card.counters = {};
    card.namedValues = undefined;
    card.linkedTargets = undefined;
    card.damage = 0;
    card.depleted = false;
    card.restoreLocked = undefined;
    card.attackEligibleTurn = undefined;
    card.attachedTo = undefined;
    this.lethalDamageCause.delete(cardId);

    // Move it into the owner's play area (it may have been under opposing
    // control) and flip it.
    this.removeFromAllPlayerZones(cardId);
    card.controllerId = card.ownerId;
    card.faceDown = true;
    card.zone = "play";
    this.requirePlayer(card.ownerId).play.push(cardId);

    this.emit({ type: "cardMoved", cardId, from: "play", to: "play" });
  }

  /**
   * Move `cardId` from a non-play zone (deck / discard / void) INTO play
   * under `controllerId`. `faceDown` puts it in as an anonymous face-down
   * resource; otherwise it enters as its real type with the normal
   * entrance bookkeeping (attach-target from `context`, attack
   * eligibility, `cardEnteredPlay`).
   */
  private putCardIntoPlay(
    cardId: CardInstanceId,
    controllerId: PlayerId,
    faceDown: boolean,
    context: ResolutionContext,
    borrowed = false
  ): void {
    const card = this.state.cards[cardId];
    if (!card || card.zone === "play") return;

    const definition = this.getDefinition(cardId);
    const from = card.zone;

    this.removeFromAllPlayerZones(cardId);
    card.zone = "play";
    card.controllerId = controllerId;
    card.faceDown = faceDown;
    card.attachedTo = undefined;
    card.depleted = false;
    card.damage = 0;
    card.counters = {};
    card.attackEligibleTurn = undefined;
    // "If that card would leave play or is in play at the end of the turn,
    // remove it from the game instead." (Barracks of Precipitancy).
    if (borrowed) card.borrowedUntilEndOfTurn = true;
    this.requirePlayer(controllerId).play.push(cardId);

    this.emit({ type: "cardMoved", cardId, from, to: "play" });

    if (faceDown) return;

    if (definition.attachTo) {
      card.attachedTo = context.selected[ATTACH_TARGET_ID]?.[0];
    }

    this.emit({
      type: "cardEnteredPlay",
      cardId,
      playerId: controllerId
    });

    for (const effect of definition.behavior?.onPlay?.effects ?? []) {
      this.resolveEffect(effect, {
        ...context,
        sourceId: cardId,
        controllerId
      });
    }
  }

  /**
   * Where a resolved tactic goes once its effects finish — the discard
   * pile unless its `selfDisposition` (and any gate on it) says otherwise.
   */
  private applyTacticDisposition(
    cardId: CardInstanceId,
    context: ResolutionContext
  ): void {
    const card = this.requireCard(cardId);
    const definition = this.getDefinition(cardId);
    const disp = definition.selfDisposition;

    // "ATTACH TO CHARACTER (put this card into play attached to that
    // character instead of into its owner's discard pile)" — a tactic whose
    // `attachTo` is set enters play attached to the host it picked at play
    // time (the reserved `attachTo` extra-cost target). Its triggered /
    // continuous abilities are then live while it sits in play.
    if (definition.attachTo && !disp) {
      const hostId = context.selected[ATTACH_TARGET_ID]?.[0];
      const host = hostId ? this.state.cards[hostId] : undefined;
      if (host && host.zone === "play") {
        const from = card.zone;
        this.removeFromAllPlayerZones(cardId);
        card.controllerId = host.controllerId;
        card.faceDown = false;
        card.attachedTo = hostId;
        card.zone = "play";
        this.requirePlayer(card.controllerId).play.push(cardId);
        this.emit({ type: "cardMoved", cardId, from, to: "play" });
        this.emit({ type: "cardEnteredPlay", cardId, playerId: card.controllerId });
        return;
      }
      // No legal host survived — falls through to the discard pile.
      this.moveCard(cardId, "discard");
      return;
    }

    if (
      disp &&
      (!disp.condition || this.evaluateCondition(disp.condition, context))
    ) {
      if (disp.to === "hand") {
        this.moveCard(cardId, "hand");
        return;
      }

      // faceDownResource — enter play as an anonymous face-down resource
      // under the owner.
      const from = card.zone;
      this.removeFromAllPlayerZones(cardId);
      card.controllerId = card.ownerId;
      card.faceDown = true;
      card.attachedTo = undefined;
      card.zone = "play";
      this.requirePlayer(card.ownerId).play.push(cardId);
      this.emit({ type: "cardMoved", cardId, from, to: "play" });
      return;
    }

    this.moveCard(cardId, "discard");
  }

  private removeFromAllPlayerZones(
    cardId: CardInstanceId
  ): void {
    for (const player of Object.values(
      this.state.players
    )) {
      player.deck = player.deck.filter(
        id => id !== cardId
      );
      player.hand = player.hand.filter(
        id => id !== cardId
      );
      player.play = player.play.filter(
        id => id !== cardId
      );
      player.discard = player.discard.filter(
        id => id !== cardId
      );
      player.void = player.void.filter(
        id => id !== cardId
      );
      player.removed = player.removed.filter(
        id => id !== cardId
      );
    }
  }

  private getZoneArray(
    player: PlayerState,
    zone: Zone
  ): CardInstanceId[] | undefined {
    switch (zone) {
      case "deck":
        return player.deck;
      case "hand":
        return player.hand;
      case "play":
        return player.play;
      case "discard":
        return player.discard;
      case "void":
        return player.void;
      case "removed":
        return player.removed;
      case "deploying":
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Turn handling
  // ---------------------------------------------------------------------------

  /**
   * "End turn" is an announcement. The opponent gets a normal response window
   * before the turn actually changes.
   */
  private endTurn(playerId: PlayerId): void {
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player can end the turn."
    );
    assert(!this.state.battle, "Cannot end the turn during a battle.");
    assert(!this.state.responseWindow, "A response window is already open.");
    assert(
      this.responseStack.length === 0,
      "Cannot end turn with unresolved responses."
    );

    this.emit({
      type: "turnEnding",
      playerId
    });

    // "At the end of the turn, ..." delayed effects resolve as part of the
    // turn ending, before the opponent's end-of-turn response window.
    this.fireScheduledEffects("endOfTurn");

    // Borrowed cards (Barracks of Precipitancy) that survived to end of
    // turn are removed from the game.
    for (const card of Object.values(this.state.cards)) {
      if (card.borrowedUntilEndOfTurn && card.zone === "play") {
        this.moveCard(card.id, "removed");
      }
    }
    this.checkStateBasedActions();

    this.openResponseWindow(
      "endTurn",
      this.getOpponent(playerId).id,
      {
        type: "endTurn",
        playerId
      },
      // CR §607.1 — only the opponent responds to "I end my turn".
      [this.getOpponent(playerId).id]
    );
  }

  /** Shared "should this durationed entry survive end-of-turn cleanup" check for modifiers and keyword grants. */
  private durationStillActive(entry: {
    duration: Duration;
    createdTurn: number;
    sourceId?: CardInstanceId;
  }): boolean {
    if (
      entry.duration.type === "untilEndOfTurn" &&
      entry.createdTurn <= this.state.turn
    ) {
      return false;
    }

    // "until the start of your next turn" — survives the opponent's
    // intervening turn (one start-of-turn point), swept at the next.
    if (
      entry.duration.type === "untilStartOfNextTurn" &&
      entry.createdTurn <= this.state.turn - 2
    ) {
      return false;
    }

    if (entry.duration.type === "whileSourceInPlay") {
      return (
        !!entry.sourceId &&
        this.state.cards[entry.sourceId]?.zone === "play"
      );
    }

    return true;
  }

  /**
   * Fires any `scheduleEffect`-registered delayed effects due at `when`:
   * an `endOfTurn` entry scheduled *this* turn, or a `startOfNextTurn`
   * entry whose controller is `forActivePlayer` and which was scheduled on
   * an earlier turn. Each fires once (self-resolving — no chooser pauses),
   * then is discarded.
   */
  private fireScheduledEffects(
    when: "startOfNextTurn" | "startOfOpponentNextTurn" | "endOfTurn" | "endOfBattle",
    forActivePlayer?: PlayerId
  ): void {
    const due = this.state.scheduledEffects.filter(s => {
      if (s.when !== when) return false;
      if (when === "endOfBattle") return true;
      if (when === "endOfTurn") return s.turnScheduled === this.state.turn;
      if (when === "startOfOpponentNextTurn") {
        // The turn immediately after it was scheduled, which (turns strictly
        // alternate) belongs to the scheduler's opponent = `forActivePlayer`.
        return (
          s.controllerId !== forActivePlayer &&
          this.state.turn === s.turnScheduled + 1
        );
      }
      return s.controllerId === forActivePlayer && this.state.turn > s.turnScheduled;
    });

    if (due.length === 0) return;

    const dueIds = new Set(due.map(s => s.id));
    this.state.scheduledEffects = this.state.scheduledEffects.filter(
      s => !dueIds.has(s.id)
    );

    for (const s of due) {
      const ctx: ResolutionContext = {
        sourceId: s.sourceId,
        controllerId: s.controllerId,
        selected: {}
      };
      if (s.condition && !this.evaluateCondition(s.condition, ctx)) continue;

      // Route through the suspendable effect-frame path so a chooser effect
      // inside a scheduled rider (Final Countdown — pick which staples to
      // detach / which characters to buff and restore) pauses correctly
      // instead of resolving the rest of the list out from under it.
      this.runEffectFrame({ effects: s.effects, index: 0, context: ctx });
      this.checkStateBasedActions();
    }
  }

  private finishTurn(playerId: PlayerId): void {
    assert(
      playerId === this.state.activePlayerId,
      "Turn owner changed before end-turn resolution."
    );

    const next = this.getOpponent(playerId);

    this.state.turn++;
    this.state.activePlayerId = next.id;
    this.state.priorityPlayerId = next.id;
    this.state.developsUsedThisTurn = 0;
    this.state.turnEventTally = {};
    this.state.turnDeploys = {};
    this.state.lastDeployedTacticId = undefined;
    this.state.damageThisTurn = {};
    this.state.abilityUsesThisTurn = {};
    this.state.attacksThisTurn = {};
    this.state.attackDeclarationsThisTurn = {};

    // The start-of-turn point (CR §602): clears character damage, ends all
    // "this turn" effects, resets attack eligibility, runs the Restore Rule.
    this.applyFactionStartOfTurn(next.id);

    this.emit({
      type: "turnStarted",
      playerId: next.id
    });

    // "At the start of your next turn, ..." delayed effects, after the
    // start-of-turn point and the turnStarted trigger wave.
    this.fireScheduledEffects("startOfNextTurn", next.id);
    // "At the start of your opponent's next turn, ..." (Final Countdown) —
    // fires now, on the turn right after it was scheduled.
    this.fireScheduledEffects("startOfOpponentNextTurn", next.id);
  }

  // ---------------------------------------------------------------------------
  // Battle system
  // ---------------------------------------------------------------------------

  getBattleView(): BattleView | undefined {
    const battle = this.state.battle;

    if (!battle) {
      return undefined;
    }

    let actingPlayerId: PlayerId | undefined;

    if (
      this.state.responseWindow &&
      this.isBattleResponseWindow(this.state.responseWindow) &&
      this.state.responseWindow.phase === "acceptingResponses"
    ) {
      actingPlayerId = this.state.responseWindow.priorityPlayerId;
    } else if (battle.phase === "blocking") {
      actingPlayerId = battle.defenderPlayerId;
    } else if (battle.phase === "attackerDamageAssignment") {
      actingPlayerId = battle.attackerPlayerId;
    } else if (battle.phase === "defenderDamageAssignment") {
      actingPlayerId = battle.defenderPlayerId;
    }

    const attackerAssigning =
      battle.phase === "attackerDamageAssignment";

    const defenderAssigning =
      battle.phase === "defenderDamageAssignment";

    const sourceParty = attackerAssigning
      ? battle.attackingParty
      : defenderAssigning
        ? battle.blockingParty
        : [];

    const damageSources = sourceParty
      .filter(cardId => this.canAssignBattleDamage(cardId, battle))
      .filter(cardId =>
        battle.speed === undefined
          ? false
          : this.getStat(cardId, "speed") === battle.speed
      )
      .map(cardId => ({
        cardId,
        // A character assigns damage equal to its strength, floored at 0
        // (CR §410.4 — a value pushed below 0 stays at 0).
        strength: Math.max(0, this.getStat(cardId, "strength")),
        legalTargets: this.getLegalBattleDamageTargets(
          cardId,
          attackerAssigning,
          battle
        )
      }));

    return {
      battleId: battle.id,
      phase: battle.phase,
      speed: battle.speed,
      attackerPlayerId: battle.attackerPlayerId,
      defenderPlayerId: battle.defenderPlayerId,
      attackingParty: [...battle.attackingParty],
      blockingParty: [...battle.blockingParty],
      actingPlayerId,
      damageSources,
      lockedAssignments: [
        ...battle.attackerAssignments,
        ...battle.defenderAssignments
      ].map(assignment => structuredClone(assignment))
    };
  }

  private declareAttack(
    playerId: PlayerId,
    attackerIds: CardInstanceId[],
    target: BattleState["target"]
  ): void {
    assert(!this.state.battle, "Battle already in progress.");
    assert(!this.state.responseWindow, "Cannot attack during a response window.");
    assert(this.responseStack.length === 0, "Responses are unresolved.");
    assert(
      playerId === this.state.activePlayerId,
      "Only the active player may attack."
    );
    assert(attackerIds.length > 0, "No attackers selected.");
    assert(
      new Set(attackerIds).size === attackerIds.length,
      "An attacker was selected more than once."
    );

    let defenderId: PlayerId;

    if (target.type === "faction") {
      defenderId = target.playerId;
      assert(
        defenderId !== playerId,
        "You cannot attack your own faction."
      );
    } else {
      const targetCard = this.requireCard(target.cardId);
      assert(targetCard.zone === "play", "Attack target must be in play.");
      assert(
        this.getDefinition(target.cardId).type === "location",
        "Battles may target an opposing faction or location."
      );
      assert(
        targetCard.controllerId !== playerId,
        "You cannot attack your own location."
      );
      defenderId = targetCard.controllerId;
    }

    const battleId = nextId("battle");

    // "must attack if it can": any eligible, un-depleted controlled
    // character with `mustAttack` and at least one legal target has to be
    // among the declared attackers. Checked BEFORE anything is depleted so a
    // rejected declaration leaves the board untouched. (A turn with no
    // declared attack at all is not policed here.)
    const attackerSet = new Set(attackerIds);
    for (const cardId of this.requirePlayer(playerId).play) {
      if (attackerSet.has(cardId)) continue;
      const c = this.state.cards[cardId];
      if (!c || c.zone !== "play" || c.faceDown || c.depleted) continue;
      if (!this.hasCardType(cardId, "character")) continue;
      if (!this.hasRestriction(cardId, "mustAttack")) continue;
      if (this.hasRestriction(cardId, "cannotAttack")) continue;
      const eligible =
        c.attackEligibleTurn === this.state.turn ||
        this.hasKeyword(cardId, "aggro");
      if (!eligible) continue;
      throw new Error(
        `'${this.getDefinition(cardId).name}' must attack if it can and was left out.`
      );
    }

    this.assertPartyComposition(attackerIds, "attacking");

    // "Your opponents cannot attack your faction." (High Court of Demands,
    // Theocratic Senate of Marduun) — an in-play
    // `ContinuousAbility.preventsAttackOnFaction`.
    if (target.type === "faction") {
      this.forEachActiveContinuous((source, ability) => {
        const rule = ability.preventsAttackOnFaction;
        if (!rule) return;
        if (
          this.scopeMatchesPlayer(rule.player, source.controllerId, defenderId)
        ) {
          throw new Error("That faction cannot be attacked.");
        }
      });
    }

    // "Players can attack only once each turn." (Narrow Passage) — an in-play
    // `ContinuousAbility.attackLimitPerTurn`. The tightest limit wins.
    let attackLimit = Infinity;
    this.forEachActiveContinuous((_source, ability, context) => {
      if (ability.attackLimitPerTurn === undefined) return;
      attackLimit = Math.min(
        attackLimit,
        Math.max(0, this.evaluateNumber(ability.attackLimitPerTurn, context))
      );
    });
    assert(
      (this.state.attackDeclarationsThisTurn[playerId] ?? 0) < attackLimit,
      "You have already attacked the maximum number of times this turn."
    );

    // "Each opponent must pay N to attack." (The Ministry of Other Smaller
    // Ministries) — an in-play `ContinuousAbility.attackTax`. Charged before
    // anything is depleted; unaffordable => the attack is illegal.
    let attackTax = 0;
    this.forEachActiveContinuous((source, ability, context) => {
      const rule = ability.attackTax;
      if (!rule) return;
      if (rule.player === "activePlayer") {
        // charged to whoever is declaring the attack, regardless of source
      } else if (
        !this.scopeMatchesPlayer(rule.player, source.controllerId, playerId)
      ) {
        return;
      }
      if (rule.requiresAttackerMatch) {
        const matches = attackerIds.some(id => {
          const card = this.state.cards[id];
          return (
            !!card &&
            this.matchesSelector(
              card,
              { ...rule.requiresAttackerMatch!, zone: "any" },
              context
            )
          );
        });
        if (!matches) return;
      }
      attackTax += Math.max(0, this.evaluateNumber(rule.amount, context));
    });
    if (attackTax > 0) {
      assert(
        this.getAvailableResourceIds(playerId).length >= attackTax,
        `You must pay ${attackTax} to attack.`
      );
      this.payNumericCost(playerId, attackTax);
    }

    this.state.attackDeclarationsThisTurn[playerId] =
      (this.state.attackDeclarationsThisTurn[playerId] ?? 0) + 1;

    this.beginEventBatch();

    try {
      for (const attackerId of attackerIds) {
        const attacker = this.requireCard(attackerId);
        const definition = this.getDefinition(attackerId);

        assert(attacker.controllerId === playerId, "You do not control an attacker.");
        assert(attacker.zone === "play", "Attacker must be in play.");
        assert(this.hasCardType(attackerId, "character"), "Only characters can attack.");
        assert(!attacker.depleted, "Depleted characters cannot attack.");
        assert(
          !this.hasRestriction(attackerId, "cannotAttack"),
          "Character cannot attack."
        );
        assert(
          attacker.attackEligibleTurn === this.state.turn ||
            this.hasKeyword(attackerId, "aggro"),
          "Character did not start the turn in play under your control and does not have AGGRO."
        );
        assert(
          !this.hasRestriction(attackerId, "attackOncePerTurn") ||
            (this.state.attacksThisTurn[attackerId] ?? 0) < 1,
          "This character can attack only once each turn."
        );

        attacker.depleted = true;
        this.state.attacksThisTurn[attackerId] =
          (this.state.attacksThisTurn[attackerId] ?? 0) + 1;

        this.emit({
          type: "cardDepleted",
          cardId: attackerId
        });
      }
    } finally {
      this.endEventBatch();
    }

    const battle: BattleState = {
      id: battleId,
      attackerPlayerId: playerId,
      defenderPlayerId: defenderId,
      target,
      attackingParty: [...attackerIds],
      blockingParty: [],
      phase: "afterAttackersResponse",
      assignedDamageBy: [],
      attackerAssignments: [],
      defenderAssignments: []
    };

    this.state.battle = battle;

    this.beginEventBatch();

    try {
      for (const attackerId of attackerIds) {
        this.emit({
          type: "characterAttacked",
          cardId: attackerId,
          battleId
        });
      }
    } finally {
      this.endEventBatch();
    }

    this.emit({
      type: "battleStarted",
      battleId: battle.id
    });

    // CR §608.1c: the attacking player may use tactics/abilities as many
    // times as they want, then the defending player may do the same.
    this.openResponseWindow(
      "battleAfterAttackers",
      battle.attackerPlayerId,
      {
        type: "battleBlocking",
        battleId: battle.id
      },
      [battle.attackerPlayerId, battle.defenderPlayerId]
    );
  }

  /**
   * "Attack that player." (Counter Attack) — start a battle from inside an
   * effect, bypassing normal turn/eligibility timing. The `attackerIds`
   * (already vetted as controlled, in-play, un-depleted characters) deplete
   * and form the attacking party against `defenderId`'s faction; the
   * resolving response window this was reached through is discarded and the
   * standard battle flow takes over. The caller (`runEffectFrame`) parks the
   * rest of the effect list as an `endOfBattle` rider.
   */
  private runInitiatedAttack(
    attackerIds: CardInstanceId[],
    defenderId: PlayerId
  ): void {
    if (this.state.battle) return;

    const battleId = nextId("battle");

    this.beginEventBatch();
    try {
      for (const attackerId of attackerIds) {
        const attacker = this.requireCard(attackerId);
        if (!attacker.depleted) {
          attacker.depleted = true;
          this.state.attacksThisTurn[attackerId] =
            (this.state.attacksThisTurn[attackerId] ?? 0) + 1;
          this.emit({ type: "cardDepleted", cardId: attackerId });
        }
      }
    } finally {
      this.endEventBatch();
    }

    const battle: BattleState = {
      id: battleId,
      attackerPlayerId: this.state.cards[attackerIds[0]].controllerId,
      defenderPlayerId: defenderId,
      target: { type: "faction", playerId: defenderId },
      attackingParty: [...attackerIds],
      blockingParty: [],
      phase: "afterAttackersResponse",
      assignedDamageBy: [],
      attackerAssignments: [],
      defenderAssignments: []
    };

    this.state.battle = battle;

    // The action/response window this effect resolved inside is superseded
    // by the battle flow — its continuation was "resume normal play", which
    // is exactly where the battle leaves off.
    this.state.responseWindow = undefined;

    this.beginEventBatch();
    try {
      for (const attackerId of attackerIds) {
        this.emit({ type: "characterAttacked", cardId: attackerId, battleId });
      }
    } finally {
      this.endEventBatch();
    }

    this.emit({ type: "battleStarted", battleId });

    this.openResponseWindow(
      "battleAfterAttackers",
      battle.attackerPlayerId,
      { type: "battleBlocking", battleId },
      [battle.attackerPlayerId, battle.defenderPlayerId]
    );
  }

  /**
   * Auction House — reveal from the top of `deckOwnerId`'s deck until a
   * character (or the deck runs out). No character => reshuffle and done.
   * Otherwise pull the revealed cards aside and open the bidding
   * (`auctionBid` pending choice, active player first).
   */
  private beginAuction(
    context: ResolutionContext,
    deckOwnerId: PlayerId
  ): void {
    if (this.state.pendingAuction) return;
    const deck = this.requirePlayer(deckOwnerId).deck;

    const revealed: CardInstanceId[] = [];
    let characterId: CardInstanceId | undefined;
    while (deck.length > 0) {
      const top = deck[0];
      revealed.push(top);
      deck.shift();
      const c = this.state.cards[top];
      if (c) c.zone = "deploying"; // held aside while the auction runs
      if (this.getDefinition(top).type === "character") {
        characterId = top;
        break;
      }
    }

    if (!characterId) {
      // "Shuffle all other revealed cards into their owner's deck."
      for (const id of revealed) {
        const c = this.state.cards[id];
        if (c) c.zone = "deck";
        deck.push(id);
      }
      this.shuffleInPlace(deck);
      return;
    }

    const otherRevealed = revealed.filter(id => id !== characterId);
    const order = [
      this.state.activePlayerId,
      this.getOpponent(this.state.activePlayerId).id
    ];

    this.state.pendingAuction = {
      sourceId: context.sourceId,
      controllerId: context.controllerId,
      deckOwnerId,
      characterId,
      otherRevealed,
      order,
      turn: order[0],
      highBid: 0,
      passed: []
    };

    this.state.pendingChoice = {
      kind: "auctionBid",
      id: nextId("choice"),
      playerId: order[0],
      characterId,
      highBid: 0,
      maxBid: this.getAvailableResourceCount(order[0])
    };
  }

  /** One bid / pass in the Auction House sequence (`auctionBid` pending choice). */
  private advanceAuction(playerId: PlayerId, bid: number): void {
    const a = this.state.pendingAuction;
    assert(a, "No auction is in progress.");
    assert(playerId === a.turn, "It is not your turn to bid.");
    assert(Number.isInteger(bid) && bid >= 0, "A bid must be a non-negative integer.");

    const other = a.order.find(p => p !== playerId)!;

    if (bid > 0) {
      assert(bid > a.highBid, `A bid must exceed the current high bid (${a.highBid}).`);
      assert(
        bid <= this.getAvailableResourceCount(playerId),
        "You cannot bid more than the detached resources you control."
      );
      a.highBid = bid;
      a.highBidder = playerId;
      a.passed = [];
      a.turn = other;
      this.state.pendingChoice = {
        kind: "auctionBid",
        id: nextId("choice"),
        playerId: other,
        characterId: a.characterId,
        highBid: a.highBid,
        maxBid: this.getAvailableResourceCount(other)
      };
      return;
    }

    // A pass. The auction ends unless the other player still has a live
    // raise to make — they haven't passed yet and aren't already the high
    // bidder (a pass against a standing high bid concedes it).
    a.passed.push(playerId);
    const otherCanStillAct =
      a.highBidder !== other && !a.passed.includes(other);

    if (otherCanStillAct) {
      a.turn = other;
      this.state.pendingChoice = {
        kind: "auctionBid",
        id: nextId("choice"),
        playerId: other,
        characterId: a.characterId,
        highBid: a.highBid,
        maxBid: this.getAvailableResourceCount(other)
      };
      return;
    }

    this.settleAuction();
  }

  private settleAuction(): void {
    const a = this.state.pendingAuction;
    if (!a) return;
    this.state.pendingChoice = undefined;
    this.state.pendingAuction = undefined;

    const deck = this.requirePlayer(a.deckOwnerId).deck;
    const context: ResolutionContext = {
      sourceId: a.sourceId,
      controllerId: a.controllerId,
      selected: {}
    };

    if (a.highBidder && a.highBid > 0) {
      this.payNumericCost(a.highBidder, a.highBid);
      this.putCardIntoPlay(a.characterId, a.highBidder, false, context, false);
    } else {
      const c = this.state.cards[a.characterId];
      if (c) c.zone = "deck";
      deck.push(a.characterId);
    }

    for (const id of a.otherRevealed) {
      const c = this.state.cards[id];
      if (c) c.zone = "deck";
      deck.push(id);
    }
    this.shuffleInPlace(deck);

    this.checkStateBasedActions();
    this.resumeEffectFrames();
  }

  private declareBlockers(
    playerId: PlayerId,
    blockerIds: CardInstanceId[]
  ): void {
    const battle = this.requireBattle();

    assert(!this.state.responseWindow, "Responses must finish before blockers are declared.");
    assert(
      battle.defenderPlayerId === playerId,
      "Only the defending player can block."
    );
    assert(
      battle.phase === "blocking",
      "Battle is not accepting blockers."
    );

    const unique = new Set(blockerIds);
    assert(
      unique.size === blockerIds.length,
      "A blocker was selected more than once."
    );

    for (const blockerId of blockerIds) {
      const blocker = this.requireCard(blockerId);

      assert(blocker.controllerId === playerId, "You do not control that blocker.");
      assert(blocker.zone === "play", "Blocker must be in play.");
      assert(!blocker.faceDown, "A face-down resource cannot block.");
      assert(this.hasCardType(blockerId, "character"), "Only characters can block.");
      assert(!blocker.depleted, "Depleted characters cannot block.");
      assert(
        !this.hasRestriction(blockerId, "cannotBlock"),
        "Character cannot block."
      );
    }

    this.assertCovertBlockingLegality(
      battle.attackingParty,
      blockerIds
    );

    // CR §412.1 — while every member of the attacking party "cannot be
    // blocked", the defending player may not form a blocking party.
    // (Effects that *add* a character into the blocking party still work,
    // but that's not a defender-declared block.)
    const attackingPartyUnblockable =
      battle.attackingParty.length > 0 &&
      battle.attackingParty.every(cardId =>
        this.hasKeyword(cardId, "cannotBeBlocked")
      );
    assert(
      !attackingPartyUnblockable || blockerIds.length === 0,
      "The attacking party cannot be blocked."
    );

    // "must block if it can": a non-depleted controlled character with
    // `mustBlock` that could legally join this block has to be declared.
    const attackerIsCovert = battle.attackingParty.every(cardId =>
      this.hasKeyword(cardId, "covert")
    );
    for (const cardId of this.requirePlayer(playerId).play) {
      if (attackingPartyUnblockable) break;
      if (unique.has(cardId)) continue;
      const c = this.state.cards[cardId];
      if (!c || c.zone !== "play" || c.faceDown || c.depleted) continue;
      if (!this.hasCardType(cardId, "character")) continue;
      if (!this.hasRestriction(cardId, "mustBlock")) continue;
      if (this.hasRestriction(cardId, "cannotBlock")) continue;
      // Can't legally block a Covert party without Covert (or "can block
      // COVERT parties") itself.
      if (
        attackerIsCovert &&
        !this.hasKeyword(cardId, "covert") &&
        !this.hasKeyword(cardId, "canBlockCovert") &&
        !this.hasKeyword(cardId, "canBlockAnyParty")
      ) {
        continue;
      }
      throw new Error(
        `'${this.getDefinition(cardId).name}' must block if it can and was left out.`
      );
    }

    this.assertPartyComposition(blockerIds, "blocking");
    this.assertBlockRestrictions(battle, blockerIds);

    battle.blockingParty = [...blockerIds];

    this.beginEventBatch();

    try {
      // "When you form a blocking party with at least 1 character ..." — one
      // event for the whole party, mapped to the defending player
      // (Microdefense Autosystem). Emitted before the per-blocker events.
      if (blockerIds.length > 0) {
        this.emit({
          type: "blockingPartyFormed",
          playerId: battle.defenderPlayerId,
          blockerCount: blockerIds.length
        });
      }
      for (const blockerId of blockerIds) {
        this.emit({
          type: "characterBlocked",
          cardId: blockerId,
          battleId: battle.id
        });
      }
      // "When this card is blocked ..." — once per still-in-battle attacker,
      // when a non-empty blocking party is declared (Timid Mau).
      if (blockerIds.length > 0) {
        for (const attackerId of battle.attackingParty) {
          this.emit({
            type: "attackerBlocked",
            cardId: attackerId,
            battleId: battle.id,
            blockerCount: blockerIds.length
          });
        }
      }
    } finally {
      this.endEventBatch();
    }

    this.prepareNextSpeedGroupOrFinish(battle);
  }

  private prepareNextSpeedGroupOrFinish(
    battle: BattleState
  ): void {
    this.pruneBattleParties(battle);

    const nextSpeed = this.getNextBattleSpeed(battle);

    if (nextSpeed === undefined) {
      this.finishBattle(battle);
      return;
    }

    battle.speed = nextSpeed;
    battle.attackerAssignments = [];
    battle.defenderAssignments = [];
    battle.phase = "beforeDamageResponse";

    // CR §609.1a: attacker gets first opportunity, then the defender.
    this.openResponseWindow(
      "battleBeforeDamage",
      battle.attackerPlayerId,
      {
        type: "battleAssignDamage",
        battleId: battle.id
      },
      [battle.attackerPlayerId, battle.defenderPlayerId]
    );
  }

  private enterDamageAssignment(
    battle: BattleState
  ): void {
    this.pruneBattleParties(battle);

    if (this.getBattleDamageSources(true, battle).length > 0) {
      battle.phase = "attackerDamageAssignment";
      this.state.priorityPlayerId = battle.attackerPlayerId;
      return;
    }

    if (this.getBattleDamageSources(false, battle).length > 0) {
      battle.phase = "defenderDamageAssignment";
      this.state.priorityPlayerId = battle.defenderPlayerId;
      return;
    }

    this.openPostAssignmentResponse(battle);
  }

  private assignBattleDamage(
    playerId: PlayerId,
    assignments: BattleDamageAssignment[]
  ): void {
    assert(
      !this.state.responseWindow,
      "Cannot assign battle damage while a response window is open."
    );

    const battle = this.requireBattle();

    const attackerAssigning =
      battle.phase === "attackerDamageAssignment";

    const defenderAssigning =
      battle.phase === "defenderDamageAssignment";

    assert(
      attackerAssigning || defenderAssigning,
      "Battle is not accepting damage assignments."
    );

    const expectedPlayerId = attackerAssigning
      ? battle.attackerPlayerId
      : battle.defenderPlayerId;

    assert(
      playerId === expectedPlayerId,
      "It is not this player's damage assignment."
    );

    const sources = this.getBattleDamageSources(
      attackerAssigning,
      battle
    );

    for (const sourceId of sources) {
      const sourceAssignments = assignments.filter(
        assignment => assignment.sourceId === sourceId
      );

      const legalTargets = this.getLegalBattleDamageTargets(
        sourceId,
        attackerAssigning,
        battle
      );

      if (legalTargets.length === 0) {
        assert(
          sourceAssignments.length === 0,
          `Source '${sourceId}' has no legal damage target.`
        );
        continue;
      }

      // Strength is floored at 0 for assignment (CR §410.4): a character
      // with 0 or negative strength assigns nothing but still counts as
      // having assigned (CR §408.1b / §609.2).
      const strength = Math.max(0, this.getStat(sourceId, "strength"));
      const total = sourceAssignments.reduce(
        (sum, assignment) => sum + assignment.amount,
        0
      );

      assert(
        total === strength,
        `Source '${sourceId}' must assign exactly ${strength} damage; received ${total}.`
      );

      for (const assignment of sourceAssignments) {
        assert(
          Number.isInteger(assignment.amount) &&
          assignment.amount > 0,
          "Damage assignments must be positive integers."
        );

        assert(
          legalTargets.some(target =>
            this.sameBattleTarget(target, assignment.target)
          ),
          `Illegal battle-damage target for '${sourceId}'.`
        );
      }
    }

    for (const assignment of assignments) {
      assert(
        sources.includes(assignment.sourceId),
        `Source '${assignment.sourceId}' is not part of the current speed group.`
      );
    }

    battle.assignedDamageBy.push(...sources);

    if (attackerAssigning) {
      battle.attackerAssignments = structuredClone(assignments);

      if (this.getBattleDamageSources(false, battle).length > 0) {
        battle.phase = "defenderDamageAssignment";
        this.state.priorityPlayerId = battle.defenderPlayerId;
      } else {
        this.openPostAssignmentResponse(battle);
      }
    } else {
      battle.defenderAssignments = structuredClone(assignments);
      this.openPostAssignmentResponse(battle);
    }
  }

  private openPostAssignmentResponse(
    battle: BattleState
  ): void {
    battle.phase = "afterDamageResponse";

    // Damage is now locked. Tactics/abilities can still change the game, but
    // the assignments themselves are immutable and survive source removal.
    this.openResponseWindow(
      "battleAfterDamage",
      battle.attackerPlayerId,
      {
        type: "battleInflictDamage",
        battleId: battle.id
      },
      [battle.attackerPlayerId, battle.defenderPlayerId]
    );
  }

  private getBattleDamageSources(
    attackerSide: boolean,
    battle: BattleState
  ): CardInstanceId[] {
    if (battle.speed === undefined) {
      return [];
    }

    const party = attackerSide
      ? battle.attackingParty
      : battle.blockingParty;

    return party.filter(
      cardId =>
        this.canAssignBattleDamage(cardId, battle) &&
        this.getStat(cardId, "speed") === battle.speed
    );
  }

  private canAssignBattleDamage(
    cardId: CardInstanceId,
    battle: BattleState
  ): boolean {
    const card = this.state.cards[cardId];

    return (
      !!card &&
      card.zone === "play" &&
      !battle.assignedDamageBy.includes(cardId)
    );
  }

  /**
   * "All battle damage that could be assigned to this card must be assigned
   * to it." (Courageous Paladin) — true while `cardId` has a live
   * `ContinuousAbility.mustReceiveBattleDamage` and is in a battle.
   */
  private cardMustReceiveBattleDamage(cardId: CardInstanceId): boolean {
    const card = this.state.cards[cardId];
    if (!card || card.zone !== "play") return false;
    for (const ability of this.getEffectiveContinuousAbilities(cardId)) {
      if (!ability.mustReceiveBattleDamage) continue;
      if (this.abilitySuppressed(cardId, ability.id)) continue;
      const context: ResolutionContext = {
        sourceId: cardId,
        controllerId: card.controllerId,
        abilityId: ability.id,
        selected: {}
      };
      if (ability.condition && !this.evaluateCondition(ability.condition, context)) {
        continue;
      }
      return true;
    }
    return false;
  }

  private getLegalBattleDamageTargets(
    sourceId: CardInstanceId,
    attackerSide: boolean,
    battle: BattleState
  ): Array<
    | { type: "card"; cardId: CardInstanceId }
    | { type: "faction"; playerId: PlayerId }
  > {
    if (!attackerSide) {
      const attackers = battle.attackingParty.filter(cardId =>
        this.isCardStillInBattle(cardId, battle)
      );
      // "All battle damage that could be assigned to this card must be
      // assigned to it." (Courageous Paladin) — a damage magnet in the party
      // narrows the legal set to just the magnets.
      const magnets = attackers.filter(id => this.cardMustReceiveBattleDamage(id));
      return (magnets.length > 0 ? magnets : attackers).map(cardId => ({
        type: "card" as const,
        cardId
      }));
    }

    const blockers = battle.blockingParty.filter(cardId =>
      this.isCardStillInBattle(cardId, battle)
    );

    if (blockers.length > 0) {
      const magnets = blockers.filter(id => this.cardMustReceiveBattleDamage(id));
      const blockerTargets = (magnets.length > 0 ? magnets : blockers).map(
        cardId => ({
          type: "card" as const,
          cardId
        })
      );

      // "May assign its battle damage to the target of the attack instead
      // of the blocking party" — an extra option alongside the blockers,
      // not a forced redirect. Suppressed while a magnet is in the party
      // (the damage "could be assigned" to it, so it "must be").
      if (magnets.length === 0 && this.hasKeyword(sourceId, "redirectDamage")) {
        return [...blockerTargets, ...this.getAttackTargetAsBattleDamageTarget(battle)];
      }

      return blockerTargets;
    }

    return this.getAttackTargetAsBattleDamageTarget(battle);
  }

  /** The attack's original target (faction or location), if it's still a legal damage target — [] if a targeted location has already left play. */
  private getAttackTargetAsBattleDamageTarget(
    battle: BattleState
  ): Array<
    | { type: "card"; cardId: CardInstanceId }
    | { type: "faction"; playerId: PlayerId }
  > {
    if (battle.target.type === "faction") {
      return [
        {
          type: "faction",
          playerId: battle.target.playerId
        }
      ];
    }

    const target = this.state.cards[battle.target.cardId];

    if (!target || target.zone !== "play") {
      return [];
    }

    return [
      {
        type: "card",
        cardId: battle.target.cardId
      }
    ];
  }

  private getNextBattleSpeed(
    battle: BattleState
  ): number | undefined {
    const candidates = [
      ...battle.attackingParty,
      ...battle.blockingParty
    ].filter(cardId => this.canAssignBattleDamage(cardId, battle));

    if (!candidates.length) {
      return undefined;
    }

    return Math.max(
      ...candidates.map(cardId => this.getStat(cardId, "speed"))
    );
  }

  /**
   * Rewrite locked battle-damage assignments per any active
   * `transformBattleDamage` entries (Don't Trip / Ocular Dispersal / Vexing
   * Nullifier) — before they're grouped and inflicted. Bounced cards are
   * moved to hand here; their assignments are zeroed so nothing else lands.
   */
  private applyBattleDamageTransforms(
    assignments: BattleDamageAssignment[]
  ): void {
    if (this.state.battleDamageTransforms.length === 0) return;

    // Entries sit in the list (like keyword grants) until the start-of-turn
    // sweep; only `whileSourceInPlay` needs a live source check here.
    const active = this.state.battleDamageTransforms.filter(
      t =>
        this.state.cards[t.cardId]?.zone === "play" &&
        (t.duration.type !== "whileSourceInPlay" ||
          (!!t.sourceId && this.state.cards[t.sourceId]?.zone === "play"))
    );
    if (active.length === 0) return;

    const toBounce = new Set<CardInstanceId>();

    for (const a of assignments) {
      for (const t of active) {
        if (t.role === "dealer" && t.cardId === a.sourceId) {
          if (t.kind === "setAmount" && t.amount !== undefined) {
            a.amount = t.amount;
          } else if (t.kind === "redirectToSelf") {
            a.target = { type: "card", cardId: a.sourceId };
          } else if (t.kind === "bounceOther" && a.target.type === "card") {
            toBounce.add(a.target.cardId);
            a.amount = 0;
          }
        }
        if (
          t.role === "receiver" &&
          a.target.type === "card" &&
          t.cardId === a.target.cardId &&
          t.kind === "bounceSelf" &&
          this.hasCardType(a.sourceId, "character")
        ) {
          toBounce.add(a.target.cardId);
          a.amount = 0;
        }
      }
    }

    for (const cardId of toBounce) {
      if (this.state.cards[cardId]?.zone === "play") {
        this.moveCard(cardId, "hand");
      }
    }
  }

  private inflictLockedBattleDamage(
    battle: BattleState
  ): void {
    const assignments = [
      ...battle.attackerAssignments,
      ...battle.defenderAssignments
    ];

    this.applyBattleDamageTransforms(assignments);

    // CR §609.1f: damage from several characters to the same thing this
    // round is inflicted as a *single amount*. CR §408.2: damage increase
    // and reduction effects apply to that amount. So group by target, sum
    // the raw assignments, then apply any `damageModifiers` delta once to
    // the sum (floored at 0) — not per assignment.
    const groups = new Map<
      string,
      {
        target: BattleDamageAssignment["target"];
        /** The in-play card the modifier lookup / damage / triggers hang off — the faction card itself for a faction target (CR §408.3). */
        cardId: CardInstanceId | undefined;
        contributors: BattleDamageAssignment[];
      }
    >();

    for (const assignment of assignments) {
      const key =
        assignment.target.type === "faction"
          ? `faction:${assignment.target.playerId}`
          : `card:${assignment.target.cardId}`;

      const cardId =
        assignment.target.type === "faction"
          ? this.requirePlayer(assignment.target.playerId).factionId
          : assignment.target.cardId;

      const group = groups.get(key) ?? {
        target: assignment.target,
        cardId,
        contributors: []
      };
      group.contributors.push(assignment);
      groups.set(key, group);
    }

    this.beginEventBatch();

    try {
      // Apply every final amount before any triggered ability resolves.
      for (const group of groups.values()) {
        // Locking protects the source assignments, not a target that has
        // already left play before damage is inflicted.
        const targetCard = group.cardId
          ? this.state.cards[group.cardId]
          : undefined;
        if (!targetCard || targetCard.zone !== "play") {
          group.contributors = [];
          continue;
        }

        const rawSum = group.contributors.reduce(
          (sum, a) => sum + a.amount,
          0
        );

        // CR §408.2 modification applies to combat damage against a faction
        // too, before it converts to influence loss (CR §408.3).
        let final = Math.max(
          0,
          rawSum + this.damageDeltaFor(group.cardId!, true, undefined, rawSum)
        );

        // `preventDamage` shields (Tiny Shiny / Delectable Boon) — only a
        // card target can carry one; a faction can't.
        let battleRedirects: Array<{ cardId: CardInstanceId; amount: number }> = [];
        if (group.target.type !== "faction") {
          const absorbed = this.absorbDamage(group.cardId!, final);
          final = absorbed.toTarget;
          battleRedirects = absorbed.redirects;
        }

        // Redistribute the adjusted final amount back across the
        // contributing sources so each still emits its own `damageDealt`
        // (CR §408.7 — every assigning character is a source), while the
        // total inflicted stays the single summed amount. Any leftover from
        // an increase, or shortfall from a reduction, lands on the last
        // contributor.
        let remaining = final;
        group.contributors.forEach((contributor, i) => {
          const isLast = i === group.contributors.length - 1;
          const share = isLast
            ? Math.max(0, remaining)
            : Math.min(contributor.amount, remaining);
          contributor.amount = share;
          remaining -= share;
        });

        if (group.target.type === "faction") {
          // A faction takes no damage markers; it loses influence equal to
          // the final adjusted amount (CR §408.3 / §202.4).
          this.applyInfluenceDelta(group.target.playerId, -final);
        } else {
          targetCard.damage += final;

          if (final > 0) {
            const cause = group.contributors.find(c => c.amount > 0)
              ?? group.contributors[0];
            const source = cause && this.state.cards[cause.sourceId];
            if (source) {
              this.lethalDamageCause.set(
                group.cardId!,
                source.controllerId
              );
            }
          }

          for (const r of battleRedirects) {
            const rc = this.state.cards[r.cardId];
            if (!rc || rc.zone !== "play") continue;
            rc.damage += r.amount;
            const cause = group.contributors[0];
            this.emit({
              type: "damageDealt",
              sourceId: cause?.sourceId,
              targetId: r.cardId,
              amount: r.amount
            });
          }
        }
      }

      // A faction hit fires "when this card deals/takes damage" triggers
      // (sourceIsDamageSource / sourceIsEventCard) against the faction card,
      // exactly like character/location damage.
      for (const group of groups.values()) {
        if (!group.cardId) continue;
        const targetCard = this.state.cards[group.cardId];
        if (!targetCard || targetCard.zone !== "play") continue;

        for (const contributor of group.contributors) {
          if (contributor.amount <= 0) continue;
          this.emit({
            type: "damageDealt",
            sourceId: contributor.sourceId,
            targetId: group.cardId,
            amount: contributor.amount
          });
        }
      }

      // Lethal characters leave play only after the entire speed group's
      // damage has been applied.
      this.checkStateBasedActions();
    } finally {
      this.endEventBatch();
    }

    this.pruneBattleParties(battle);
    battle.speed = undefined;
    battle.attackerAssignments = [];
    battle.defenderAssignments = [];
  }

  private pruneBattleParties(
    battle: BattleState
  ): void {
    battle.attackingParty = battle.attackingParty.filter(
      cardId => this.isCardStillInBattle(cardId, battle)
    );

    battle.blockingParty = battle.blockingParty.filter(
      cardId => this.isCardStillInBattle(cardId, battle)
    );
  }

  private isCardStillInBattle(
    cardId: CardInstanceId,
    battle: BattleState
  ): boolean {
    const card = this.state.cards[cardId];

    if (!card || card.zone !== "play") {
      return false;
    }

    if (battle.attackingParty.includes(cardId)) {
      return card.controllerId === battle.attackerPlayerId;
    }

    if (battle.blockingParty.includes(cardId)) {
      return card.controllerId === battle.defenderPlayerId;
    }

    return false;
  }

  private sameBattleTarget(
    a:
      | { type: "card"; cardId: CardInstanceId }
      | { type: "faction"; playerId: PlayerId },
    b:
      | { type: "card"; cardId: CardInstanceId }
      | { type: "faction"; playerId: PlayerId }
  ): boolean {
    if (a.type !== b.type) {
      return false;
    }

    if (a.type === "card" && b.type === "card") {
      return a.cardId === b.cardId;
    }

    return (
      a.type === "faction" &&
      b.type === "faction" &&
      a.playerId === b.playerId
    );
  }

  private assertCovertBlockingLegality(
    attackerIds: CardInstanceId[],
    blockerIds: CardInstanceId[]
  ): void {
    if (blockerIds.length === 0) {
      return;
    }

    // A blocker with `canBlockAnyParty` (Guardbeast) never triggers the
    // "a COVERT character can only block a COVERT party" restriction.
    const blockersContainCovert = blockerIds.some(
      cardId =>
        this.hasKeyword(cardId, "covert") &&
        !this.hasKeyword(cardId, "canBlockAnyParty")
    );

    const attackingPartyIsCovert = attackerIds.every(cardId =>
      this.hasKeyword(cardId, "covert")
    );

    // "Can block COVERT parties" (canBlockCovert / canBlockAnyParty) counts
    // as Covert for the purpose of forming a legal blocking party against a
    // Covert attack.
    const blockingPartyCanBlockCovert = blockerIds.every(
      cardId =>
        this.hasKeyword(cardId, "covert") ||
        this.hasKeyword(cardId, "canBlockCovert") ||
        this.hasKeyword(cardId, "canBlockAnyParty")
    );

    if (attackingPartyIsCovert) {
      assert(
        blockingPartyCanBlockCovert,
        "A COVERT attacking party can only be blocked by a COVERT party."
      );
    }

    if (blockersContainCovert) {
      assert(
        attackingPartyIsCovert,
        "A COVERT character can only block a COVERT party."
      );
    }
  }

  /**
   * "When an attacking / blocking party is formed including this card, it
   * must have <constraint>." (Insect Appreciator, Anxious Oaf) — reject a
   * forming party that includes a member whose `ContinuousAbility.partyRestriction`
   * (condition holding) it violates.
   */
  private assertPartyComposition(
    partyIds: CardInstanceId[],
    role: "attacking" | "blocking"
  ): void {
    if (partyIds.length === 0) return;
    const size = partyIds.length;
    const memberSet = new Set(partyIds);

    const check = (
      pr: NonNullable<
        Extract<AbilityDefinition, { type: "continuous" }>["partyRestriction"]
      >,
      ctx: ResolutionContext,
      name: string
    ): void => {
      if (pr.role !== "any" && pr.role !== role) return;
      if (pr.minMembers !== undefined) {
        const min = this.evaluateNumber(pr.minMembers, ctx);
        assert(
          size >= min,
          `A ${role} party with '${name}' must have at least ${min} member(s).`
        );
      }
      if (pr.maxMembers !== undefined) {
        const max = this.evaluateNumber(pr.maxMembers, ctx);
        assert(
          size <= max,
          `A ${role} party with '${name}' must have at most ${max} member(s).`
        );
      }
      if (pr.parity === "even") {
        assert(
          size % 2 === 0,
          `A ${role} party with '${name}' must have an even number of members.`
        );
      }
      if (pr.parity === "odd") {
        assert(
          size % 2 === 1,
          `A ${role} party with '${name}' must have an odd number of members.`
        );
      }
    };

    for (const source of Object.values(this.state.cards)) {
      if (source.zone !== "play" || source.faceDown) continue;
      for (const ability of this.getDefinition(source.id).behavior?.abilities ??
        []) {
        if (ability.type !== "continuous" || !ability.partyRestriction) continue;
        if (this.abilitySuppressed(source.id, ability.id)) continue;
        const pr = ability.partyRestriction;
        const scope = pr.scope ?? "selfParty";
        // "selfParty" restrictions only bite a party the source is in;
        // "attachedParty" only bites a party the source's host is in.
        if (scope === "selfParty" && !memberSet.has(source.id)) continue;
        if (scope === "attachedParty") {
          const host = source.attachedTo;
          if (!host || !memberSet.has(host)) continue;
        }

        const ctx: ResolutionContext = {
          sourceId: source.id,
          controllerId: source.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx))
          continue;

        check(pr, ctx, this.getDefinition(source.id).name);
      }
    }

    // "This turn, a party including <target> must ..." — `restrictParty`
    // effect grants (Carnival King).
    for (const grant of this.state.partyRestrictionGrants) {
      if (!memberSet.has(grant.targetId)) continue;
      const ctx: ResolutionContext = {
        sourceId: grant.sourceId,
        controllerId: this.state.cards[grant.sourceId]?.controllerId ?? "",
        selected: {}
      };
      check(
        {
          role: grant.role,
          minMembers: grant.minMembers,
          maxMembers: grant.maxMembers,
          parity: grant.parity
        },
        ctx,
        this.getDefinition(grant.targetId).name
      );
    }
  }

  /**
   * Enforce `ContinuousAbility.blockRestriction` / the `restrictBlockers`
   * ("this turn") effect / a `restrictBlockersToChosen` pick (`battle.chosenBlockers`)
   * against a declared blocking party. LeoKaiser, Wild Boars, Wyrmfang
   * Deathskull.
   */
  private assertBlockRestrictions(
    battle: BattleState,
    blockerIds: CardInstanceId[]
  ): void {
    // "Only those characters can block, and each must block if it can."
    if (battle.chosenBlockers) {
      const allowed = new Set(battle.chosenBlockers);
      for (const id of blockerIds) {
        assert(
          allowed.has(id),
          "Only the characters chosen by the attacker's ability may block this battle."
        );
      }
      const attackerIsCovert = battle.attackingParty.every(id =>
        this.hasKeyword(id, "covert")
      );
      const declared = new Set(blockerIds);
      for (const id of battle.chosenBlockers) {
        if (declared.has(id)) continue;
        const c = this.state.cards[id];
        if (!c || c.zone !== "play" || c.faceDown || c.depleted) continue;
        if (!this.hasCardType(id, "character")) continue;
        if (this.hasRestriction(id, "cannotBlock")) continue;
        if (
          attackerIsCovert &&
          !this.hasKeyword(id, "covert") &&
          !this.hasKeyword(id, "canBlockCovert") &&
          !this.hasKeyword(id, "canBlockAnyParty")
        ) {
          continue;
        }
        throw new Error(
          `'${this.getDefinition(id).name}' was chosen to block this battle and must.`
        );
      }
    }

    if (blockerIds.length === 0) return;

    const checks: Array<{
      minPartySize?: NumberExpression;
      minSpeed?: NumberExpression;
      blockerMustNotMatch?: CardSelector;
      ctx: ResolutionContext;
    }> = [];

    for (const attackerId of battle.attackingParty) {
      const card = this.state.cards[attackerId];
      if (!card) continue;
      for (const ability of this.getDefinition(attackerId).behavior?.abilities ?? []) {
        if (ability.type !== "continuous" || !ability.blockRestriction) continue;
        if (this.abilitySuppressed(attackerId, ability.id)) continue;
        const ctx: ResolutionContext = {
          sourceId: attackerId,
          controllerId: card.controllerId,
          abilityId: ability.id,
          selected: {}
        };
        if (ability.condition && !this.evaluateCondition(ability.condition, ctx)) {
          continue;
        }
        checks.push({
          minPartySize: ability.blockRestriction.minBlockingPartySize,
          minSpeed: ability.blockRestriction.minBlockerSpeed,
          blockerMustNotMatch: ability.blockRestriction.blockerMustNotMatch,
          ctx
        });
      }
    }

    for (const grant of this.state.blockRestrictionGrants) {
      if (!battle.attackingParty.includes(grant.targetId)) continue;
      const ctx: ResolutionContext = {
        sourceId: grant.sourceId,
        controllerId:
          this.state.cards[grant.sourceId]?.controllerId ?? battle.attackerPlayerId,
        selected: {}
      };
      if (grant.condition && !this.evaluateCondition(grant.condition, ctx)) continue;
      checks.push({
        minPartySize: grant.minPartySize,
        minSpeed: grant.minSpeed,
        ctx
      });
    }

    for (const check of checks) {
      if (check.minPartySize !== undefined) {
        const min = this.evaluateNumber(check.minPartySize, check.ctx);
        assert(
          blockerIds.length >= min,
          `Only a blocking party of at least ${min} may block this battle.`
        );
      }
      if (check.minSpeed !== undefined) {
        const min = this.evaluateNumber(check.minSpeed, check.ctx);
        for (const id of blockerIds) {
          assert(
            this.getStat(id, "speed") >= min,
            `Only characters with speed ${min} or more may block this battle.`
          );
        }
      }
      if (check.blockerMustNotMatch) {
        for (const id of blockerIds) {
          const c = this.state.cards[id];
          assert(
            !c ||
              !this.matchesSelector(c, check.blockerMustNotMatch, {
                ...check.ctx,
                selected: { ...check.ctx.selected, __candidate: [id] }
              }),
            `'${this.getDefinition(id).name}' cannot block this battle.`
          );
        }
      }
    }
  }

  private isBattleResponseWindow(
    window: ResponseWindowState
  ): boolean {
    return (
      window.kind === "battleAfterAttackers" ||
      window.kind === "battleBeforeDamage" ||
      window.kind === "battleAfterDamage"
    );
  }

  private requireBattle(): BattleState {
    const battle = this.state.battle;
    assert(battle, "No battle in progress.");
    return battle;
  }

  private requireBattleId(
    battleId: BattleId
  ): BattleState {
    const battle = this.requireBattle();
    assert(
      battle.id === battleId,
      `Expected battle '${battleId}', found '${battle.id}'.`
    );
    return battle;
  }

  /**
   * The finished battle remains in GameState until advanceFlow() is called,
   * allowing a renderer to show/animate the final state.
   */
  private finishBattle(
    battle: BattleState
  ): void {
    this.beginEventBatch();

    try {
      for (const cardId of [
        ...battle.attackingParty,
        ...battle.blockingParty
      ]) {
        const card = this.state.cards[cardId];

        if (!card || card.zone !== "play") {
          continue;
        }

        if (!card.depleted) {
          card.depleted = true;

          this.emit({
            type: "cardDepleted",
            cardId
          });
        }
      }
    } finally {
      this.endEventBatch();
    }

    battle.phase = "finished";
    battle.speed = undefined;

    this.emit({
      type: "battleEnded",
      battleId: battle.id
    });

    // "Restore it at the end of the battle" and other `scheduleEffect`
    // (`when: "endOfBattle"`) riders registered during this battle.
    this.fireScheduledEffects("endOfBattle");

    // `installReplacement` grants scoped to this battle expire now
    // (Sarcophyle Matriculation — "would be destroyed during this battle").
    this.state.runtimeReplacements = this.state.runtimeReplacements.filter(
      g => g.duration.type !== "endOfBattle"
    );

    this.state.priorityPlayerId = this.state.activePlayerId;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private meetsThreshold(
    playerId: PlayerId,
    threshold: string | number,
    /**
     * The card being deployed — when it carries `behavior`/`thresholdSlack`
     * (FEALTY) and its `condition` holds, the requirement is satisfied
     * whenever the player is at most `amount` icons short in TOTAL across
     * every icon type. Passed from `deployCard` / `getCardPlayability`.
     */
    slackFor?: { definition: CardDefinition; cardId: CardInstanceId }
  ): boolean {
    if (!threshold || threshold === 0 || threshold === "") {
      return true;
    }

    // OMNIPOTENCE (The Evil Alliance) — meet every threshold regardless of icons.
    if (this.getFactionDefinition(playerId)?.meetsAllThresholds) {
      return true;
    }

    const required = parseThreshold(threshold);
    const available = this.getThresholds(playerId);

    const slack = slackFor?.definition.thresholdSlack;
    let slackBudget = 0;
    if (
      slack &&
      this.evaluateCondition(slack.condition, {
        sourceId: slackFor!.cardId,
        controllerId: playerId,
        selected: {}
      })
    ) {
      slackBudget = slack.amount;
    }

    let deficit = 0;
    for (const icon of [
      "rage",
      "greed",
      "deception",
      "elitism",
      "obsession",
      "volition"
    ] as const) {
      // "This turn, reduce the threshold requirement of the next card you
      // deploy by N of the named icon." (Clockman Skydocks).
      const reduction = this.state.thresholdReductions
        .filter(r => r.playerId === playerId && r.icon === icon)
        .reduce((n, r) => n + r.amount, 0);
      const shortfall =
        Math.max(0, (required[icon] ?? 0) - reduction) - (available[icon] ?? 0);
      if (shortfall > 0) {
        deficit += shortfall;
        // Without FEALTY slack, any single-icon shortfall fails outright.
        if (slackBudget === 0) return false;
      }
    }

    // "reduce this card's threshold requirement by any N resource icons"
    // (FEALTY) — a total-deficit allowance across all icon types.
    return deficit <= slackBudget;
  }

  private getEventCardId(
    event?: GameEvent
  ): CardInstanceId | undefined {
    if (!event) {
      return undefined;
    }

    switch (event.type) {
      case "cardPlayed":
      case "cardEnteredPlay":
      case "cardMoved":
      case "cardDestroyed":
      case "cardDepleted":
      case "cardRestored":
      case "resourcePlayed":
      case "abilityActivated":
      case "characterAttacked":
      case "characterBlocked":
      case "attackerBlocked":
      case "counterChanged":
      case "cardPicked":
        return event.cardId;

      case "damageDealt":
        return event.targetId;

      default:
        return undefined;
    }
  }


  private definitionHasKeyword(
    definition: CardDefinition,
    keyword: Keyword
  ): boolean {
    return definition.behavior?.keywords?.includes(keyword) ?? false;
  }

  /**
   * Whether `cardId` currently has `keyword` — printed statically, granted
   * temporarily (`grantKeyword`), or granted live by a continuous ability
   * (incl. an aura). Public: a renderer needs a card's live keyword set, and
   * it's the same check battle legality already uses.
   */
  hasKeyword(cardId: CardInstanceId, keyword: Keyword): boolean {
    // A suppression ("it loses COVERT") beats every grant, printed or
    // otherwise — both the continuous form and the duration'd
    // `suppressKeyword` effect (I See You!).
    if (this.getContinuousKeywordSuppressions(cardId).includes(keyword)) {
      return false;
    }
    if (
      this.state.keywordSuppressions.some(
        g => g.targetId === cardId && g.keyword === keyword
      )
    ) {
      return false;
    }

    if (
      this.definitionHasKeyword(
        this.getDefinition(cardId),
        keyword
      )
    ) {
      return true;
    }

    if (
      this.state.keywordGrants.some(
        grant => grant.targetId === cardId && grant.keyword === keyword
      )
    ) {
      return true;
    }

    // "Characters you control [and deploy] gain <keyword>" (Hasty Pursuit).
    const controllerId = this.state.cards[cardId]?.controllerId;
    if (
      controllerId &&
      this.state.playerKeywordGrants.some(
        grant => grant.playerId === controllerId && grant.keyword === keyword
      )
    ) {
      return true;
    }

    return this.getContinuousKeywordGrants(cardId).includes(keyword);
  }

  /** Every keyword `cardId` currently has (see `hasKeyword`). */
  getKeywords(cardId: CardInstanceId): Keyword[] {
    const all: Keyword[] = [
      "tactical",
      "aggro",
      "covert",
      "cannotBeBlocked",
      "redirectDamage",
      "canBlockCovert",
      "canBlockAnyParty"
    ];
    return all.filter(keyword => this.hasKeyword(cardId, keyword));
  }

  private requireCard(
    id: CardInstanceId
  ): CardInstance {
    const card = this.state.cards[id];

    assert(card, `Card '${id}' not found.`);

    return card;
  }

  private requirePlayer(
    id: PlayerId
  ): PlayerState {
    const player = this.state.players[id];

    assert(player, `Player '${id}' not found.`);

    return player;
  }

  private getOpponent(
    playerId: PlayerId
  ): PlayerState {
    const opponent = Object.values(
      this.state.players
    ).find(player => player.id !== playerId);

    assert(
      opponent,
      "This barebones engine currently expects exactly two players."
    );

    return opponent;
  }
}

