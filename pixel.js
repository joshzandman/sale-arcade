// Paste this into Shopify Admin → Settings → Customer events → Add custom pixel.
// Set permission to Analytics. Replace the two constants after you deploy the worker.

const ENDPOINT = "https://sale-arcade.YOUR_SUBDOMAIN.workers.dev/event";
const SECRET = "change-me-to-a-long-random-string";

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
    /* no cookie access */
  }
  return "";
}

function send(type, extra) {
  Promise.all([sessionId(), memberName()]).then(([sid, cookieName]) => {
    const body = Object.assign({ sessionId: sid, type }, extra || {});
    const firstName = body.firstName || cookieName;
    if (firstName) body.firstName = String(firstName).slice(0, 24);
    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + SECRET,
      },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  });
}

let beating = false;
function startHeartbeat() {
  if (beating) return;
  beating = true;
  try {
    setInterval(() => send("heartbeat"), 10000);
  } catch (err) {
    /* sandbox may block timers; page_viewed still pings */
  }
}

analytics.subscribe("page_viewed", async () => {
  const flag = await browser.sessionStorage.getItem("sale_arcade_entered");
  if (!flag) {
    await browser.sessionStorage.setItem("sale_arcade_entered", "1");
    send("enter");
  } else {
    send("heartbeat");
  }
  startHeartbeat();
});

analytics.subscribe("product_added_to_cart", (event) => {
  const title =
    (event.data &&
      event.data.cartLine &&
      event.data.cartLine.merchandise &&
      (event.data.cartLine.merchandise.product &&
        event.data.cartLine.merchandise.product.title)) ||
    "";
  send("cart", { productTitle: title });
});

analytics.subscribe("product_removed_from_cart", () => {
  send("cart_empty");
});

analytics.subscribe("checkout_started", () => {
  send("cart");
});

analytics.subscribe("checkout_completed", (event) => {
  const checkout = event.data && event.data.checkout;
  const total =
    checkout && checkout.totalPrice && checkout.totalPrice.amount
      ? String(checkout.totalPrice.amount)
      : "";
  const first = checkout && checkout.lineItems && checkout.lineItems[0];
  const title =
    (first && first.title) ||
    (first && first.variant && first.variant.product && first.variant.product.title) ||
    "";
  const firstName =
    (checkout &&
      checkout.billingAddress &&
      checkout.billingAddress.firstName) ||
    (checkout &&
      checkout.shippingAddress &&
      checkout.shippingAddress.firstName) ||
    "";
  send("purchase", { total, productTitle: title, firstName });
});
