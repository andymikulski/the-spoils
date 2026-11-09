// Catalog cards written from another player's point of view (MPQ-P10), rebuilt in the converted data form of
// data/card-tests/mp-spec/README.md: `opponentFrom: "acting"` on the ability, "that player" is `"acting"`, "their
// opponent" is plain `"opponent"`, and "both players" is `forEachPlayer { players: "pair" }`. The catalog is not
// converted yet; these return modified copies and never touch it.

import type { CardDefinition } from "../../../engine.js";

type Json = Record<string, unknown>;

/** `"opponent"` as the value of a player word (`chooser`, `player`, a selector's `controller` / `owner`) becomes `"acting"`. */
function opponentToActing(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(opponentToActing);
  if (!node || typeof node !== "object") return node;
  const out: Json = {};
  for (const [key, value] of Object.entries(node as Json)) {
    out[key] = (key === "chooser" || key === "player" || key === "controller" || key === "owner") && value === "opponent" ? "acting" : opponentToActing(value);
  }
  return out;
}

/** Meat of the Mountain: the drawing opponent's ability, with "that player" as `"acting"` and the 0-token discard by "that player's opponent". */
export function meatInActingForm(card: CardDefinition): CardDefinition {
  const copy = structuredClone(card);
  const abilities = copy.behavior!.abilities as unknown as Json[];
  const ability = abilities.find(entry => entry.id === "meat-draw-opponent")!;
  ability.opponentFrom = "acting";
  ability.effects = opponentToActing(ability.effects);
  const fixDiscard = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(fixDiscard);
    if (!node || typeof node !== "object") return;
    const entry = node as Json;
    const declaration = entry.declaration as { id?: string; selector: Json } | undefined;
    if (entry.type === "chooserSelectsTarget" && declaration?.id === "meat-opponent-d0") {
      // "That player's opponent discards a card": the discarding player chooses it from their own hand.
      entry.chooser = "opponent";
      declaration.selector = { controller: "opponent", zone: "hand" };
    }
    Object.values(entry).forEach(fixDiscard);
  };
  fixDiscard(ability.effects);
  return copy;
}

const PLAY_RESOURCE = (who: "acting" | "opponent") => ({
  type: "chooserSelectsTarget",
  chooser: who,
  declaration: { id: "h", selector: { owner: who, zone: "hand" }, count: 1, optional: true },
  effects: [{ type: "playResource", target: { type: "selected", id: "h" }, faceDown: "auto", player: who }]
});
const MAY_DRAW = (who: "acting" | "opponent") => ({
  type: "mayPay",
  player: who,
  costs: [],
  effects: [{ type: "draw", player: who, amount: 1 }]
});

/** Free Trade Agreement: options 1 and 2 name "their opponent" as `"opponent"`, options 3 and 4 are a `pair` iteration. */
export function freeTradeInActingForm(card: CardDefinition): CardDefinition {
  const copy = structuredClone(card);
  const ability = (copy.behavior!.abilities as unknown as Json[])[0]!;
  ability.opponentFrom = "acting";
  const menu = (ability.effects as Json[])[0]!;
  menu.chooser = "acting";
  const options = menu.options as Array<{ effects: Json[] }>;
  options[0]!.effects = [MAY_DRAW("acting"), PLAY_RESOURCE("opponent")];
  options[1]!.effects = [PLAY_RESOURCE("acting"), MAY_DRAW("opponent")];
  for (const option of [options[2]!, options[3]!]) {
    const each = option.effects[0]!;
    each.players = "pair";
  }
  return copy;
}
