// -----------------------------------------------------------------------------
// Where a block of rules text refers to "the opponent"
// -----------------------------------------------------------------------------
//
// A block of rules text (an ability, a card's play) binds one opponent for its
// whole resolution when the table has more than one candidate (MP 2;
// docs/MULTIPLAYER-PLAN.md D4). Whether it needs to — and whether a pick can
// settle it — is a static property of the block's data, computed here once per
// block object.

/** Where a block mentions "opponent". */
export interface OpponentRefs {
  /** In the selector of a pick ("pick a character an opponent controls"): the pick can name the opponent. */
  inPicks: boolean;
  /** Anywhere else (an effect's player, a cost, a condition): the opponent must be known up front. */
  elsewhere: boolean;
}

/**
 * Keys whose "opponent" is not a player the block's text refers to: who may use an ability, and the per-player
 * tests that judge every opponent on their own ("cannot be blocked by those players", "that player cannot pick").
 */
const NOT_A_REFERENCE = new Set(["usableBy", "notBy", "pickerWhere"]);

const cache = new WeakMap<object, OpponentRefs>();

/**
 * Where `block` (any authored ability / play data: targets, costs, effects,
 * conditions) refers to an opponent. Card selectors inside a pick declaration
 * (an object with both `id` and `selector`) count as `inPicks`; every other
 * `"opponent"` value counts as `elsewhere`.
 */
export function opponentRefsOf(block: unknown): OpponentRefs {
  if (block === null || typeof block !== "object") return { inPicks: false, elsewhere: false };
  const cached = cache.get(block);
  if (cached) return cached;
  const refs: OpponentRefs = { inPicks: false, elsewhere: false };
  walk(block, false, refs);
  cache.set(block, refs);
  return refs;
}

const conditionCache = new WeakMap<object, boolean>();

/** Keys under which a condition nests other conditions (judged on their own). */
const SUB_CONDITION_KEYS = new Set(["condition", "conditions"]);

/**
 * Whether a condition node refers to "opponent" itself — in its own player
 * fields or the expressions and selectors it compares — not counting the
 * conditions nested inside it (`and` / `or` / `not` children).
 */
export function conditionNodeRefersToOpponent(condition: object): boolean {
  const cached = conditionCache.get(condition);
  if (cached !== undefined) return cached;
  const refs: OpponentRefs = { inPicks: false, elsewhere: false };
  for (const [key, value] of Object.entries(condition)) {
    if (SUB_CONDITION_KEYS.has(key) || NOT_A_REFERENCE.has(key)) continue;
    if (value === "opponent") refs.elsewhere = true;
    else walk(value, false, refs);
  }
  const result = refs.elsewhere || refs.inPicks;
  conditionCache.set(condition, result);
  return result;
}

function walk(node: unknown, inPick: boolean, refs: OpponentRefs): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, inPick, refs);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const isDeclaration = "id" in record && "selector" in record;
  // Effects that resolve their body once per player rebind "opponent" for it
  // themselves ("each opponent ...", "any player may pay ..."): the body's
  // references are not the enclosing block's.
  const anyOpponentMayPay = record.type === "mayPay" && record.anyOf === "opponents";
  const rebindsBody =
    record.type === "forEachPlayer" || record.type === "asPlayer" || record.type === "anyPlayerMayPay" || anyOpponentMayPay;
  if (anyOpponentMayPay) {
    // The payer is whichever opponent pays; only the "otherwise" branch speaks for the block.
    walk(record.elseEffects, inPick, refs);
    return;
  }
  // "Both players" names the block's opponent itself (MP 3), as does "at the
  // start of your opponent's next turn".
  if (
    (record.type === "forEachPlayer" && record.players === "controllerAndOpponent") ||
    (record.type === "scheduleEffect" && record.when === "startOfOpponentNextTurn")
  ) {
    if (inPick) refs.inPicks = true;
    else refs.elsewhere = true;
  }
  for (const [key, value] of Object.entries(record)) {
    if (NOT_A_REFERENCE.has(key)) continue;
    if (rebindsBody && key === "effects") continue;
    // A condition about an opponent is judged for each opponent on its own
    // when nothing is bound (E4): it does not need the block's opponent named.
    if (SUB_CONDITION_KEYS.has(key)) continue;
    if (value === "opponent") {
      if (inPick) refs.inPicks = true;
      else refs.elsewhere = true;
      continue;
    }
    walk(value, inPick || (isDeclaration && key === "selector"), refs);
  }
}
