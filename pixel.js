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
    if (cookie) {
      return decodeURIComponent(String(cookie).replace(/\+/g, " ")).trim();
    }
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
      currentPage,
      extra || {}
    );
    if (!body.firstName && cookieName) body.firstName = cookieName;
    if (body.firstName) body.firstName = String(body.firstName).slice(0, 40);
    if (body.lastName) body.lastName = String(body.lastName).slice(0, 40);
    if (body.firstName && body.lastName) {
      body.firstName = (body.firstName + " " + body.lastName).slice(0, 40);
      body.lastName = "";
    }
    fetch(ENDPOINT, {
      method: "POST",
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(function () {});
  });
}

let beating = false;
let currentPage = { pageUrl: "", pageTitle: "", productTitle: "" };

function pageInfo(event) {
  let pageUrl = pick(event, ["context", "document", "location", "href"]);
  if (!pageUrl) pageUrl = pick(event, ["context", "window", "location", "href"]);
  const pageTitle = pick(event, ["context", "document", "title"]);
  return { pageUrl: pageUrl, pageTitle: pageTitle };
}

function startHeartbeat() {
  if (beating) return;
  beating = true;
  try {
    setInterval(function () {
      send("heartbeat", currentPage);
    }, 10000);
  } catch (err) {
    return;
  }
}

analytics.subscribe("page_viewed", function (event) {
  currentPage = Object.assign(pageInfo(event), { productTitle: "" });
  send("enter", currentPage);
  startHeartbeat();
});

analytics.subscribe("product_viewed", function (event) {
  const title = pick(event, ["data", "productVariant", "product", "title"]);
  currentPage = Object.assign(pageInfo(event), { productTitle: title });
  send("view", currentPage);
});

function cartLinePayload(event) {
  let imageUrl = pick(event, ["data", "cartLine", "merchandise", "image", "src"]);
  if (!imageUrl) {
    imageUrl = pick(event, ["data", "cartLine", "merchandise", "image", "url"]);
  }
  if (imageUrl.indexOf("//") === 0) imageUrl = "https:" + imageUrl;
  return {
    productTitle: pick(event, ["data", "cartLine", "merchandise", "product", "title"]),
    productType: pick(event, ["data", "cartLine", "merchandise", "product", "type"]),
    imageUrl: imageUrl,
  };
}

analytics.subscribe("product_added_to_cart", function (event) {
  send("cart", cartLinePayload(event));
});

analytics.subscribe("product_removed_from_cart", function (event) {
  send("cart_remove", cartLinePayload(event));
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
  let lastName = pick(checkout, ["billingAddress", "lastName"]);
  if (!lastName) {
    lastName = pick(checkout, ["shippingAddress", "lastName"]);
  }
  send("purchase", {
    total: total,
    productTitle: title,
    firstName: firstName,
    lastName: lastName,
  });
});
