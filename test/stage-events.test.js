const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createStage,
  LEAVE_GRACE_MS,
  DWELL_S,
  LANDMARKS,
  NPC_SIZES,
  pickOutfit,
  separateNpcs,
  visitorName,
  npcHeightFor,
} = require("../electron/renderer/logic");

function live() {
  let t = 1_000_000;
  const stage = createStage({
    now: () => t,
    doorX: () => 900,
    elevatorX: () => 900,
    slotX: (i) => 100 + i * 80,
  });
  return {
    stage,
    tick(ms) {
      t += ms;
      stage.step(ms / 1000);
    },
    npc(id) {
      return stage.npcs.get(id);
    },
  };
}

describe("stage events", () => {
  it("spawns one NPC per enter and does not spawn from view/browse", () => {
    const { stage, npc } = live();
    stage.handleEvent({ type: "view", sessionId: "ghost", pageUrl: "https://joshzandman.com/products/1984", productTitle: "1984" });
    assert.equal(stage.npcs.size, 0);
    stage.handleEvent({ type: "enter", sessionId: "a" });
    assert.equal(stage.npcs.size, 1);
    stage.handleEvent({
      type: "view",
      sessionId: "a",
      pageUrl: "https://joshzandman.com/products/1984",
      productTitle: "1984",
    });
    assert.equal(stage.npcs.size, 1);
    assert.equal(npc("a").viewing, "1984");
    assert.equal(npc("a").viewKind, "viewing");
  });

  it("merges duplicate sessions that share a clientKey", () => {
    const { stage } = live();
    stage.handleEvent({ type: "enter", sessionId: "pixel", clientKey: "abc" });
    stage.handleEvent({ type: "enter", sessionId: "beacon", clientKey: "abc" });
    assert.equal(stage.npcs.size, 1);
    assert.equal(stage.npcs.has("pixel"), true);
  });

  it("hides Council Bluffs visitors", () => {
    const { stage } = live();
    stage.handleEvent({
      type: "enter",
      sessionId: "josh",
      city: "Council Bluffs",
      regionCode: "IA",
      country: "US",
    });
    assert.equal(stage.npcs.size, 0);
  });

  it("keeps a checking-out NPC on a leave, then drops the cart on purchase", () => {
    const { stage, npc, tick } = live();
    stage.handleEvent({ type: "enter", sessionId: "buyer" });
    stage.handleEvent({ type: "cart", sessionId: "buyer", productTitle: "1984" });
    stage.handleEvent({ type: "checkout", sessionId: "buyer", pageUrl: "https://joshzandman.com/checkouts/1" });
    assert.equal(npc("buyer").checkingOut, true);
    assert.equal(npc("buyer").items.length, 1);
    stage.handleEvent({ type: "leave", sessionId: "buyer" });
    tick(LEAVE_GRACE_MS + 50);
    assert.notEqual(npc("buyer").state, "leaving");
    stage.handleEvent({ type: "purchase", sessionId: "buyer", productTitle: "1984", total: "75.00" });
    assert.equal(npc("buyer").items.length, 0);
    assert.equal(npc("buyer").state, "celebrating");
    assert.equal(npc("buyer").purchased, true);
  });

  it("waits through the leave grace before walking off", () => {
    const { stage, npc, tick } = live();
    stage.handleEvent({ type: "enter", sessionId: "tab" });
    stage.handleEvent({ type: "leave", sessionId: "tab" });
    tick(1000);
    assert.equal(npc("tab").state, "entering");
    tick(LEAVE_GRACE_MS);
    assert.equal(npc("tab").state, "leaving");
  });

  it("matches a purchase to the checking-out NPC even with a new session id", () => {
    const { stage, npc } = live();
    stage.handleEvent({ type: "enter", sessionId: "store", firstName: "Ada" });
    stage.handleEvent({ type: "checkout", sessionId: "store" });
    stage.handleEvent({ type: "purchase", sessionId: "shop-pay", firstName: "Ada", productTitle: "1984" });
    assert.equal(stage.npcs.size, 1);
    assert.equal(npc("store").state, "celebrating");
    assert.equal(npc("store").items.length, 0);
  });

  it("queues a 7th visitor until a slot opens", () => {
    const { stage } = live();
    for (let i = 0; i < 7; i += 1) {
      stage.handleEvent({ type: "enter", sessionId: `v${i}` });
    }
    assert.equal(stage.npcs.size, 6);
    assert.equal(stage.waiting.length, 1);
  });

  it("does not include hostess as a landmark", () => {
    assert.deepEqual(LANDMARKS, ["none", "door", "street", "elevator"]);
    const { stage } = live();
    stage.applySettings({ landmark: "hostess" });
    assert.equal(stage.settings.landmark, "door");
  });

  it("assigns distinct outfits when several NPCs spawn", () => {
    const { stage, npc } = live();
    for (let i = 0; i < 6; i += 1) {
      stage.handleEvent({ type: "enter", sessionId: `fit-${i}` });
    }
    const outfits = [...stage.npcs.values()].map((n) => n.outfit);
    assert.equal(new Set(outfits).size, 6);
    assert.equal(npc("fit-0").outfit, pickOutfit("fit-0", []));
  });

  it("labels guests and members for the chat bubble", () => {
    assert.equal(visitorName({}), "Guest");
    assert.equal(visitorName({ firstName: "Josh", lastName: "Zandman" }), "Josh Zandman");
  });

  it("nudges overlapping NPCs apart", () => {
    const a = { id: "a", x: 100, state: "idle" };
    const b = { id: "b", x: 110, state: "idle" };
    separateNpcs([a, b], 80);
    assert.ok(b.x - a.x >= 80);
  });

  it("looks around while standing, then walks after a dwell", () => {
    const { stage, npc, tick } = live();
    stage.handleEvent({ type: "enter", sessionId: "idle1" });
    tick(8000);
    const n = npc("idle1");
    assert.equal(n.state, "idle");
    n.idleMode = "dwell";
    n.dwellT = 0;
    n.dwellFor = DWELL_S;
    tick(400);
    assert.equal(n.look, "up");
    tick(DWELL_S * 1000);
    assert.equal(n.idleMode, "walk");
    assert.ok(n.browseTarget != null);
  });

  it("accepts NPC size settings", () => {
    const { stage } = live();
    stage.applySettings({ npcSize: "tiny" });
    assert.equal(stage.settings.npcSize, "tiny");
    assert.equal(npcHeightFor("tiny"), NPC_SIZES.tiny);
    assert.equal(npcHeightFor("huge"), NPC_SIZES.normal);
  });
});
