// The show logo in the live corner (Andrew, 23 Nov 2026): trimmed of empty margin, and given the plate that makes it
// read over any video. Run: npx tsx --test script/show-logo.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { plateOf, prepareShowLogo } from "../server/showLogoImage.js";

const shapes = (ink: string, w = 900, h = 400, pad = 0) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w + pad * 2}" height="${h + pad * 2}"><g transform="translate(${pad},${pad})"><circle cx="170" cy="200" r="120" fill="none" stroke="${ink}" stroke-width="26"/><rect x="330" y="120" width="500" height="80" fill="${ink}"/><rect x="330" y="230" width="380" height="50" fill="${ink}"/></g></svg>`)).png().toBuffer();

test("dark ink on clear gets a light plate", async () => assert.equal(await plateOf(await shapes("#13233f")), "light"));
test("white or gold ink on clear gets a dark plate", async () => {
  assert.equal(await plateOf(await shapes("#ffffff")), "dark");
  assert.equal(await plateOf(await shapes("#F0C040")), "dark");
});
test("an opaque picture (cover art) brings its own background", async () => {
  const cover = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#1d4e89" } }).png().toBuffer();
  assert.equal(await plateOf(cover), "none");
});
test("a big clear margin is trimmed, and it's kept PNG", async () => {
  const out = await prepareShowLogo(await shapes("#13233f", 900, 400, 600), "image/png");
  const m = await sharp(out.buf).metadata();
  assert.equal(out.mime, "image/png");
  assert.ok((m.width ?? 0) < 1000 && (m.height ?? 0) < 400, `trimmed to ${m.width}x${m.height}`);
  assert.equal(out.plate, "light");
});
