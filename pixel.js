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

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function sessionId() {
  let i = 0;
  while (i < 12) {
    try {
      const cookie = await browser.cookie.get("sale_arcade_sid");
      if (cookie) {
        themeOwnsPresence = true;
        return String(cookie);
      }
    } catch (err) {}
    i += 1;
    if (i < 12) await sleep(50);
  }
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

let themeOwnsPresence = false;

function isCheckoutUrl(url) {
  const value = String(url || "").toLowerCase();
  return (
    value.indexOf("/checkout") >= 0 ||
    value.indexOf("checkouts") >= 0 ||
    value.indexOf("thank_you") >= 0
  );
}

function send(type, extra) {
  Promise.all([sessionId(), memberName()]).then(function (parts) {
    const sid = parts[0];
    const cookieName = parts[1];
    const pageUrl = (extra && extra.pageUrl) || currentPage.pageUrl || "";
    const onCheckout = isCheckoutUrl(pageUrl);
    if (
      themeOwnsPresence &&
      !onCheckout &&
      (type === "enter" || type === "heartbeat" || type === "leave")
    ) {
      return;
    }
    const body = Object.assign(
      { sessionId: sid, type: type, secret: SECRET },
      currentPage,
      extra || {}
    );
    if (type === "cart_remove" || type === "cart_sync") {
      body.productTitle = extra && extra.productTitle ? extra.productTitle : "";
    }
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
let heartbeatTimer = null;
let leaveWatching = false;
let currentPage = {
  pageUrl: "",
  pageTitle: "",
  productTitle: "",
  collectionTitle: "",
};

function pageInfo(event) {
  let pageUrl = pick(event, ["context", "document", "location", "href"]);
  if (!pageUrl) pageUrl = pick(event, ["context", "window", "location", "href"]);
  const pageTitle = pick(event, ["context", "document", "title"]);
  return { pageUrl: pageUrl, pageTitle: pageTitle };
}

function stopHeartbeat() {
  beating = false;
  if (heartbeatTimer) {
    try {
      clearInterval(heartbeatTimer);
    } catch (err) {}
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  if (beating) return;
  beating = true;
  try {
    heartbeatTimer = setInterval(function () {
      send("heartbeat", currentPage);
    }, 10000);
  } catch (err) {
    beating = false;
    return;
  }
}

function sendLeave() {
  stopHeartbeat();
  send("leave");
}

function startLeaveWatch() {
  if (leaveWatching) return;
  leaveWatching = true;
  function onHide() {
    sendLeave();
  }
  try {
    self.addEventListener("pagehide", onHide);
  } catch (err) {}
  try {
    self.addEventListener("beforeunload", onHide);
  } catch (err) {}
}

analytics.subscribe("form_submitted", function (event) {
  const cart = payloadFromCart(currentCart());
  send("enter", cart.items.length ? cart : {});
});

analytics.subscribe("page_viewed", function (event) {
  currentPage = Object.assign(pageInfo(event), {
    productTitle: "",
    collectionTitle: "",
  });
  const cart = payloadFromCart(currentCart());
  send("enter", cart.items.length ? cart : {});
  startHeartbeat();
  startLeaveWatch();
});

analytics.subscribe("product_viewed", function (event) {
  const title = pick(event, ["data", "productVariant", "product", "title"]);
  currentPage = Object.assign(pageInfo(event), {
    productTitle: title,
    collectionTitle: "",
  });
  send("view", currentPage);
});

analytics.subscribe("collection_viewed", function (event) {
  const title = pick(event, ["data", "collection", "title"]);
  currentPage = Object.assign(pageInfo(event), {
    productTitle: "",
    collectionTitle: title,
  });
  send("browse", currentPage);
});

function linePayload(line) {
  if (!line) {
    return { productTitle: "", productType: "", imageUrl: "", quantity: 1 };
  }
  const merch = line.merchandise || {};
  const product = merch.product || {};
  let imageUrl = "";
  if (merch.image) {
    imageUrl = merch.image.src || merch.image.url || "";
  }
  if (imageUrl.indexOf("//") === 0) imageUrl = "https:" + imageUrl;
  let title = product.title || "";
  if (!title) title = merch.title || "";
  return {
    productTitle: title,
    productType: product.type || "",
    imageUrl: imageUrl,
    quantity: line.quantity || 1,
  };
}

function cartLinePayload(event) {
  const line = event.data && event.data.cartLine;
  return linePayload(line);
}

function cartLines(cart) {
  if (!cart) return [];
  if (Array.isArray(cart.lines)) return cart.lines;
  const edges = cart.lines && cart.lines.edges;
  if (!Array.isArray(edges)) return [];
  const lines = [];
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i];
    if (edge && edge.node) lines.push(edge.node);
    else if (edge) lines.push(edge);
  }
  return lines;
}

function payloadFromCart(cart) {
  const lines = cartLines(cart);
  const items = [];
  for (let i = 0; i < lines.length && items.length < 8; i += 1) {
    const item = linePayload(lines[i]);
    if (item.productTitle || item.imageUrl) items.push(item);
  }
  let totalQuantity = -1;
  if (cart && cart.totalQuantity !== undefined && cart.totalQuantity !== null) {
    totalQuantity = Number(cart.totalQuantity);
  } else if (items.length) {
    totalQuantity = items.length;
  }
  return { items: items, totalQuantity: totalQuantity };
}

function currentCart() {
  try {
    if (typeof init !== "undefined" && init && init.data) return init.data.cart || null;
  } catch (err) {
    return null;
  }
  return null;
}

function cartItemsPayload(event) {
  return payloadFromCart(event.data && event.data.cart);
}

analytics.subscribe("product_added_to_cart", function (event) {
  send("cart", cartLinePayload(event));
});

analytics.subscribe("product_removed_from_cart", function (event) {
  send("cart_remove", cartLinePayload(event));
});

analytics.subscribe("cart_viewed", function (event) {
  const payload = cartItemsPayload(event);
  if (!payload.items.length && payload.totalQuantity !== 0) return;
  send("cart_sync", payload);
});

analytics.subscribe("checkout_started", function (event) {
  const checkout = event.data && event.data.checkout;
  send("checkout", {
    pageUrl: (currentPage && currentPage.pageUrl) || "https://joshzandman.com/checkouts",
    pageTitle: "Checkout",
    firstName:
      pick(checkout, ["billingAddress", "firstName"]) ||
      pick(checkout, ["shippingAddress", "firstName"]),
    lastName:
      pick(checkout, ["billingAddress", "lastName"]) ||
      pick(checkout, ["shippingAddress", "lastName"]),
  });
});

analytics.subscribe("checkout_contact_info_submitted", function () {
  send("checkout", { pageUrl: currentPage.pageUrl || "https://joshzandman.com/checkouts" });
});

analytics.subscribe("checkout_address_info_submitted", function () {
  send("checkout", { pageUrl: currentPage.pageUrl || "https://joshzandman.com/checkouts" });
});

analytics.subscribe("checkout_shipping_info_submitted", function () {
  send("checkout", { pageUrl: currentPage.pageUrl || "https://joshzandman.com/checkouts" });
});

analytics.subscribe("payment_info_submitted", function () {
  send("checkout", { pageUrl: currentPage.pageUrl || "https://joshzandman.com/checkouts" });
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
