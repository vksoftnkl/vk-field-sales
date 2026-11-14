# VKSMAN — login only

Salesman app for **VK Nex ERP**, cut down to the **login page** for now. It uses Expo SDK 58,
React Native 0.88, TypeScript, expo-router, SQLite (expo-sqlite + Drizzle) and Redux Toolkit.

- The app always opens on the login page.
- Pick a salesman (plus an optional second salesman), type the password, tap **Log in**.
- A correct password opens a small welcome page with **Log out**.
- The password is checked on the phone. Nothing talks to a server.

## Test salesmen

Sync with VK Nex is not built yet, so the app puts three test salesmen into an empty phone
database ([src/db/test-salesmen.ts](src/db/test-salesmen.ts)):

| Salesman | Password |
| --- | --- |
| Karthik S | 1111 |
| Murugan K | 2222 |
| Priya R | 3333 |

Remove `src/db/test-salesmen.ts` and `src/db/seed.ts` when real salesmen come from Sync.

## Run it

Phone and PC on the same Wi-Fi, **Expo Go** installed on the phone:

```bash
npm install
npm run start:go      # scan the QR code with Expo Go
```

For a development build instead (needed later for Bluetooth printing):

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npm run build:dev     # install the APK on the phone once
npm start
```

## Scripts

| Script | Does |
| --- | --- |
| `npm start` | Metro for the dev build |
| `npm run start:go` | Metro for Expo Go |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Password check, test salesmen and picker search tests (Node test runner) |
| `npm run db:generate` | New SQLite migration after editing `src/db/schema.ts` |

## Files

```
src/app/_layout.tsx   Start-up: database → test salesmen → login page
src/app/index.tsx     Login page (the start page)
src/app/welcome.tsx   After login: name + Log out
src/auth/             login / logout, scrypt password check (VK Nex format)
src/components/ui.tsx Button, PasswordField, SelectField (bottom sheet with search)
src/db/               schema (users, device_meta), migrations, test salesmen
src/i18n/             English + Tamil
src/theme/            Maroon #8B1D1D / brass #C9A227
docs/SYNC-API.md      Server contract for the future Sync with VK Nex
```

The full earlier app (customers, orders, sync, printing, GST) was removed on 2026-11-14.
A copy is in `../vk-field-sales-backup-2026-11-14-before-login-only.tar.gz`.
