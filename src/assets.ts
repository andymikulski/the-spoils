/* assets.ts
 *
 * The package's "./assets" export: the handful of images that aren't
 * per-card art. Kept separate from ./data.ts so a consumer that only wants
 * the card back doesn't pull in the ~1.2MB card catalog, and separate from
 * ./engine.ts so the rules engine stays UI-free.
 *
 * Card art (`data/assets/<CardDefinitionId>.jpg`, ~370MB) is deliberately
 * not published — renderers serve that directory themselves. The card back
 * is the exception: it's one small file every renderer needs (face-down
 * cards, decks, the void, booster packs), so it ships with the package and
 * is also importable directly as `spoils-db/card-back.jpg` for bundlers
 * that turn image imports into asset URLs.
 */

/**
 * The card back's id under the same `<root>/<id>.jpg` URL shape card art
 * uses, so a renderer already serving `data/assets/` gets the back for free
 * (no real card id collides — those are UUIDs).
 */
export const CARD_BACK_ASSET_ID = "card-back";

/** Intrinsic pixel size of `card-back.jpg`, for sizing a texture/plane. */
export const CARD_BACK_SIZE = { width: 200, height: 277 } as const;

/**
 * The conventional root a renderer serves `data/assets/` from. Exported so
 * renderers build every card URL off one shared value rather than each
 * redeclaring the literal.
 */
export const DEFAULT_ASSET_ROOT = "/cards";

/**
 * URL of the card back, given wherever the renderer serves card art from.
 * Bundler-based consumers can instead `import backUrl from
 * "spoils-db/card-back.jpg"` and skip serving anything.
 */
export function resolveCardBackUrl(assetRoot: string = DEFAULT_ASSET_ROOT): string {
  return `${assetRoot}/${CARD_BACK_ASSET_ID}.jpg`;
}
