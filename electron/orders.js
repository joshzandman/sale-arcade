function startOrderPoll(env, { getLastId, setLastId, onSale }) {
  const store = env.SHOPIFY_STORE;
  const token = env.SHOPIFY_ACCESS_TOKEN;
  if (!store || !token) return () => {};

  let primed = Boolean(getLastId());

  async function tick() {
    try {
      const url = `https://${store}/admin/api/2025-01/orders.json?status=any&financial_status=paid&limit=5`;
      const res = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token },
      });
      if (!res.ok) return;
      const data = await res.json();
      const orders = data.orders || [];
      if (!primed) {
        if (orders[0]) setLastId(String(orders[0].id));
        primed = true;
        return;
      }
      const last = getLastId();
      const unseen = [];
      for (const order of orders) {
        if (String(order.id) === String(last)) break;
        unseen.push(order);
      }
      unseen.reverse();
      for (const order of unseen) {
        const item = order.line_items && order.line_items[0];
        onSale({
          id: String(order.id),
          total: order.total_price,
          productTitle: (item && item.title) || "Order",
        });
        setLastId(String(order.id));
      }
    } catch (err) {
      console.error("order poll failed", err);
    }
  }

  tick();
  const timer = setInterval(tick, 15000);
  return () => clearInterval(timer);
}

module.exports = { startOrderPoll };
