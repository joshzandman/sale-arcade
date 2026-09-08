export const BEACON_JS = `(function () {
  var ENDPOINT = "https://sale-arcade.joshzandman.workers.dev/event";
  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  function readCookie(name) {
    var parts = document.cookie.split("; ");
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i].indexOf(name + "=") === 0) {
        return decodeURIComponent(parts[i].slice(name.length + 1).replace(/\\+/g, " "));
      }
    }
    return "";
  }
  function sid() {
    var id = readCookie("sale_arcade_sid");
    if (id) return id;
    id = uuid();
    document.cookie = "sale_arcade_sid=" + id + "; path=/; max-age=2592000; SameSite=Lax";
    return id;
  }
  function post(type, extra) {
    var body = {
      sessionId: sid(),
      type: type,
      pageUrl: location.href,
      pageTitle: document.title
    };
    var name = readCookie("sale_arcade_name");
    if (name) body.firstName = name.slice(0, 40);
    if (extra) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key) && extra[key] != null) {
          body[key] = extra[key];
        }
      }
    }
    fetch(ENDPOINT, {
      method: "POST",
      body: JSON.stringify(body),
      keepalive: true
    }).catch(function () {});
  }
  function cartItems(cart) {
    var items = [];
    var lines = (cart && cart.items) || [];
    for (var i = 0; i < lines.length && items.length < 8; i += 1) {
      var line = lines[i];
      if (!line) continue;
      var image = line.image || "";
      if (image.indexOf("//") === 0) image = "https:" + image;
      items.push({
        productTitle: line.product_title || line.title || "",
        productType: line.product_type || "",
        imageUrl: image,
        quantity: line.quantity || 1
      });
    }
    return {
      items: items,
      totalQuantity: cart && typeof cart.item_count === "number" ? cart.item_count : items.length
    };
  }
  function sendEnter() {
    fetch("/cart.js", { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (cart) {
        post("enter", cart ? cartItems(cart) : {});
      })
      .catch(function () {
        post("enter");
      });
  }
  sid();
  sendEnter();
  setInterval(function () {
    post("heartbeat");
  }, 10000);
  window.addEventListener("pagehide", function () {
    post("leave");
  });
})();
`;
