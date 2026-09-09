export function sanitizeImageUrl(url) {
  if (!url) return undefined;
  let value = String(url).trim();
  if (value.indexOf("//") === 0) value = "https:" + value;
  if (value.indexOf("http://") === 0) value = "https://" + value.slice(7);
  if (value.indexOf("https://") !== 0) return undefined;
  if (value.length > 400) return undefined;
  return value;
}

export function sanitizeItems(raw) {
  if (!Array.isArray(raw)) return undefined;
  const items = [];
  for (const row of raw.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const rawTitle = row.productTitle || row.title;
    const productTitle = rawTitle ? String(rawTitle).slice(0, 80) : "";
    const imageUrl = sanitizeImageUrl(row.imageUrl);
    if (!productTitle && !imageUrl) continue;
    const qty = Number(row.quantity || row.qty);
    items.push({
      productTitle: productTitle || undefined,
      productType: row.productType
        ? String(row.productType).slice(0, 40)
        : undefined,
      imageUrl,
      quantity: Number.isFinite(qty) ? Math.min(99, Math.max(1, qty)) : 1,
    });
  }
  return items;
}

export function normalizePlace(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isHiddenLocation(cf) {
  if (!cf) return false;
  if (normalizePlace(cf.city) !== "council bluffs") return false;
  const region = normalizePlace(cf.region);
  const code = String(cf.regionCode || "").toUpperCase();
  const country = String(cf.country || "").toUpperCase();
  if (code === "IA" || region === "iowa" || region === "ia") return true;
  return !code && !region && (country === "US" || !country);
}

export const STORE_HOSTS = ["joshzandman.com", "joshzandman.myshopify.com"];
export const PRESENCE_TYPES = { enter: true, heartbeat: true, leave: true };

export function fromStorefront(request) {
  const origin = (request.headers.get("Origin") || "").toLowerCase();
  const referer = (request.headers.get("Referer") || "").toLowerCase();
  return STORE_HOSTS.some(
    (host) => origin.indexOf(host) >= 0 || referer.indexOf(host) >= 0
  );
}

export function eventNeedsAuth(type) {
  return !PRESENCE_TYPES[String(type)];
}
