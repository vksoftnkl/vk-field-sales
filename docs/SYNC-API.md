# Sync API — what VK Nex (NestJS) must provide

The phone works fully offline. It talks to the **VK Nex server PC on the office LAN** only
when the salesman taps **Sync**. There is no user login on the server: salesmen sign in on the
phone against users downloaded during Sync, and the server trusts the **device** once the
office has approved it (the new version of the old Qt app's `/checkMacAddress`).

- Base URL: `http://<server-ip>:<port>/api/v1` — the IP and port are entered on the phone in
  **Server settings** (default port `3011`). Plain HTTP on the LAN, so the Android build has
  `usesCleartextTraffic` on (`app.config.ts`).
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
- **customers**: `id, code, name, mobile, gstin, stateCode, address, beatId, priceLevel, creditLimitPaise, creditBillLimit, outstandingPaise, isActive, updatedAt`
- **items**: `id, code, name, barcode, hsn, unit, mrpPaise, gstRateBp, cessRateBp, taxInclusive, isActive, updatedAt`
- **item_prices**: `itemId, priceLevel, ratePaise` (for this scope, `deletedIds` are item ids whose prices were all removed)
