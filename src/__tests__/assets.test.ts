import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CARD_BACK_ASSET_ID, CARD_BACK_SIZE, resolveCardBackUrl } from "../assets.js";

const repoRoot = new URL("../../", import.meta.url);

test("the card back ships with the package", () => {
  const file = fileURLToPath(new URL(`data/assets/${CARD_BACK_ASSET_ID}.jpg`, repoRoot));
  assert.ok(statSync(file).isFile());

  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("package.json", repoRoot)), "utf8"));
  assert.equal(pkg.exports["./card-back.jpg"], "./data/assets/card-back.jpg");
  assert.ok(pkg.files.includes("data/assets/card-back.jpg"));
});

test("CARD_BACK_SIZE matches the image", () => {
  const jpeg = readFileSync(fileURLToPath(new URL(`data/assets/${CARD_BACK_ASSET_ID}.jpg`, repoRoot)));

  // Walk the JPEG marker segments to the start-of-frame, which carries the
  // image's height then width as big-endian 16-bit values.
  let offset = 2;
  let size: { width: number; height: number } | undefined;
  while (offset < jpeg.length - 1) {
    assert.equal(jpeg[offset], 0xff);
    const marker = jpeg[offset + 1]!;
    const length = jpeg.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      size = { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
      break;
    }
    offset += 2 + length;
  }

  assert.deepEqual(size, { width: CARD_BACK_SIZE.width, height: CARD_BACK_SIZE.height });
});

test("resolveCardBackUrl follows the card-art URL shape", () => {
  assert.equal(resolveCardBackUrl(), "/cards/card-back.jpg");
  assert.equal(resolveCardBackUrl("/static/art"), "/static/art/card-back.jpg");
});
