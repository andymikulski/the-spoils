/* assets.ts
 *
 * The package's "./assets" export: the renderer-agnostic conventions for
 * where card images live and how their URLs are shaped. It exports no image
 * binaries — only the shared asset root and the ids a renderer needs to
 * build URLs. Kept separate from ./data.ts so a consumer that only wants
 * these constants doesn't pull in the ~1.2MB card catalog, and separate
 * from ./engine.ts so the rules engine stays UI-free.
 *
 * Nothing under `data/assets/` (card art, ~370MB, plus the shared card
 * back) is published — renderers serve that directory themselves. The card
 * back is not special-cased: it's one more file in `data/assets/`, under a
 * reserved id (`card-back`) that no real card uses, resolved at the same
 * `<root>/<id>.jpg` URL as any card face.
 */

/**
 * The shared card back's id — the stem of `data/assets/card-back.jpg`. A
 * renderer serving `data/assets/` resolves it at `<root>/<id>.jpg` exactly
 * like a card face; no real card id collides (those are UUIDs).
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
 * URL of the card back, given wherever the renderer serves `data/assets/`
 * from. Same contract as a card face: the renderer serves the file, and a
 * renderer that doesn't gets a URL that 404s to whatever fallback it draws.
 */
export function resolveCardBackUrl(assetRoot: string = DEFAULT_ASSET_ROOT): string {
  return `${assetRoot}/${CARD_BACK_ASSET_ID}.jpg`;
}
