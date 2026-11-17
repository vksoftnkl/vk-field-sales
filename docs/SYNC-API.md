# Sync API — what VK Nex (NestJS) must provide

The phone works fully offline. It talks to the **VK Nex server PC on the office LAN** only
when the salesman taps **Sync**. There is no user login on the server: salesmen sign in on the
phone against users downloaded during Sync, and the server trusts the **device** once the
office has approved it (the new version of the old Qt app's `/checkMacAddress`).

- Base URL: `http://<server-ip>:<port>/api/v1` or `https://<server-ip>:<port>/api/v1`. The
  address is typed on the phone's **Sync** page: `192.168.1.10:3012` means plain HTTP (default
  port `3012`); `https://192.168.1.10:3011` means HTTPS (default port `3011`). With no scheme typed, port
  `3011` alone (`192.168.1.10:3011`) also means HTTPS, since VK Nex gives plain HTTP there no reply. The phone keeps the
  scheme with the address (device_meta `serverScheme`; none saved = http).
- Port `3012` is VK Nex's **phone port** (`MOBILE_HTTP_PORT` in VK Nex's `.env`): plain HTTP
  beside its HTTPS port `3011`. Only `/health`, `/auth/login` and `/mobile/*` answer on the phone
  port; any other route the phone needs must be added to `PHONE_HTTP_ROUTES` in VK Nex's
  `src/main.ts`. The server PC's firewall must allow TCP 3012.
- Port `3011` serves every route over HTTPS. Its certificate is made by mkcert on the server PC
  (it lists the PC's LAN IPs), so a phone trusts it only after that PC's mkcert `rootCA.pem` is
  installed on the phone as a CA certificate (Android: Settings > Security > Encryption &
  credentials > Install a certificate > CA certificate). Never copy `rootCA-key.pem`. The Android
  build trusts certificates installed on the phone and keeps plain HTTP allowed, via
  `plugins/with-network-security.js` (needs a new build, not Expo Go). A real (Let's Encrypt)
  certificate on a hostname needs no install.
- Money in **paise**, rates in **basis points**.
- One sync = `register` → `push` → `pull users, customers, items, item_prices`.

## Device authentication (every `/mobile/*` route)

Every request carries two headers:

| Header | Value |
| --- | --- |
| `X-Device-Id` | UUIDv7 generated once per install, kept in the phone's Keystore |
| `X-Device-Key` | 64 hex chars (256 random bits), generated once per install, kept in the Keystore |

Server rules:

1. First time a device id is seen (`register`), create a `mobile_devices` row with status
   `PENDING` and store **sha256(X-Device-Key)** — never the key itself.
2. On every later request, look the device up by id and compare sha256 of the key header with
   the stored hash (constant-time). Mismatch → `403`.
3. Only `APPROVED` devices may push or pull. Others get their status back (see below) and
   nothing else.
4. Approve / block / wipe from the VK Nex desktop. The phone shows the last 8 characters of its
   device id (upper-case) in Server settings so the office can match it.

Use a Nest guard for this (e.g. `MobileDeviceGuard`) and mark the routes `@Public()` so the JWT
guard skips them.

## `GET /health` (existing, public)

Used by **Server settings → Test connection**. No device headers. Any 2xx = reachable.

## New: `POST /mobile/devices/register`

First call of every sync. Body:

```json
{ "deviceId": "0193…", "platform": "android", "model": "SM-A155F", "osVersion": "15", "appVersion": "1.0.0", "buildNumber": "12" }
```

Upsert `mobile_devices` (last seen, app version …). Response:

```json
{
  "status": "PENDING | APPROVED | BLOCKED | WIPE",
  "company": { "id": "uuid", "name": "VK Traders", "stateCode": "33", "branchId": "uuid" },
  "salesmanId": null,
  "invoiceSeries": "M01"
}
```

`company` may be omitted until the device is `APPROVED`. `company.stateCode` is the seller's GST
state; the phone uses it to choose CGST+SGST or IGST.

| status | Phone does |
| --- | --- |
| `PENDING` | Stops the sync, shows "waiting for approval" with its short device id |
| `APPROVED` | Continues: push, then pull |
| `BLOCKED` | Stops, signs out, refuses sign-in until a later sync says `APPROVED` |
| `WIPE` | As `BLOCKED`, and deletes downloaded users, customers, items and prices. Unsent orders are kept |

## New: `POST /mobile/sync/push`

```json
{
  "deviceId": "0193…",
  "records": [
    {
      "entity": "order",
      "clientUuid": "0193a1b2-…",
      "op": "UPSERT",
      "createdAt": "2026-11-14T10:22:05.123Z",
      "payload": {
        "clientUuid": "0193a1b2-…",
        "customerId": "uuid",
        "createdBy": "uuid (users.id of the salesman who signed in)",
        "secondUserId": "uuid or null (second salesman, multi-user mode)",
        "orderDate": "2026-11-14",
        "remarks": null,
        "lines": [{ "lineNo": 1, "itemId": "uuid", "qty": 2, "ratePaise": 10000, "discBp": 0 }],
        "deviceTotals": { "taxablePaise": 20000, "taxPaise": 3600, "roundOffPaise": 0, "totalPaise": 23600 }
      }
    }
  ]
}
```

There is no JWT, so the salesman comes from `payload.createdBy`. The server must check that this
user exists, is active and belongs to the device's company. Otherwise answer `REJECTED`.

Response: **one result per record**, never all-or-nothing:

```json
{
  "results": [
    { "entity": "order", "clientUuid": "0193a1b2-…", "status": "ACKED", "serverId": "uuid", "docNo": "SO1/25-26/0042" },
    { "entity": "order", "clientUuid": "0193a1c9-…", "status": "REJECTED", "error": "Customer is blocked" }
  ],
  "deviceStatus": "APPROVED"
}
```

| status | Meaning | Phone does |
| --- | --- | --- |
| `ACKED` | Saved (or already saved earlier) | Marks synced, stores server id + doc no |
| `REJECTED` | Business rule failed; resending won't help | Shows the error in the Sync tab; the salesman can retry after a fix |
| `RETRY` | Temporary (lock timeout, DB busy) | Sends it again at the next Sync |

### New customers from the phone (built, uses VK Nex's existing routes)

Customers added on the phone are saved there first (offline) with `app_pending_upload = 1`. When
the salesman taps **Sync now** (Sync page, from Upload or ☰ → Sync data), the phone:

1. `POST /api/v1/auth/login` with `usrLoginName` / `usrPassword` (the user and password typed at
   phone login, kept in memory only; the Sync page can take another VK Nex user) and
   `device_type: "Mobile"`. Every later call sends `Authorization: Bearer <access_token>`,
   `X-App-Platform: mobile` and `X-App-Version`; a 401 mid-run signs in again once.
2. `GET /api/v1/mobile/customers/options`: areas, customer groups and price levels are saved on
   the phone, so new customers point at ids VK Nex knows.
3. For each waiting customer, oldest first, `POST /api/v1/mobile/customers/create` with the
   `SaveCustomerDto` fields that have a value (no `cusId`: VK Nex makes the id). Fields:
   `cusName, cusGroupId, cusAreaId, cusContactPerson, cusAddr1, cusAddr2, cusAddr3, cusLandmark,
   cusCity, cusDistrict, cusStateName, cusStateCode, cusPin, cusPhone1, cusPhone2, cusWhatsappNo,
   cusEmail, cusGstType, cusGstNo, cusPanNo, cusAadharNo, cusPriceLevelId`.
   - `cusPriceLevelId`: salesmen don't choose one; the phone sends VK Nex's first price level
     (lowest id). The office can change it on the desktop.
4. Each customer VK Nex accepts is marked synced at once (one SQLite transaction): the phone's id
   is replaced by VK Nex's `cusId`, `cus_code` and `cus_sync_date` are set, the upload flag and
   error are cleared, and its unpaid bills move to the new id.
5. A refusal for that customer (400 / 404 / 409 / 422, e.g. `CUSTOMER_UNKNOWN_GROUP`) is stored in
   `app_sync_error`, shown on the Sync page, and the next customer is sent. No answer, 5xx, 401
   after the retry, 403 or 426 stops the run; the rest stay waiting for the next Sync.

**Lost answers.** The create route has no client id, so a request that VK Nex saved but whose
answer never arrived is sent again next time and refused as `CUSTOMER_NAME_EXISTS`. The phone then
searches `GET /mobile/customers/list?search=<name>` and, if a customer has the same name **and**
the same mobile or GSTIN, takes it as this one (marked synced with that id) instead of refusing.
A server-side `clientUuid` (below) would make this exact; worth adding to `/mobile/customers/create`.

### Edits, customers and ledgers (built, existing routes)

After the new customers, the same **Sync now** run goes on:

6. **Edits** (Edit customer: `cusPhone1`, `cusPhone2`, `cusAadharNo`, `cusPanNo`, flagged
   `app_pending_update = 1` on the phone). For each, oldest change first:
   `GET /api/v1/mobile/customers/get?cusId=` (VK Nex's current copy), then
   `PUT /api/v1/mobile/customers/update` with `cusId`, the five fields the update requires taken
   from VK Nex's copy (`cusStateName, cusStateCode, cusAreaId, cusGroupId, cusPriceLevelId`, so an
   office change since the last Sync is not overwritten) and only the fields the salesman changed
   (`app_edited_fields`; a cleared one is sent as `null`). VK Nex changes only the fields sent.
   Refusals are handled as for new customers; a customer whose edit is still waiting is not
   overwritten by the download, and an edit saved again while it was being sent stays waiting.
7. **Customers**: `GET /mobile/customers/list?page=&pageSize=200`, then `/mobile/customers/get`
   for each (the list has no area, type or address); saved in one transaction.
8. **Ledgers**, in the company VK Nex signed the user in to (the access token's `company_id`):
   `GET /api/v1/master-lookups/fiscal-years/by-company/:companyId`, then for each live customer and
   for the year holding today and the one before it,
   `GET /api/v1/reports/ledger-statement/vouchers?companyId&accYear&ledgerId=<cusId>&fromDate=<year's
   first day>&toDate=<today, or the year's last day>&page&pageSize=1000`. The phone keeps
   `broughtForward` (opening), each row (`voucherId, date, voucherTypeName, voucherNo, rowKind,
   particulars, narration, billRefs, debit, credit, balance, src.module, src.docType`) and the last
   page's `carriedForward` (closing), in exact paise, DR +. The whole ledger copy is replaced in one
   transaction. A customer refused with 400 / 404 (no ledger, another company's) is skipped; 403
   (`NO_MENU_RIGHT`: the user lacks the Ledger Statement right, menu 258) or no answer stops this
   step only — the customers are already saved.

The phone works out any date range from that copy: opening = the last running balance before the
range (or the year's opening), closing = the last one inside it. A range that crosses 31 March reads
each balance in its own year, as VK Nex never stitches two years. Recent bills on Customer detail
are the rows with `src.docType = 'SALE_BILL'`.

VK Nex's phone port (`MOBILE_HTTP_PORT`, plain HTTP) answers only allowlisted routes; for step 8,
`reports/ledger-statement/vouchers` and `master-lookups/fiscal-years/by-company/` were added to
`PHONE_HTTP_ROUTES` / `PHONE_HTTP_ROUTE_PREFIXES` in `ERP server/src/main.ts`.

### Idempotency (required)

The phone **will** resend records (timeouts, app killed mid-request). Add to each mobile-created table:

```sql
ALTER TABLE sales.sale_order ADD COLUMN so_client_uuid uuid, ADD COLUMN so_device_id uuid;
CREATE UNIQUE INDEX ux_so_client_uuid ON sales.sale_order (so_company_id, so_client_uuid)
  WHERE so_client_uuid IS NOT NULL;
```

Handler outline (one DB transaction **per record**, so one failure doesn't roll back the batch):

```ts
@Public()
@UseGuards(MobileDeviceGuard) // sets req.device (id, companyId, branchId, status)
@Post('push')
async push(@Body() dto: PushDto, @CurrentDevice() d: MobileDevice): Promise<PushResponse> {
  if (d.status !== 'APPROVED') return { results: [], deviceStatus: d.status };
  const results = [];
  for (const r of dto.records) {
    try {
      const existing = await this.findByClientUuid(r.entity, d.companyId, r.clientUuid);
      if (existing) { results.push({ ...key(r), status: 'ACKED', serverId: existing.id, docNo: existing.docNo }); continue; }
      const user = await this.users.assertActiveSalesman(d.companyId, r.payload.createdBy); // throws → REJECTED
      const saved = await this.prisma.$transaction((tx) => this.handlers[r.entity].create(tx, d, user, r.payload));
      // handler RECALCULATES GST with the shared pricing engine; compares with deviceTotals and flags mismatches
      results.push({ ...key(r), status: 'ACKED', serverId: saved.id, docNo: saved.docNo });
    } catch (e) {
      results.push({ ...key(r), status: isTransient(e) ? 'RETRY' : 'REJECTED', error: message(e) });
    }
  }
  return { results, deviceStatus: d.status };
}
```

## New: `GET /mobile/sync/pull/:scope?cursor=&limit=500`

Scopes, in the order the phone pulls them: `users`, `customers`, `items`, `item_prices`. Response:

```json
{ "rows": [ … ], "deletedIds": ["uuid"], "nextCursor": "opaque-string", "hasMore": true }
```

Cursor recipe: encode `(modified_on, id)` of the last row returned. Query rows where
`(coalesce(modified_on, created_on), id) > (cursorTs, cursorId)` ordered by the same pair.
`cursor` empty = full download. `deletedIds` = rows soft-deleted or deactivated since the cursor.
Scope customers to the salesman's beats once beats exist.

Row shapes the phone expects (see `src/api/types.ts`):

- **users**: `id, loginName, displayName, passwordHash, isActive, updatedAt`
  - Only users of the device's company who may log in on mobile: the same filter as
    `AuthService.findLoginUser` (not deleted, active, not locked, mobile-login flag on).
  - A user who stops matching (locked, deactivated, mobile login turned off) must come back in
    `deletedIds` or with `isActive: false`. The phone then deletes their hash and signs them out.
  - `passwordHash` is `usr_password_hash` exactly as stored (`scrypt$<salt>$<hex>`, Node scrypt
    defaults N=16384 r=8 p=1, 64-byte key). The phone checks the password with the same
    parameters (`src/auth/password.ts`). A password change in VK Nex reaches the phone at the
    next Sync. Until then, the old password still works on that phone.
- **customers**: rows of VK Nex's `sales.customers` with their Prisma field names, every scalar
  field (`cusId, cusTitle, cusShort, cusCode, cusName, cusAddr1 … cusModifiedBy`), exactly as
  `customer.prisma` has them. The phone keeps the same columns (`src/db/schema.ts`, `customers`), so
  rows are stored unchanged. Decimals as strings, dates as `YYYY-MM-DD`, timestamps as ISO.
  Customers that are deleted (`cusIsDeleted`) or deactivated come back in `deletedIds` or with the flag set.
- **items**: `id, code, name, barcode, hsn, unit, mrpPaise, gstRateBp, cessRateBp, taxInclusive, isActive, updatedAt`
- **item_prices**: `itemId, priceLevel, ratePaise` (for this scope, `deletedIds` are item ids whose prices were all removed)

## Items, orders and check-ins (built, VK Nex `src/mobile-modules/item|order|visit`)

All under `/api/v1/mobile/` (already allowed on the phone port), `{ success, message, data }`.
VK Nex's routes take an optional token; the phone always sends one (it has signed in), so VK Nex
takes the signed-in user as the order's `so_user_id` and the visit's `cv_user_id`.

### The phone's device uid

Orders and check-ins are taken only from a **registered phone**: a `fixed.device_master` row whose
`dev_device_uid` is the phone's uid, added by the office on VK Nex's **Device List** screen (the
user's choice). An unknown, blocked or switched-off phone is a 403 `MOBILE_DEVICE_NOT_REGISTERED` /
`_BLOCKED` / `_INACTIVE`.

- The phone makes its uid once per install: `VKSMAN-` + 12 upper-case hex digits
  (`src/sync/device-uid.ts`, kept in `device_meta.deviceUid`). The Sync page shows it under
  **This phone**, so the office can type it in. A reinstall (or cleared app data) makes a new one.
- `POST /auth/login` sends it as `device_id`. VK Nex's answer has `device_id` (its `dev_id`) when it
  matched a usable registered device, else null; the Sync page then says the phone is or is not
  registered. Login itself is not refused for an unknown phone.
- Every order and check-in body carries `deviceUid`. `GET /mobile/items/list` carries it only when
  sign-in matched the phone (an unknown uid there would be a 403 too); without it, VK Nex prices
  for the company's default branch.

### Order of one Sync

`auth/login` → `customers/options` → customers create → customers update → **orders create** →
**visits create** → customers list/get → **items options + list** → ledgers.

Customers go first: a new shop's orders and check-ins move to VK Nex's `cusId` in the same SQLite
transaction that marks the shop synced (`markCustomerSynced`). An order or check-in for a shop
that is still waiting (or was refused) is not sent; it waits with `CUSTOMER_NOT_SENT`.

Refusals: 400 / 404 / 409 / 422 for one order or check-in is stored in its `app_sync_error` and the
next one is sent. A **403** stops orders and check-ins (the phone itself is refused) but the
downloads still run. No answer, 5xx or a lost sign-in stops the whole Sync.

### `GET /mobile/items/options` and `GET /mobile/items/list?companyId=&page=&pageSize=500[&deviceUid=]`

- `options.companies` **replaces the phone's companies** (Choose company), with the item groups
  and brands, as soon as `options` answers (before the item list is read, so a failure there still
  leaves VK Nex's companies). If the chosen company is not among them, the first one is chosen. An
  empty list leaves the phone's as they were. The old test companies are deleted by migration
  `0009_remove_test_companies` (`src/db/test-companies.ts` is removed).
- `options.itemGroups` / `brands` replace `item_group_master` / `item_brand_master`, sorted by
  VK Nex's `position` (null last), then name.
- `list` is read page by page for **every** company of `options`. Per item → `item_master`
  (`itemCode, itemNameEn, itemNameTa, itemGroupId, itemBrandId, allowLoading → item_allow_loading,
  allowFreight, allowPromo, inclTax → item_incl_tax, hsnCode → item_hsn_code, taxPerc → app_tax_perc,
  taxId → app_tax_id`); an item listed for several companies is stored once. Per unit and company →
  `item_units` (`iucId, unitName → app_unit_name, factor → iuc_to_base_factor, isDefaultUnit,
  weight → iuc_uom_weight, priced → app_priced, priceA..D → ipm_sales_price_a..d, mrp →
  ipm_max_price, minPrice, loadingCharge, freightCharge, availableQty → isb_available_qty`). Money
  and quantities are kept as exact text. A unit with `priced: false` is kept with null prices; Order
  entry must not offer it at a price.
- Items and units of every company are replaced in **one transaction**. Any failure while
  reading keeps the phone's old items; Sync reports it and goes on to the ledgers.
- Price levels still come from `customers/options` (the item options' list is the same without
  Cost).

### `POST /mobile/orders/create`, one per order

Body (`src/sync/upload-orders.ts`, `toOrderPayload`): VK Nex's desktop order without the keys the
server fills (sending `soId, soBranchId, soAccYear, soDeviceId, soOrderSlno, soOrderRefno,
soStatus, soSessionId, post, charges, tenders, soCreatedBy, soModifiedBy` is a 400
`VALIDATION_WHITELIST`):

- `soClientUuid` = the phone's `so_id`, `deviceUid`, `soCompanyId, soCustId, soCustName,
  soPriceLevel` (the order's, else the customer's), `soOrderDate, soOrderDatetime, soHasLoad,
  soHasFreight, soTotItems, soTotBags, soGrossAmt, soItemDisc, soFreightAmt, soLoadAmt, soOrderAmt,
  soRemarks`. The vehicle number goes in the remarks after `###`, as the Qt app did
  (`remarks###TN28AB1234`, cut at 500).
- `items[]`, by line number: `soiLineNo, soiItemId, soiItemUnitId (= iucId), soiPriceLevel,
  soiIsPromo, soiOrderQty, soiNetQty, soiRate, soiMaxPrice, soiItemDiscPerc, soiItemDiscQty,
  soiItemDiscAmt, soiGrossAmt, soiFreightQty, soiFreightAmt, soiLoadQty, soiLoadAmt, soiNetAmt`.
- Not sent: `soUserId` (the token's user is taken; the phone's test salesman ids are not uuids),
  empty values (VK Nex fills its defaults).
- VK Nex fills device, branch (the phone's if it belongs to the company, else the company's
  default; 422 `MOBILE_BRANCH_NOT_RESOLVED`), acc year (422 `MOBILE_NO_FISCAL_YEAR`) and the number,
  and saves it as **DRAFT** for the office to confirm (no stock is reserved from a phone).
- Answer `{ soId, soOrderRefno, soStatus, soAccYear, duplicate, soIsDeleted }`. The phone keeps
  `so_order_refno`, `so_status`, `so_acc_year`, `app_server_so_id`, `app_synced_on` and clears
  `app_pending_upload`. `duplicate: true` (sent before, answer lost) is marked synced the same way;
  `soIsDeleted` is shown on the Sync page. 409 `MOBILE_CLIENT_UUID_REUSED` is a refusal.

Checked 2026-11-16: the body the phone builds passes VK Nex's own `CreateMobileOrderDto` /
`CreateMobileVisitDto` validation (house ValidationPipe, run in-process with no server).

### `POST /mobile/visits/create`, one per check-in

Body (`src/sync/upload-visits.ts`, `toVisitPayload`): `cvClientUuid` = the phone's visit id,
`deviceUid`, `cvCompanyId` (the visit's `company_id`, else the company chosen now), `cvCustId`,
`cvSalesmanId`, `cvReasonCode` (`shopClosed, noOrder, shopBusy, ownerAway, paymentPending,
nextVisit`, as the phone keeps them), `cvRemarks` (≤ 500), `cvLatitude` + `cvLongitude` (both or
neither) and `cvGpsAccuracy` (metres), `cvVisitAt` (ISO). Answer `{ cvId, cvClientUuid, cvVisitAt,
duplicate }`; the phone keeps `app_server_id`, `app_synced_on`.

**Open: the salesman.** `cvSalesmanId` must be a live `public.employee_master.emp_id`. The phone
has no employee ids: its salesmen are test ones, VK Nex sends no salesman list, the sign-in answer
has no employee, and most VK Nex users have no `usr_employee_id`. Until that is decided, check-ins
wait on the phone with `NO_SALESMAN` (`salesmanOf` in `src/sync/run-sync.ts`). Ways out: a salesmen
list from VK Nex (e.g. in `items/options`), or VK Nex taking the signed-in user's
`usr_employee_id` when `cvSalesmanId` is left out.

### Phone screens

Built 2026-11-16 from the canvas page "3 · Orders": Order · choose company, Order entry, Order
item, Order summary (writes `sale_order` + `sale_order_item`) and Check in (writes `visits` with the
company chosen in Choose company and the GPS fix). Both wait on the phone until Sync sends them.
Order entry lists only what Sync brought (`item_units` of that company with `app_priced`), so a
phone that has not synced items yet shows "No items".

### Later (the phone hides these for now)

- **Rate history** on Order item: `GET /mobile/customers/item-rates?cusId&itemId&unitId` → last
  few posted bill lines `[{ billDate, qty, rate }]` (or all of a customer's, for Sync).
- **Balance per company** on "Order · choose company": per customer and company, balance and
  pending bill count (the phone's ledger is for the login company only).
- **Price-edit right** (`usr_edit_rate` / `sales.allow_rate_edit`) and admin flag, if Order item
  should lock price / discount or show cost price.
