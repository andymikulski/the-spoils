// -----------------------------------------------------------------------------
// Save format (SpoilsEngine save/load — see ../engine/persistence.ts)
// -----------------------------------------------------------------------------

import type { CardDefinition } from "./cards.js";
import type { GameState } from "./state.js";

/**
 * Bumped only when `GameState`'s shape changes in a way `SpoilsEngine`'s own
 * constructor defaults (the `??=` backfills applied to a partially-specified
 * state) can't express on their own — a field rename, a removed field, a
 * changed meaning for an existing field. A purely additive field never needs
 * a bump: an older save loaded against a newer engine just gets the new
 * field's default from the constructor, the same way a hand-built test
 * fixture already does.
 */
export const CURRENT_SAVE_FORMAT_VERSION = 2;

/**
 * The complete, JSON-serializable save for one game — round-trips through
 * `saveGame`/`loadGame` (`../engine/persistence.ts`). `state` is exactly
 * `SpoilsEngine.state`: every zone, every in-flight response stack item or
 * pending choice, the RNG position, everything needed to resume this exact
 * game later, in a different process, with no information loss.
 *
 * Deliberately consumer-agnostic: plain JSON data, no functions, no `Map`/
 * `Set`/class instances/`Date` objects, so it is equally at home in a
 * Postgres `jsonb` column, a Mongo document, a flat file, or
 * `localStorage.setItem` — whatever a particular UI (React today, perhaps
 * three.js or Phaser tomorrow) happens to be backed by.
 *
 * Does **not** embed the static card catalog — the engine/data split (see
 * CLAUDE.md) means a save is only ever meaningful alongside the
 * `CardDefinition[]` catalog it was played with; `loadGame` takes that
 * catalog as an explicit argument rather than duplicating megabytes of card
 * text into every save.
 *
 * It *does* carry `runtimeDefinitions` — the card definitions synthesized at
 * runtime for token permanents (`createTokens`), which exist only in that
 * one `SpoilsEngine`'s own `definitions` map and can't be recovered from any
 * static catalog. Small (one entry per distinct token on the board) and
 * omitted entirely when the game has none.
 */
export interface SerializedGame {
  formatVersion: number;
  state: GameState;
  runtimeDefinitions?: CardDefinition[];
  /**
   * Places in `state` that hold the very same object in the live game, which JSON writes out as separate copies:
   * each entry is `[path, pathOfTheSameObject]`, paths as keys from `state` (array indices as strings). The engine
   * relies on a few of these: the rest of an effect list waiting behind a prompt shares its resolution context with
   * the prompt, so the pick the prompt gets is seen by the effects after it. `loadGame` links them up again.
   * Omitted when nothing is shared.
   */
  sharedObjects?: Array<[string[], string[]]>;
}
