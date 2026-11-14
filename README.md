# VK Field Sales

Offline salesman app (**VKSMAN**) for **VK Nex ERP**. It uses Expo SDK 58, React Native 0.88,
TypeScript, expo-router, SQLite (expo-sqlite + Drizzle) and Redux Toolkit.

Everything runs on the phone, sign-in included. The phone only talks to the **VK Nex server PC
on the office LAN**, and only when the salesman taps **Sync**. This works the same way as the
old Qt salesman app.

- Architecture & folder guide: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Server contract for the NestJS mobile module: [docs/SYNC-API.md](docs/SYNC-API.md)

## Quick start

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest init         # links the project, sets EAS project id
npm run build:dev               # one-time dev build APK (needed for Bluetooth later)
npm start                       # then open the dev build on the phone
```

On the phone: tap the gear on the login screen to open **Server settings**. Enter the server
PC's IP and tap **Save**, then **Sync**. Next, approve the device in VK Nex and tap **Sync**
again. Then pick your name and log in.

Use the development build as the normal way to run the app. The Bluetooth printer module will
need it later.

## Scripts

| Script | Does |
| --- | --- |
| `npm start` | Metro for the dev build |
| `npm run start:go` | Metro for the Expo Go app (quick testing; no Bluetooth printing) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | GST pricing engine + offline password check tests (Node test runner) |
| `npm run db:generate` | New SQLite migration after editing `src/db/schema.ts` |
| `npm run build:dev / build:preview / build:prod` | EAS Android builds |

## What works in this skeleton

- Offline login: pick a salesman (plus an optional second salesman) and enter the VK Nex password, checked on the phone
- Server settings on the phone: IP and port, Test connection, device id for office approval
- Users, customers and items pulled into SQLite with per-scope cursors; instant local search (FlashList)
- New order with live GST totals (CGST/SGST vs IGST by state code, inclusive/exclusive rates, cess, round-off)
- Order + outbox row saved atomically; uploaded when the salesman taps Sync
- Sync tab showing every unsent record, its error, and a retry button
- English + Tamil UI, maroon/brass theme, ESC/POS builder with a console printer stand-in

## Next steps

1. Build the NestJS `mobile` module from `docs/SYNC-API.md`: device approval, push, and pull (including the `users` scope).
2. Add a Bluetooth Classic transport in `src/printing/` and call `setPrinterTransport()` at startup.
3. Add van-sale bills, receipts and returns following "Adding a new document type" in the architecture doc.
4. Move `src/domain/pricing` into a shared package so NestJS uses the exact same GST code.
