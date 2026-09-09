import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeImageUrl,
  sanitizeItems,
  isHiddenLocation,
  fromStorefront,
  eventNeedsAuth,
  PRESENCE_TYPES,
} from "../worker/src/rules.js";

describe("worker rules", () => {
  it("upgrades protocol-relative image URLs and drops junk", () => {
    assert.equal(
      sanitizeImageUrl("//cdn.shopify.com/1984.jpg"),
      "https://cdn.shopify.com/1984.jpg"
    );
    assert.equal(sanitizeImageUrl("http://cdn.shopify.com/1984.jpg"), "https://cdn.shopify.com/1984.jpg");
    assert.equal(sanitizeImageUrl("javascript:alert(1)"), undefined);
    assert.equal(sanitizeImageUrl(""), undefined);
  });

  it("keeps at most 8 cart items", () => {
    const items = sanitizeItems(
      Array.from({ length: 12 }, (_, i) => ({ productTitle: `Book ${i}` }))
    );
    assert.equal(items.length, 8);
  });

  it("hides Council Bluffs on the worker too", () => {
    assert.equal(
      isHiddenLocation({ city: "Council Bluffs", regionCode: "IA", country: "US" }),
      true
    );
  });

  it("allows unauthenticated presence posts and requires auth for cart/purchase", () => {
    assert.equal(PRESENCE_TYPES.enter, true);
    assert.equal(eventNeedsAuth("enter"), false);
    assert.equal(eventNeedsAuth("heartbeat"), false);
    assert.equal(eventNeedsAuth("leave"), false);
    assert.equal(eventNeedsAuth("cart"), true);
    assert.equal(eventNeedsAuth("purchase"), true);
  });

  it("recognizes the live storefront origin", () => {
    const req = {
      headers: {
        get(name) {
          if (name === "Origin") return "https://joshzandman.com";
          return "";
        },
      },
    };
    assert.equal(fromStorefront(req), true);
  });
});
