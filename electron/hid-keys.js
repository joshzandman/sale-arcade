const OPTION_LEFT = 58;
const OPTION_RIGHT = 61;
const GRAVE = 50;

let readKey = null;

function loadReader() {
  if (readKey) return readKey;
  try {
    const koffi = require("koffi");
    const cg = koffi.load(
      "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
    );
    const CGEventSourceKeyState = cg.func(
      "uint8 CGEventSourceKeyState(uint32 sourceStateID, uint16 keyCode)"
    );
    readKey = (code) => Boolean(CGEventSourceKeyState(1, code));
  } catch (err) {
    console.error("hid key reader unavailable", err);
    readKey = () => false;
  }
  return readKey;
}

function keyDown(code) {
  try {
    return Boolean(loadReader()(code));
  } catch (err) {
    return false;
  }
}

function optionDown() {
  return keyDown(OPTION_LEFT) || keyDown(OPTION_RIGHT);
}

function graveDown() {
  return keyDown(GRAVE);
}

function tipsComboHeld() {
  return optionDown() || graveDown();
}

module.exports = {
  keyDown,
  optionDown,
  graveDown,
  tipsComboHeld,
};
