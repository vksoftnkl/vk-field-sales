# VK Field Sales — Architecture

Offline salesman app (VKSMAN) for VK Nex ERP. Expo SDK 58 · React Native 0.88 · TypeScript.

## The one rule

**Screens never call the server.** They read and write the phone's SQLite database.
Everything works offline, sign-in included. The only network traffic is **Sync**, which the
salesman starts by tapping a button while on the office Wi-Fi. It talks to the VK Nex server PC
on the LAN, like the old Qt salesman app's Sync Device page.

```
┌──────────────────────────── Phone ─────────────────────────────┐
│                                                                │
│  Screens (expo-router)                                         │
│     │  read: useLiveQuery(…)        write: createOrder(…)      │
│     ▼                                    │                     │
│  ┌───────────────── SQLite (expo-sqlite + Drizzle) ─────────┐  │
│  │ masters: users, customers, items, item_prices (pulled)   │  │
│  │ documents: orders, order_lines          (created here)   │  │
│  │ outbox: upload queue   sync_cursors   device_meta        │  │
│  └──────────────────────────────────────────────────────────┘  │
│     ▲ pull (upsert + cursor, 1 tx/page)   │ push (batches of 25)│
│  ┌──┴────────────── Sync engine (src/sync) ─▼───────────────┐   │
│  │ ONE trigger: the salesman taps Sync                      │   │
│  │ (Sync tab, pull-to-refresh on Customers, Server settings,│   │
│  │  login screen of a new phone). No timers, no background. │   │
│  └──────────────────────────────────────────────────────────┘   │
│  Keystore (expo-secure-store): session, device id, device key   │
└─────────────────────────────────┬──────────────────────────────┘
                                  │ http://<server-ip>:3011/api/v1  (office LAN)
┌─────────────────────────────────▼──────────────────────────────┐
│ VK Nex NestJS on the server PC — NEW mobile module:            │
│   POST /mobile/devices/register                                │
│   POST /mobile/sync/push        GET /mobile/sync/pull/:scope   │
│ Trusts APPROVED devices (X-Device-Id + X-Device-Key)           │
│ PostgreSQL: recalculates GST, posts stock + accounts           │
└────────────────────────────────────────────────────────────────┘
```

## First run on a new phone

1. Login screen → gear icon → **Server settings**: enter the server PC's IP (and port if not
   3011) → *Test connection* → *Save*.
2. Tap **Sync**. The phone registers itself and VK Nex shows it as `PENDING`.
3. The office approves the device in VK Nex. Match the 8-character device id shown in Server
   settings.
4. Tap **Sync** again. The salesmen, customers, items and prices download.
5. Pick your name, enter your VK Nex password, and log in. From now on the app works offline.

## Sign-in (offline)

- The salesman list comes from the `users` pull scope. The login screen shows it as a picker
  (`src/app/login.tsx`). An optional **second salesman** (multi-user mode) can be added, as in
  the Qt app. Only the first salesman's password is checked. Orders carry `createdBy` and
  `secondUserId`.
- Passwords are checked on the phone against VK Nex's own `scrypt$<salt>$<hash>`
  (`src/auth/password.ts`, tested against Node's scrypt in `password.test.ts`).
- The session lives in the Keystore and survives restarts. After every sync it is re-checked:
  if the salesman was disabled in VK Nex, or the phone was blocked, the app signs out.
- A phone the office has `BLOCKED` (or told to `WIPE`) refuses sign-in, even offline, until a
  later sync says `APPROVED`.

## Folder layout

```
index.ts                  Entry: loads i18n, then expo-router
app.config.ts             App name, Android package, permissions, plugins (cleartext HTTP for the LAN)
eas.json                  dev / preview / production builds
drizzle/                  Generated SQL migrations (npm run db:generate) — commit these
docs/                     This file + SYNC-API.md (server contract)
src/
  app/                    ROUTES ONLY (expo-router). Every file here is a screen.
    _layout.tsx           Boot: migrate DB → restore session → Stack.Protected auth gate
    login.tsx             Pick salesman (+ optional second) + password, offline
    settings.tsx          Server IP/port, Test connection, Sync, device id (open before sign-in)
    (app)/_layout.tsx     Bottom tabs
    (app)/index.tsx       Today: pending/rejected counts, last sync
    (app)/customers.tsx   Customer search → tap opens New Order (pull down = Sync)
    (app)/orders.tsx      Orders with QUEUED / SYNCED / REJECTED status
    (app)/sync.tsx        Sync button, server address, upload queue, errors, retry
    (app)/more.tsx        Profile, server settings, test print, language, logout
    order/new.tsx         Order entry with live GST totals
  api/                    http.ts (fetch + timeout + device headers), endpoints.ts, types.ts
  auth/                   keystore, device id/key, offline login, scrypt password check
  config/                 env.ts (constants), server.ts (saved server address)
  db/                     schema.ts, client.ts, migrate.ts, meta.ts (key/value)
  domain/pricing/         Pure GST engine (no RN imports) + node tests
  features/               Per-feature data access (orders/, masters/) — add sales/, receipts/…
  sync/                   engine, outbox, push, pull, ack-handlers, useSyncEvents
  store/                  Redux Toolkit: session + sync UI state only
  printing/               ESC/POS builder + pluggable Bluetooth transport
  components/             ui.tsx (Button, Field, PasswordField, SelectField, Card…), SyncPanel
  theme/                  Maroon #8B1D1D / brass #C9A227, spacing, fonts
  i18n/                   English + Tamil
```

## Data rules

| Rule | Why |
| --- | --- |
| Money = integer **paise**, rates = **basis points** (18% = 1800) | No floating-point rounding errors |
| Phone documents use a **client UUIDv7** as primary key | Server upserts on it → re-sending is always safe |
| Document + its outbox row are saved in **one transaction** | A bill can't be saved without being queued (or vice-versa) |
| A row leaves the outbox only on a **per-record ACK** | One bad record never blocks or loses the others |
| Server **recalculates** totals and posts stock/accounts | Phone totals are for display; VK Nex is the source of truth |
| Pull writes a page of rows **and** its cursor in one transaction | A crash mid-pull never skips data |
| Session, device id and device key live in the **Keystore**, not SQLite | Safe even if the DB file is copied |
| Password hashes are kept only for **active** users | A disabled user's hash is deleted at the next sync |
| Redux holds **session/UI state only** | Business data is read live from SQLite |

## Outbox states

```
PENDING ──claim──▶ SENDING ──ACKED──▶ ACKED (pruned after 7 days)
   ▲                  │
   │                  ├──REJECTED──▶ REJECTED ──"Retry" button──▶ PENDING
   └──server PC unreachable / 5xx / RETRY: sent again at the next Sync
```
No backoff timer: every Sync sends everything PENDING. Within one run each row is tried once.
SENDING rows left behind by a killed app are reset to PENDING on the next sync.

## Adding a new document type (e.g. van-sale bill)

1. Add tables to `src/db/schema.ts` → `npm run db:generate`.
2. Create `src/features/sales/sale-repo.ts` with `createSale()` that inserts the document
   and calls `enqueue(tx, 'sale', uuid, payload)` inside the same `db.transaction`.
3. Put `createdBy` (and `secondUserId`) from the session into the document and its payload.
4. Add an `ackHandlers.sale` entry (set server doc no / status).
5. Handle `entity: 'sale'` in the NestJS push endpoint.
6. Add the screen under `src/app/`.

## Build & run

Bluetooth printing needs native code, so the app runs as a **development build**, not Expo Go:

```bash
npm install
npm run build:dev             # EAS cloud build → install the APK on the phone (once)
npm start                     # Metro; open the dev build on the phone (same Wi-Fi as this PC)
```
Then follow "First run on a new phone" above.
Release: `npm run build:prod` (AAB) then `npx eas-cli@latest submit -p android`.
