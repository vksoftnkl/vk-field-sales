# VKSMAN — login, customers, customer detail, ledger

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
  - Tap a shop → **Customer detail**: address, mobiles (tap 1 / 2 to call), type, price level,
    freight, cooly, what they owe as of the last Sync, the actions, and the recent sales bills.
    - ✎ → **Edit customer**: the two mobiles, Aadhaar and PAN (name and address are VK Nex's).
      Saved on the phone (works offline), counted on Upload, sent by the next Sync.
    - **Ledger** → **Ledger statement**: opening balance, each voucher with its running balance,
      closing balance. Opens on this week; **Change** → Date range (today … last year, weeks
      Sunday–Saturday, years April–March) or **Custom dates** (dd-mm-yyyy or the calendar).
      Read from the copy Sync brings, so it works offline.
    - **Order** (canvas page "3 · Orders"): Choose company (only with more than one), **Order
      entry** (every unit the company sells, at the customer's price level, with MRP, cooly,
      freight and stock as of the last Sync; search, group / brand filter, qty per row),
      **Order item** (price level, qty, price, disc % or ₹ per unit, promotion, line total; not
      below VK Nex's minimum price) and **Order summary** (qty still editable, cooly, freight,
      total, vehicle no., remarks, **Save order**). Saved on the phone (`sale_order`), counted on
      Upload, sent by the next Sync. Total = lines + cooly + freight, as in the Qt app.
    - **Check in** (no order): reason (English + Tamil), remarks and the GPS position, saved on the
      phone (`visits`) for the next Sync.
    - Sales, Receipt, Return say "not available yet".
- **Sync** (Upload button, or ☰ → Sync data): server address + Test connection, then **Sync now**
  signs in to VK Nex as the salesman (with this phone's device uid), brings areas / customer
  types / price levels, sends every waiting customer to `POST /api/v1/mobile/customers/create`,
  every edit to `PUT /api/v1/mobile/customers/update`, every order to
  `POST /api/v1/mobile/orders/create` and every check-in to `POST /api/v1/mobile/visits/create`,
  then brings all of VK Nex's customers, its companies, item groups, brands and items (with each
  company's prices and stock, `GET /mobile/items/options` + `/mobile/items/list`) and the ledgers
  (this and last financial year, VK Nex's Ledger Statement). Each one VK Nex accepts is marked
  synced; refusals stay waiting with the reason shown. The ledger needs a VK Nex user with the
  Ledger Statement right (menu 258) and a company.
- **This phone** on the Sync page shows the phone's device uid (`VKSMAN-…`, made once per
  install). VK Nex takes orders and check-ins only from a phone the office has added under that
  uid on VK Nex's **Device List** screen; until then they wait on the phone.
  Details: [docs/SYNC-API.md](docs/SYNC-API.md). Android builds allow plain HTTP to the server PC
  (`expo-build-properties`, needs a new build; Expo Go already allows it).
- The phone's `customers` table is a copy of VK Nex's `sales.customers` (same `cus_*` columns,
  from `ERP server/prisma/sales/customer.prisma`), plus phone-only `app_*` columns.
- **☰ menu**: salesman and company, Home, **Switch company** (Choose company sheet), Reports,
  Sync data, Settings, **Log out**.
- Not built yet, and they say so when tapped: Reports, Settings, and the Sales / Receipt / Return
  actions. Order prints nothing yet (printing is not back in the app).
  Only Sync talks to the server, and only when tapped. Pulling salesmen from VK Nex is not built
  yet.

## Test salesmen

Salesmen don't come from VK Nex yet, so the app puts three test salesmen into an empty phone
database ([src/db/test-salesmen.ts](src/db/test-salesmen.ts)):

| Salesman | Password |
| --- | --- |
| Karthik S | 1111 |
| Murugan K | 2222 |
| Priya R | 3333 |

Companies come from VK Nex on **Sync now** (`GET /mobile/items/options`); a phone has none until
its first Sync. Migration `0009_remove_test_companies` deletes the old test companies from phones
that had them.

There are no test shops. The customer list shows the shops added on the phone with **New
customer**; beats and customer types come from VK Nex on the first **Sync now**, so sync once
before adding a shop. Migration `0005_remove_test_customers` clears the old test shops, their
bills and the unused test beats and types from phones that had them.

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
| `npm run lint` | ESLint (`expo lint`) |
| `npm test` | Password, test data, search, money and customer-list tests (Node test runner) |
| `npm run db:generate` | New SQLite migration after editing `src/db/schema.ts` |

## Files

```
src/app/_layout.tsx   Start-up: database → test data → login page
src/app/index.tsx     Login page (the start page)
src/app/customers.tsx After login: customer list
src/app/customer/new.tsx  New customer form
src/app/customer/[id].tsx Customer detail; edit/[id].tsx Edit customer; ledger/[id].tsx Ledger statement
src/auth/             login / logout, scrypt password check (VK Nex format)
src/components/       ui.tsx (Button, TextField, PasswordField, SelectField, Chip), sheet.tsx (bottom sheets), app-menu.tsx, calendar-dialog.tsx
src/features/customers/  list and detail queries, visit status, filters, new / edit customer validation and save
src/features/ledger/     ledger statement from the downloaded years, Date range sheet, Custom dates dialog
src/features/company/    current company, Choose company sheet
src/db/               schema (users, companies, beats, types, customers, bills, fiscal years, ledger), migrations, test data
src/lib/              picker search, rupees, date ranges, multi-select ids, uuidv7, GST state codes
src/sync/             VK Nex client, customer upload / edits, order and check-in upload, customer / item / ledger download, Sync page logic
src/app/sync.tsx      Sync page
src/i18n/             English + Tamil
src/theme/            Maroon #8B1D1D / brass #C9A227
docs/SYNC-API.md      Server contract for Sync with VK Nex (customers, ledgers, items, orders, check-ins built; device-auth push/pull planned)
```

The full earlier app (customers, orders, sync, printing, GST) was removed on 2026-11-14.
A copy is in `../vk-field-sales-backup-2026-11-14-before-login-only.tar.gz`.
