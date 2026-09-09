const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  addCartItem,
  removeCartItem,
  applyIncomingCart,
  shouldApplyCartSync,
  hasCart,
} = require("../electron/renderer/logic");

function npcWith(items) {
  return { items: items || [], state: "idle" };
}

describe("cart", () => {
  it("keeps remaining items when one title is removed", () => {
    const npc = npcWith([]);
    addCartItem(npc, { productTitle: "1984" });
    addCartItem(npc, { productTitle: "The Hobbit" });
    removeCartItem(npc, { productTitle: "1984" });
    assert.equal(npc.items.length, 1);
    assert.equal(npc.items[0].title, "The Hobbit");
    assert.equal(hasCart(npc), true);
  });

  it("ignores an empty cart_sync unless totalQuantity is 0", () => {
    assert.equal(shouldApplyCartSync({ items: [], totalQuantity: undefined }), false);
    assert.equal(shouldApplyCartSync({ items: [] }), false);
    assert.equal(shouldApplyCartSync({ items: [], totalQuantity: 0 }), true);
    assert.equal(
      shouldApplyCartSync({ items: [{ productTitle: "1984" }], totalQuantity: 1 }),
      true
    );
  });

  it("stamps a returning visitor cart from enter items", () => {
    const npc = npcWith([]);
    applyIncomingCart(npc, {
      type: "enter",
      items: [
        { productTitle: "1984", quantity: 1 },
        { productTitle: "The Hobbit", quantity: 2 },
      ],
    });
    assert.equal(npc.items.length, 2);
    assert.equal(npc.items[1].qty, 2);
    assert.equal(npc.hadCart, true);
  });

  it("does not refill a purchased NPC from a leftover cart snapshot", () => {
    const npc = npcWith([{ title: "1984", qty: 1 }]);
    npc.purchased = true;
    npc.items = [];
    applyIncomingCart(npc, {
      type: "heartbeat",
      items: [{ productTitle: "1984" }],
    });
    assert.equal(npc.items.length, 0);
  });
});
