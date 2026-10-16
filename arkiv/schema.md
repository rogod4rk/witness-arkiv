# Arkiv schema

Network: Tiramisu testnet (chain `7738577`). SDK: `@arkiv-network/sdk` 0.8.1. All code lives in [`src/core.ts`](../src/core.ts).

Every entity carries `project = str("arkiv-witness")`. A log is identified by a random `log` id (8 bytes, hex) that carries no meaning.

## Entity types

Both types are created with the flags `readonly` and `permissionlessExtension`.

### `entry`: one encrypted audit event

| Part | Value |
|---|---|
| Attribute `project` | `str` `arkiv-witness` |
| Attribute `type` | `str` `entry` |
| Attribute `log` | `str`, random 16 hex chars |
| Attribute `seq` | `u64`, 1-based position in the log (numeric so it supports ranges) |
| Attribute `chain` | `bytes32`, `keccak256(prevChain ‖ seq as 8 bytes ‖ keccak256(payload))` |
| Payload | `iv (12 bytes) ‖ AES-256-GCM ciphertext`, content type `application/octet-stream`. Plaintext is `{t, actor, action, detail}` JSON, synthetic data only. AAD is `"<log>:<seq>"` |
| Expiration | 14 days (`ExpirationTime.fromDays(14)`), renewed with Lifetime Extension while an audit is open |

The genesis value is `keccak256(utf8("witness:" + log))`, so `chain` of entry 1 is `link(genesis, 1, payload)`.

### `anchor`: a seal over the log head

| Part | Value |
|---|---|
| Attributes | same names as `entry`; `seq` is the head sequence, `chain` is the head chain value |
| Payload | empty |
| Expiration | 90 days. A seal outlives the entries it commits to, so deletion of a tail stays detectable after entries expire |

Each append writes its new entries and one anchor in a single atomic `executeBatch`.

## Why these attributes, and what stays off Arkiv

- Queried, so attributes: `project`, `type`, `log`, `seq`, `chain`.
- Never on Arkiv: the decryption key, the plaintext, actor identity. The key travels in the URL fragment, so no server (ours or anyone's) sees it.
- Nothing personal in attributes. `log` is random, `chain` and `seq` are counters and digests of ciphertext.

## Queries the app runs

Trusted read (the `$creator` filter is what makes a result trustworthy):

```
project = str('arkiv-witness') AND log = str('<log>') AND $creator = addr('<writer>')
```
SDK: `select({key, creator, expiresAt, payload, attributes}).where(eq("project", ...), eq("log", ...)).createdBy(writer).limit(200)`, walked with `for await` (cursor pagination, 200 per page).

Look-alike count (same attributes, any creator, keys only):

```
project = str('arkiv-witness') AND log = str('<log>')
```
`foreign = all - trusted`. These are entities somebody else wrote with copied attributes. They are ignored by verification and shown to the auditor.

Expiring soon (renewal set):

```
project = str('arkiv-witness') AND log = str('<log>') AND $expiresAt < u64(<head block + days * 43200>) AND $creator = addr('<writer>')
```
(`and(eq, eq, lt("$expiresAt", u64(...)))` plus `.createdBy(writer)`.)

## Live events

`watchEntityEvents({ onEntityCreated })` on a client built with `webSocket()` and no `fromBlock`. When the writer creates an entity the UI re-runs the trusted read and re-verifies.

## Verification rules (client side, `verify()` in `src/core.ts`)

1. Only entities created by the declared writer count.
2. Entries must be contiguous in `seq` and each `chain` must equal the recomputed link. A gap means deletion.
3. Two entries with the same `seq` is a fork.
4. Every anchor must match the entry at its `seq`. An anchor beyond the last entry means the tail was deleted.
5. With the key, every payload must decrypt under its own `(log, seq)` AAD.
6. If entries expired, the visible prefix is reported and the rest is checked from the first surviving entry.

## Wallet roles

| Address | Role |
|---|---|
| `0xD7532a8170840b922121e6961093b7c5d9215925` | Writer of the seeded demo logs (created by `npm run e2e`) |
| Browser throwaway key (per visitor) | Writer of logs created in the live app |
| `SECOND_KEY` wallet (optional, e2e only) | Forger and permissionless extender, to demonstrate the `$creator` filter |
