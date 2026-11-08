// -----------------------------------------------------------------------------
// Which block of rules text says "your opponent", and where its opponent comes from
// -----------------------------------------------------------------------------
//
// Pure helpers over ability data (MP 2, MPX-select). A block "says your opponent" when its data holds the player word
// `"opponent"`; the word `"opponents"` names every opponent and selects nobody. `opponentFrom` says where the block's
// opponent comes from; when an ability leaves it out the engine derives it from the data shape (the sites the card
// spec marks `edit: false`).

import type { AbilityDefinition, Condition, OpponentFrom } from "../types/index.js";

/** Keys whose `"opponent"` value is not a player word of the block's own text. */
const NOT_A_PLAYER_WORD: ReadonlySet<string> = new Set(["usableBy", "opponentFrom", "id", "name", "label"]);

/** True when `node` holds the player word `"opponent"` anywhere. */
export function namesOpponent(node: unknown): boolean {
  if (node === "opponent") return true;
  if (Array.isArray(node)) return node.some(namesOpponent);
  if (node && typeof node === "object") {
    // "Both players" (MP 3) is the controller and the block's opponent.
    if ((node as Record<string, unknown>).type === "forEachPlayer" && (node as Record<string, unknown>).players === "pair") return true;
    for (const [key, value] of Object.entries(node)) {
      if (NOT_A_PLAYER_WORD.has(key)) continue;
      if (namesOpponent(value)) return true;
    }
  }
  return false;
}

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);

/** Every condition node in a condition tree (and / or / not descend). */
function conditionNodes(condition: unknown, out: Node[] = []): Node[] {
  if (!isNode(condition)) return out;
  out.push(condition);
  if (Array.isArray(condition.conditions)) for (const child of condition.conditions) conditionNodes(child, out);
  if (condition.condition) conditionNodes(condition.condition, out);
  return out;
}

/**
 * Condition node types that test the triggering event's player or the player controlling the event's card. A trigger
 * whose condition names the opponent through one of them is met by any opponent's event (MPQ-P5).
 */
const EVENT_PLAYER_TESTS: ReadonlySet<string> = new Set(["eventPlayerIs", "eventCardControlledBy"]);

/** True when `condition` names the opponent through a test of the event's player (a node under and / or, never under not). */
export function conditionNamesEventOpponent(condition: Condition | undefined): boolean {
  const walk = (node: unknown): boolean => {
    if (!isNode(node)) return false;
    if (EVENT_PLAYER_TESTS.has(node.type as string)) return node.player === "opponent";
    if ((node.type === "and" || node.type === "or") && Array.isArray(node.conditions)) return node.conditions.some(walk);
    return false;
  };
  return walk(condition);
}

/** Trigger events that can only come from a battle (MPQ-P8). */
const BATTLE_EVENTS: ReadonlySet<string> = new Set(["attackerBlocked", "characterAttacked", "battleStarted"]);

/** True when `condition` / `event` can only be met inside a battle the controller is in (MPQ-P8 scope). */
export function isBattleOnly(event: string | undefined, condition: Condition | undefined): boolean {
  if (event !== undefined && BATTLE_EVENTS.has(event)) return true;
  const nodes = conditionNodes(condition);
  if (nodes.some(node => node.type === "battleRole" || node.type === "destroyedByBattleDamage")) return true;
  // "When this card inflicts damage to a faction": by CR 408.7 the only way a card is the source of damage to a faction is battle damage.
  return (
    event === "damageDealt" &&
    nodes.some(node => node.type === "sourceIsDamageSource") &&
    nodes.some(node => node.type === "cardTypeIs" && node.cardType === "faction")
  );
}

/**
 * The parts of an ability that are its own text, for the scan of player words. A replacement's `replaces` block only
 * filters which events it covers ("by an opposing card"): it never selects an opponent.
 */
function ownText(ability: AbilityDefinition): unknown {
  if (ability.type === "replacement") {
    const { replaces: _filter, ...rest } = ability as unknown as Node;
    return rest;
  }
  if (ability.type === "triggered") {
    // The trigger condition's event tests (`eventPlayerIs: "opponent"`) are filters satisfied by any opponent (MPQ-P5).
    const { condition, ...rest } = ability as unknown as Node;
    return { ...rest, condition: stripEventTests(condition) };
  }
  return ability;
}

function stripEventTests(condition: unknown): unknown {
  if (!isNode(condition)) return condition;
  if (EVENT_PLAYER_TESTS.has(condition.type as string)) return { type: condition.type };
  if ((condition.type === "and" || condition.type === "or") && Array.isArray(condition.conditions)) {
    return { ...condition, conditions: condition.conditions.map(stripEventTests) };
  }
  return condition;
}

/** Continuous flags that are an implicit "your opponent" with no player word of their own. */
function continuousFlagNamesOpponent(ability: AbilityDefinition): boolean {
  return ability.type === "continuous" && !!(ability as unknown as Node).canUseOpponentAbilities;
}

/** True when this ability's own text says "your opponent" (a player word `"opponent"`, outside the event tests of a trigger). */
export function abilityNamesOpponent(ability: AbilityDefinition): boolean {
  return namesOpponent(ownText(ability)) || continuousFlagNamesOpponent(ability);
}

/**
 * Where the block's opponent comes from, or `undefined` when the block says no "your opponent". `opponentFrom` wins
 * when written; otherwise a trigger whose condition names the event's opponent is `"event"` (MPQ-P5) and a block
 * that can only come from a battle is `"battle"` (MPQ-P8).
 */
export function abilityOpponentFrom(ability: AbilityDefinition): OpponentFrom | undefined {
  if (ability.type === "activated") return blockOpponentFrom(ability);
  const condition = (ability as { condition?: Condition }).condition;
  const eventBound = ability.type === "triggered" && conditionNamesEventOpponent(condition);
  if (!abilityNamesOpponent(ability) && !eventBound) return undefined;
  if (ability.opponentFrom !== undefined) return ability.opponentFrom;
  if (eventBound) return "event";
  if (ability.type === "triggered" && isBattleOnly(ability.event, condition)) return "battle";
  return "choose";
}

/**
 * Where the opponent of a play block (a tactic's play source, a card's `onPlay`, a mode, an activated ability)
 * comes from, or `undefined` when the block says no "your opponent". `opponentFrom` wins when written; a block gated
 * by `battleRole` is about a battle the controller is in (MPQ-P8).
 */
export function blockOpponentFrom(block: unknown): OpponentFrom | undefined {
  if (!isNode(block)) return undefined;
  const text = { ...block };
  for (const key of ["id", "name", "usableBy", "opponentFrom", "activationZone", "threshold", "usesPerTurn", "fromFaceDown"]) delete text[key];
  if (!namesOpponent(text)) return undefined;
  if (typeof block.opponentFrom === "string") return block.opponentFrom as OpponentFrom;
  if (conditionNodes(block.condition).some(node => node.type === "battleRole")) return "battle";
  return "choose";
}
