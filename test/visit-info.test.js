const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  visitInfo,
  hoverViewLine,
  isAboutPage,
  shopifyPageHandle,
} = require("../electron/renderer/logic");

describe("visitInfo labels", () => {
  it("uses Viewing for product pages", () => {
    const info = visitInfo({
      pageUrl: "https://joshzandman.com/products/1984",
      productTitle: "1984",
      type: "view",
    });
    assert.equal(info.kind, "viewing");
    assert.equal(info.title, "1984");
    assert.equal(hoverViewLine({ viewKind: info.kind, viewing: info.title }), "Viewing 1984");
  });

  it("does not treat cart events as product views", () => {
    const info = visitInfo({
      type: "cart",
      productTitle: "1984",
      pageUrl: "https://joshzandman.com/collections/best-sellers",
      collectionTitle: "Best Sellers",
    });
    assert.equal(info.kind, "browsing");
    assert.equal(info.title, "Best Sellers");
  });

  it("labels Shopify pages as instructions except About", () => {
    const book = visitInfo({
      pageUrl: "https://joshzandman.com/pages/1984",
      pageTitle: "1984 – JoshZandman",
    });
    assert.equal(book.title, "1984 instructions");
    assert.equal(book.kind, "browsing");

    const about = visitInfo({
      pageUrl: "https://joshzandman.com/pages/about",
      pageTitle: "About – JoshZandman",
    });
    assert.equal(about.title, "About");
    assert.equal(about.title.includes("instructions"), false);
  });

  it("skips the instructions suffix on locale-prefixed About URLs", () => {
    const info = visitInfo({
      pageUrl: "https://joshzandman.com/en-us/pages/about",
      pageTitle: "About – JoshZandman",
    });
    assert.equal(shopifyPageHandle(["en-us", "pages", "about"]), "about");
    assert.equal(isAboutPage("about", "About"), true);
    assert.equal(info.title, "About");
  });

  it("labels home and cart", () => {
    assert.equal(
      visitInfo({ pageUrl: "https://joshzandman.com/" }).title,
      "Home"
    );
    assert.equal(
      visitInfo({ pageUrl: "https://joshzandman.com/cart" }).title,
      "Cart"
    );
  });
});
