const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  locationLabel,
  isHiddenLocation,
  cleanNamePart,
  applyName,
} = require("../electron/renderer/logic");

describe("location labels", () => {
  it("shows US city and region", () => {
    assert.equal(
      locationLabel({ country: "US", city: "Nashville", regionCode: "TN" }),
      "Nashville, TN"
    );
  });

  it("shows only the country name for international visitors", () => {
    assert.equal(locationLabel({ country: "CA", city: "Toronto" }), "Canada");
    assert.equal(locationLabel({ country: "GB" }), "United Kingdom");
  });

  it("hides Council Bluffs, Iowa and nowhere else", () => {
    assert.equal(
      isHiddenLocation({ city: "Council Bluffs", regionCode: "IA", country: "US" }),
      true
    );
    assert.equal(
      isHiddenLocation({ city: "Council Bluffs", region: "Iowa", country: "US" }),
      true
    );
    assert.equal(
      isHiddenLocation({ city: "Nashville", regionCode: "TN", country: "US" }),
      false
    );
    assert.equal(isHiddenLocation({ city: "Toronto", country: "CA" }), false);
  });
});

describe("member names", () => {
  it("turns plus signs into spaces and splits first/last", () => {
    assert.equal(cleanNamePart("Josh+Zandman"), "Josh Zandman");
    const npc = {};
    applyName(npc, { firstName: "Josh+Zandman" });
    assert.equal(npc.firstName, "Josh");
    assert.equal(npc.lastName, "Zandman");
  });
});
