// Template. Use pixel-live.js (with real ENDPOINT/SECRET) in Shopify Admin.

const ENDPOINT = "https://sale-arcade.YOUR_SUBDOMAIN.workers.dev/event";
const SECRET = "change-me-to-a-long-random-string";

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function pick(obj, keys) {
  let cur = obj;
  for (let i = 0; i < keys.length; i += 1) {
    if (!cur) return "";
    cur = cur[keys[i]];
  }
  if (cur === undefined || cur === null) return "";
  return String(cur);
}

async function sessionId() {
  let id = await browser.localStorage.getItem("sale_arcade_sid");
  if (!id) {
    id = uuid();
    await browser.localStorage.setItem("sale_arcade_sid", id);
  }
  return id;
}

async function memberName() {
  try {
    const cookie = await browser.cookie.get("sale_arcade_name");
    if (cookie) return decodeURIComponent(cookie).trim();
  } catch (err) {
    return "";
  }
  return "";
}

function send(type, extra) {
  Promise.all([sessionId(), memberName()]).then(function (parts) {
    const sid = parts[0];
    const cookieName = parts[1];
    const body = Object.assign(
      { sessionId: sid, type: type, secret: SECRET },
      extra || {}
    );
    const firstName = body.firstName || cookieName;
    if (firstName) body.firstName = String(firstName).slice(0, 24);
    fetch(ENDPOINT, {
      method: "POST",
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(function () {});
  });
}

let beating = false;
function startHeartbeat() {
  if (beating) return;
  beating = true;
  try {
    setInterval(function () {
      send("heartbeat");
    }, 10000);
  } catch (err) {
    return;
  }
}

analytics.subscribe("page_viewed", async function () {
  const flag = await browser.sessionStorage.getItem("sale_arcade_entered");
  if (!flag) {
    await browser.sessionStorage.setItem("sale_arcade_entered", "1");
    send("enter");
  } else {
    send("heartbeat");
  }
  startHeartbeat();
});

analytics.subscribe("product_added_to_cart", function (event) {
  send("cart", {
    productTitle: pick(event, ["data", "cartLine", "merchandise", "product", "title"]),
  });
});

analytics.subscribe("product_removed_from_cart", function () {
  send("cart_empty");
});

analytics.subscribe("checkout_started", function () {
  send("cart");
});

analytics.subscribe("checkout_completed", function (event) {
  const checkout = event.data && event.data.checkout;
  const total = pick(checkout, ["totalPrice", "amount"]);
  let title = pick(checkout, ["lineItems", "0", "title"]);
  if (!title) {
    title = pick(checkout, ["lineItems", "0", "variant", "product", "title"]);
  }
  let firstName = pick(checkout, ["billingAddress", "firstName"]);
  if (!firstName) {
    firstName = pick(checkout, ["shippingAddress", "firstName"]);
  }
  send("purchase", { total: total, productTitle: title, firstName: firstName });
});
