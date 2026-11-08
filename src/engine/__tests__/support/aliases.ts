// Finds objects of a game state that two paths reach. A state that shares nothing can be saved, copied and loaded
// without the engine noticing; an object two places hold is a promise that the engine reads one and writes the other.

import type { CardDefinition, GameState } from "../../../engine.js";

export interface Alias {
  /** Every path that reaches the one object, `state.`-rooted. */
  paths: string[];
}

/**
 * Every object or array in `state` that more than one path reaches, except authored ability data: anything reachable
 * from the card definitions or from a card's `createdAbility`. Effect lists, declarations and the like are written once
 * and never changed, so a stack item, a trigger and a parked frame may all point into the same list.
 *
 * `definitions` is read as it is when called (a token minted during the game adds one), but each definition is walked
 * only once, so scanning every state of a game stays cheap.
 */
export function aliasScanner(definitions: Record<string, CardDefinition>): (state: GameState) => Alias[] {
  const authored = new Set<object>();
  const walkedDefinitions = new Set<string>();
  const collect = (value: unknown): void => {
    if (value === null || typeof value !== "object" || authored.has(value)) return;
    authored.add(value);
    for (const entry of Object.values(value)) collect(entry);
  };

  return state => {
    for (const [id, definition] of Object.entries(definitions)) {
      if (!walkedDefinitions.has(id)) {
        walkedDefinitions.add(id);
        collect(definition);
      }
    }
    for (const card of Object.values(state.cards)) collect(card.createdAbility);

    const seen = new Map<object, string[]>();
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== "object") return;
      const known = seen.get(value);
      if (known) {
        known.push(path);
        return;
      }
      seen.set(value, [path]);
      if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, `${path}.${index}`));
      else for (const [key, entry] of Object.entries(value)) walk(entry, `${path}.${key}`);
    };
    walk(state, "state");

    const aliases: Alias[] = [];
    for (const [object, paths] of seen) {
      if (paths.length > 1 && !authored.has(object)) aliases.push({ paths });
    }
    return aliases;
  };
}

/** `aliasScanner` for a single state. */
export function findAliases(state: GameState, definitions: Record<string, CardDefinition>): Alias[] {
  return aliasScanner(definitions)(state);
}
