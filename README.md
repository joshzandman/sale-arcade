# Sale Arcade

A click-through 16-bit overlay for your Mac. One browser session is one NPC for the whole visit.

| Customer | Same NPC |
| --- | --- |
| Lands on the store | Walks in through the door |
| Adds to cart | Shopping cart appears with that NPC |
| Pays | Fireworks around that NPC; they stay on stage |
| Leaves the site (~25s without heartbeats) | Walks back through the door |
| Logged-in member | First name in a chat bubble that follows them |

## Run the overlay

```bash
cd ~/sale-arcade
cp .env.example .env
npm install
npm start
```

The app lives in the menu bar (no dock icon). Use **Test: visitor walks in**, **Test: add to cart**, and **Test: fireworks / purchase** to try it without live traffic.

Quit from the menu bar.

## Live store traffic

The Mac cannot receive Shopify events on localhost. A tiny Cloudflare Worker relays `page_viewed` / add-to-cart / purchase to the overlay.

1. Create a free Cloudflare account and install Wrangler (`npm i -g wrangler`).
2. Pick a long shared secret and put it in `.env` as `SHARED_SECRET`.
3. From `~/sale-arcade/worker`:

```bash
npx wrangler login
npx wrangler secret put SHARED_SECRET
npx wrangler deploy
```

4. Put the worker WebSocket URL in `.env`:

```
WORKER_URL=wss://sale-arcade.<your-subdomain>.workers.dev/ws
SHARED_SECRET=<the same secret>
```

5. Edit `pixel.js`: set `ENDPOINT` to `https://sale-arcade.<your-subdomain>.workers.dev/event` and `SECRET` to the same value.
6. Shopify Admin → **Settings → Customer events → Add custom pixel**. Paste `pixel.js`. Permission: **Analytics**. Connect it.

Restart `npm start`. Browse your store — you should walk in as an NPC.

7. **Member names:** paste `theme-snippet.liquid` before `</body>` in `theme.liquid`. Logged-in customers get a name bubble. Guests have no bubble. Checkout first names still show on purchase even without the snippet.

## Optional: missed-checkout backup

If an ad blocker eats the pixel, the overlay can still boom on paid orders.

Shopify Admin → **Settings → Apps → Develop apps** → create `Desktop Fireworks` → Admin API scope `read_orders` → install → paste the token:

```
SHOPIFY_STORE=joshzandman.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_...
```

## Notes

- The overlay is click-through. You can keep working.
- Visitors who decline analytics cookies will not appear.
- Nothing draws while the Mac is asleep or the app is quit.
- Max 6 shoppers on stage; extras wait offstage.
