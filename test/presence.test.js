const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pageIsLive, pixelShouldSend, isCheckoutUrl } = require("../electron/renderer/logic");

const root = path.join(__dirname, "..");

describe("presence gating", () => {
  it("blocks only prerendered pages, not unfocused real visits", () => {
    assert.equal(pageIsLive({ prerendering: true }), false);
    assert.equal(pageIsLive({ prerendering: false }), true);
    assert.equal(pageIsLive({}), true);
    assert.equal(pageIsLive({ visibilityState: "hidden" }), true);
  });

  it("lets the pixel skip storefront presence when the theme beacon owns it", () => {
    assert.equal(
      pixelShouldSend("enter", { themeOwnsPresence: true, onCheckout: false }),
      false
    );
    assert.equal(
      pixelShouldSend("enter", { themeOwnsPresence: true, onCheckout: true }),
      true
    );
    assert.equal(
      pixelShouldSend("cart", { themeOwnsPresence: true, onCheckout: false }),
      true
    );
    assert.equal(
      pixelShouldSend("enter", { speculative: true }),
      false
    );
  });

  it("treats checkout URLs as checkout", () => {
    assert.equal(isCheckoutUrl("https://joshzandman.com/checkouts/abc"), true);
    assert.equal(isCheckoutUrl("https://joshzandman.com/products/1984"), false);
  });

  it("keeps the theme snippet and worker beacon on the prerender-only gate", () => {
    const snippet = fs.readFileSync(path.join(root, "theme-snippet.liquid"), "utf8");
    const beacon = fs.readFileSync(path.join(root, "worker/src/beacon.js"), "utf8");
    for (const src of [snippet, beacon]) {
      assert.match(src, /document\.prerendering/);
      assert.doesNotMatch(src, /hasFocus/);
      assert.match(src, /function pageIsLive/);
    }
  });
});
