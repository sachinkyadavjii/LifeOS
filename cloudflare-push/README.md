# LifeOS background push reminders

The main LifeOS site is static. This Cloudflare Worker and D1 database deliver reminder notifications while the app is closed. LifeOS does not send diary entries, habit history, health logs, or profile data to this service; it stores only a device push subscription, a hash of the device token, timezone, and reminder names/times.

## Existing LifeOS deployment

The push Worker is deployed at `https://lifeos-push.lifeos-push-worker.workers.dev`, with its D1 database and VAPID keys configured. The app's `push-config.js` points to this Worker. Once the latest GitHub Pages build finishes, install/open LifeOS on each device and choose **Daily reminders → Enable & test**. Each device must grant notification permission separately.

## Deploy a separate copy

1. Install Node.js LTS and open a terminal in this folder.
2. Run `npm install`, then `npx wrangler login`.
3. Create your own D1 database with `npx wrangler d1 create lifeos-push`. Replace `account_id` and `database_id` in `wrangler.jsonc` with your account and new database IDs.
4. Apply the schema: `npx wrangler d1 execute lifeos-push --remote --file=./schema.sql`.
5. Generate a VAPID pair using `node generate-vapid-keys.mjs`. Keep the private key secret. Run `npx wrangler secret put VAPID_PUBLIC_KEY` and `npx wrangler secret put VAPID_PRIVATE_KEY`, pasting each value when prompted. Never commit the private key.
6. Make sure the Cloudflare account has a `workers.dev` subdomain, then run `npx wrangler deploy`.
7. In the repository root, set `window.LIFEOS_PUSH_API` in `push-config.js` to your Worker URL, then commit and push.
8. Install/open the app on each device, then choose **Daily reminders → Enable & test**. On iPhone/iPad, add the site to the Home Screen first; web push requires iOS/iPadOS 16.4 or newer.

Cron checks once per minute. Actual delivery timing still depends on the browser's push service, device connection, notification permissions, OS settings, and battery restrictions. Cloudflare free plan quotas can change; exceeding them may pause reminders until quotas reset or the plan changes.
