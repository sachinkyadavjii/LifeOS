# LifeOS background push setup (Cloudflare free tier)

The main LifeOS site is static. To deliver reminders while a browser is closed, deploy this small Cloudflare Worker and D1 database. No LifeOS diary, habit history, health logs, or profile data is sent: the push service stores only a device subscription, a device token hash, timezone, and reminder names/times.

## One-time setup

1. Create a free Cloudflare account and install Node.js (LTS) on your computer.
2. Open a terminal in this `cloudflare-push` folder and run `npm install`.
3. Sign in: `npx wrangler login`.
4. Create the database: `npx wrangler d1 create lifeos-push`. Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_DATABASE_ID`.
5. Apply the schema: `npx wrangler d1 execute lifeos-push --remote --file=./schema.sql`.
6. Generate a VAPID key pair: `node generate-vapid-keys.mjs`. Keep the private key secret. Add each value using the commands below, pasting the value when prompted:
   - `npx wrangler secret put VAPID_PUBLIC_KEY`
   - `npx wrangler secret put VAPID_PRIVATE_KEY`
   - `npx wrangler secret put VAPID_SUBJECT`
   For the subject value, enter `mailto:your-email@example.com` (use your own email).
7. Deploy: `npx wrangler deploy`. Copy the Worker URL shown, for example `https://lifeos-push.<your-account>.workers.dev`.
8. In the repository root, edit `push-config.js` and set `window.LIFEOS_PUSH_API` to that Worker URL, without a trailing slash. Commit/push the change to GitHub.
9. Open the HTTPS LifeOS site on each phone, install it to the home screen, then open the installed app and use **Daily reminders → Enable & test**. Allow notifications. On iPhone/iPad, install to the Home Screen first; push notifications require iOS/iPadOS 16.4 or newer.

## Important

- Every phone/browser needs its own permission and subscription. Reminder schedules are copied to that device's push service when saved.
- Cron checks every minute. Delivery timing and support still depend on the device/browser's push service, network, OS notification settings, and battery restrictions.
- Cloudflare free quotas can change; review the current Workers and D1 limits. If quotas are exceeded, scheduled reminders may pause until the quota resets or the plan changes.
- Keep VAPID private keys and device tokens out of GitHub. Only the public VAPID key is sent to a browser, but this configuration keeps both VAPID values server-side.
- To disconnect a phone, choose **Turn off push on this device** on its reminder page.
