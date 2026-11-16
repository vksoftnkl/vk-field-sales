# VKSMAN — login, customer list, new customer

Salesman app for **VK Nex ERP**, built up screen by screen from the approved designs
("VKSMAN — All Screens Review" canvas). It uses Expo SDK 58, React Native 0.88, TypeScript,
expo-router, SQLite (expo-sqlite + Drizzle) and Redux Toolkit.

- The app always opens on the login page. Pick a salesman (plus an optional second salesman),
  type the password, tap **Log in**. The password is checked on the phone.
- **Customers** (home): shops of the ticked beats with what they owe (bill count, oldest bill)
  and a visit-status chip. Search by name, area or phone.
  - Filter button → **Show customers**: All / Un-billed / No collection, with counts.
  - **Beat** and **Type** chips → tick one or more (Select all, Clear, Apply). The beats ticked
    last are remembered on the phone.
  - **New customer** → VK Nex's customer fields (name, type, beat, address, state, phones, GST type,
    GST no., PAN, Aadhaar) with the server's own checks. Saved on the phone (works offline) and
    counted on the **Upload** button until Sync sends it.
- The phone's `customers` table is a copy of VK Nex's `sales.customers` (same `cus_*` columns,
  from `ERP server/prisma/sales/customer.prisma`), plus phone-only `app_*` columns.
- **☰ menu**: salesman and company, Home, **Switch company** (Choose company sheet), Reports,
  Sync data, Settings, **Log out**.
- Not built yet, and they say so when tapped: Upload, Reports, Sync data, Settings. Tapping a
  shop does nothing yet. Nothing talks to a server.

## Test salesmen

Sync with VK Nex is not built yet, so the app puts three test salesmen into an empty phone
database ([src/db/test-salesmen.ts](src/db/test-salesmen.ts)):

| Salesman | Password |
| --- | --- |
| Karthik S | 1111 |
| Murugan K | 2222 |
| Priya R | 3333 |

It also adds test companies, beats (Namakkal East, Namakkal West, Rasipuram), customer types and
27 shops with unpaid bills ([src/db/test-customers.ts](src/db/test-customers.ts)). Namakkal East
matches the mockups: its first seven shops, and filter counts 18 / 11 / 14. Changing the test
shops? Bump `TEST_CUSTOMERS_VERSION` and phones reload them (unless they hold real customers).

Remove `src/db/test-salesmen.ts`, `src/db/test-customers.ts` and `src/db/seed.ts` when real
salesmen and customers come from Sync.

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
| `npm run lint` | ESLint (`expo lint`) |
| `npm test` | Password, test data, search, money and customer-list tests (Node test runner) |
| `npm run db:generate` | New SQLite migration after editing `src/db/schema.ts` |

## Files

```
src/app/_layout.tsx   Start-up: database → test data → login page
src/app/index.tsx     Login page (the start page)
src/app/customers.tsx After login: customer list
src/app/customer/new.tsx  New customer form
src/auth/             login / logout, scrypt password check (VK Nex format)
src/components/       ui.tsx (Button, TextField, PasswordField, SelectField, Chip), sheet.tsx (bottom sheets), app-menu.tsx
src/features/customers/  list queries, visit status, filters, new-customer validation and save
src/features/company/    current company, Choose company sheet
src/db/               schema (users, companies, beats, types, customers, bills), migrations, test data
src/lib/              picker search, rupees, multi-select ids, uuidv7, GST state codes
src/i18n/             English + Tamil
src/theme/            Maroon #8B1D1D / brass #C9A227
docs/SYNC-API.md      Server contract for the future Sync with VK Nex
```

The full earlier app (customers, orders, sync, printing, GST) was removed on 2026-11-14.
A copy is in `../vk-field-sales-backup-2026-11-14-before-login-only.tar.gz`.
