// Two framed tiles in our own studio's picture (24 Nov 2026, Riccoh's recording 474 cropped to one face in its verticals).
// Run: npx tsx --test script/layout-tiles.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { findTiles } from "../agent/layoutDetect.js";

const frame = async (file: string) => {
  const { data, info } = await sharp(file).resize(480).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgb: new Uint8Array(data), w: info.width, h: info.height };
};

test("a studio recording with two people: both tiles, whole, name cards inside", async () => {
  const { rgb, w, h } = await frame("script/fixtures/studio-two-tiles.jpg");
  const r = findTiles(rgb, w, h);
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  // The tiles in that frame (960x540 source): left ~12..475 x 140..400, right ~485..948. At 480 wide, half that.
  for (const [t, x0] of [[r.left, 6], [r.right, 242]] as const) {
    assert.ok(Math.abs(t.x - x0) <= 4, `x ${t.x} vs ${x0}`);
    assert.ok(t.w >= 225 && t.w <= 238, `w ${t.w}`);
    assert.ok(t.y <= 72 && t.y + t.h >= 197, `rows ${t.y}..${t.y + t.h}: the name card (~176..194) must be inside`);
  }
});

test("one person filling the picture is not two tiles", async () => {
  const { rgb, w, h } = await frame("script/fixtures/one-person-vertical.jpg");
  assert.equal(findTiles(rgb, w, h).ok, false);
});

test("a flat frame is not two tiles", () => {
  const w = 160, h = 90, rgb = new Uint8Array(w * h * 3).fill(40);
  assert.equal(findTiles(rgb, w, h).ok, false);
});
