const path = require("path");

const OPTION_LEFT = 58;
const OPTION_RIGHT = 61;
const GRAVE = 50;
const CONTROL_LEFT = 59;
const CONTROL_RIGHT = 62;
const SHIFT_LEFT = 56;
const SHIFT_RIGHT = 60;
const KEY_A = 0;
const HID = 1;
const SESSION = 0;

let readKey = null;

function koffiCandidates() {
  const list = ["koffi"];
  list.push(path.join(__dirname, "..", "node_modules", "koffi"));
  if (process.resourcesPath) {
    list.push(
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "node_modules",
        "koffi"
      )
    );
  }
  return list;
}

function loadReader() {
  if (readKey) return readKey;
  let lastErr;
  for (const candidate of koffiCandidates()) {
    try {
      const koffi = require(candidate);
      const cg = koffi.load(
        "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
      );
      const CGEventSourceKeyState = cg.func(
        "uint8 CGEventSourceKeyState(uint32 sourceStateID, uint16 keyCode)"
      );
      readKey = (code) =>
        Boolean(CGEventSourceKeyState(HID, code)) ||
        Boolean(CGEventSourceKeyState(SESSION, code));
      return readKey;
    } catch (err) {
      lastErr = err;
    }
  }
  console.error("hid key reader unavailable", lastErr);
  readKey = () => false;
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

function controlDown() {
  return keyDown(CONTROL_LEFT) || keyDown(CONTROL_RIGHT);
}

function shiftDown() {
  return keyDown(SHIFT_LEFT) || keyDown(SHIFT_RIGHT);
}

function tipsComboHeld() {
  if (optionDown() && keyDown(GRAVE)) return true;
  if (controlDown() && shiftDown() && keyDown(KEY_A)) return true;
  return false;
}

module.exports = {
  keyDown,
  optionDown,
  tipsComboHeld,
};
