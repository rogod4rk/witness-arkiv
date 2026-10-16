# Verification log

Run on 2026-10-16, Node 22.14, `@arkiv-network/sdk` 0.8.1, Tiramisu (chain 7738577).

## STATUS: funded end-to-end run PASSED on Tiramisu (2026-10-16)

The writer `0xD7532a8170840b922121e6961093b7c5d9215925` was funded from the faucet in a browser (the captcha was not bypassed), and `npm run e2e` ran against Tiramisu. Its output is under "Funded run". The sections below it were captured earlier, before funding.

## Verified

### Offline logic (`npm test`)

```
ok 1 - clean log verifies and decrypts
ok 2 - altered payload is caught
ok 3 - deleted middle entry is a gap
ok 4 - deleted tail is caught by the seal
ok 5 - entries from another creator are ignored and counted
ok 6 - wrong key is a key problem, not tampering
ok 7 - key format is validated, with or without 0x
ok 8 - checkpoint catches a writer rewrite of history
ok 9 - rows that are not read-only or were patched are flagged
ok 10 - natural expiry is reported separately and does not fail the log
ok 11 - an interior deletion is a gap at any age, even when the seal is old
# tests 11
# pass 11
# fail 0
```

### Typecheck and build (`npm run build`)

`tsc` clean; `vite build` produced `dist/` (346 kB JS, 106 kB gzip). A headless Chrome load of the built app rendered the page, generated a browser key and read its balance from Tiramisu ("balance 0 GLM", faucet link shown).

### Live read-only checks (`npx tsx scripts/readcheck.ts`)

```
chainId 7738577 head 655564n
readLog rows 0 foreign 0 verdict true
expiringKeys 0
websocket events seen in 6s (any wallet): 6
```

The exact queries the app runs (`createdBy`, attribute equality, `$expiresAt` range, `for await` pagination) were accepted by the node. The websocket watcher received live events from the chain.

### Dry run of a write (`npx tsx scripts/dryrun.ts`)

The node's `eth_call` validated the real encoded batch (an `entry` and an `anchor`, flags `readonly` + `permissionlessExtension`, empty payload, `bytes32` attribute, 3492 bytes of calldata) without sending it:

```
estimateGas call to 0x4400000000000000000000000000000000000044 data bytes 3492
eth_call accepted the batch, return 0x
```

(The later "Execution error without revert data" line in that script is the dry run stopping at the unfunded send, which is expected.)

### Transport check

`watchEntityEvents` with `webSocket()` made no `request` calls (a real subscription). With `http()` it called `eth_newFilter` and `eth_blockNumber` (polling).

## Funded run: `npm run e2e` output (2026-10-16)

```
> arkiv-witness@0.1.0 e2e
> tsx scripts/e2e.ts


== setup
chain 7738577 writer 0xD7532a8170840b922121e6961093b7c5d9215925
balance GLM 10

== 1. clean log: one atomic batch (3 entries + seal) while a websocket watcher listens
tx https://tiramisu.explorer.arkiv.network/tx/0xbd4089545251f222dc97d420646504d9c157f45b5c7f8b8d94736cdb33ff8350 entities 4
ok: websocket delivered 4/4 EntityCreated events without polling

== 2. read back with a fresh public client, filtered by $creator, verify, decrypt
query: project = str('arkiv-witness') AND log = str('f1622ce195e2a7bc') AND $creator = addr('0xD7532a8170840b922121e6961093b7c5d9215925')
ok: 3 entries chain from genesis, issues=[]
ok: payload decrypts to the synthetic event

== 3. append continues from the verified head
tx https://tiramisu.explorer.arkiv.network/tx/0x23e89c06232686d42fcd6bf54b07f2ac024b44aa9bcc7e57269d50527004ca94
ok: log is now 4 entries, still valid

== 4. readonly: a patch must be rejected
ok: patch rejected: Transaction failed: entity 0x7d0f46b0…f2fec5 was created readonly, so its conten

== 5. lease: extend entries expiring soon (range query on $expiresAt)
ok: 4 entries expire within 15 days (expected exactly 4)
tx https://tiramisu.explorer.arkiv.network/tx/0xdcb50c5ad29a95107b6784416ccd2a4620871b69530229645c82f0e39d7a5332

== 6. tamper: delete entry 2 of a second log, verify must flag the gap
tamper log 97c139c402e7c3e9 
batch tx https://tiramisu.explorer.arkiv.network/tx/0x1ec13d2da41c0186384a54923f6d049774e46ff0437972ec70d109a6ec4892c3 
delete tx https://tiramisu.explorer.arkiv.network/tx/0xa7947563a6a13ad94fac673b5b40015ad67d7707833eb92666a9fb758e165a0a
issues: [ 'gap: seq 2..2 missing (entries deleted)' ]
ok: deleted entry detected as a gap

== 7. forged entry from another wallet (needs SECOND_KEY funded)
SKIPPED: set SECOND_KEY in .env to a funded wallet

DEMO LOG {"writer":"0xD7532a8170840b922121e6961093b7c5d9215925","log":"f1622ce195e2a7bc"} 
ALL CHECKS PASSED
```

After renewal, a fresh read verifies the demo log as intact and flags the gap in the tamper log:

```
demo rows 6 ok true issues []
tamper rows 3 ok false issues ["gap: seq 2..2 missing (entries deleted)"]
```

Interior deletions are flagged as gaps whatever the age of the seal: only a missing oldest prefix, or a log that has fully expired behind a seal older than 14 days, counts as normal expiry (test 11, plus the reviewer's case: delete entry 2 of 4 on day 15 with 1, 3 and 4 alive).

Renewal bumps `updatedAt` on Arkiv, so the "updated after creation" check now only applies to entities that are not readonly (readonly entities reject content patches on chain).

`npm run e2e` checks, in order: websocket delivered 4/4 EntityCreated events for one atomic batch; read by `$creator` verifies and decrypts 3 entries; append continues from the verified head; a patch on a `readonly` entity is rejected; `$expiresAt` range query finds the entities and a batch of extensions lands; deleting an entry of a second log is flagged as a gap; with `SECOND_KEY`, a forged entry is ignored and counted, and a non-owner extends an entry (permissionless extension). It prints explorer links for every transaction and writes the demo log into `src/demo.json`.

## Demo renewal: `npx tsx scripts/renew-demo.ts` (2026-10-16)

Extends every entry of both demo logs by 60 days so the judges' demo outlives judging. The 90 day seals already have more than 60 days left, and the engine rejects an extension that does not move the expiry later, so they are skipped. Then it re-reads both logs and asserts the verdicts.

```
f1622ce195e2a7bc 6 rows, 4 to extend so far
97c139c402e7c3e9 3 rows, 6 to extend so far
renew tx https://tiramisu.explorer.arkiv.network/tx/0x32964937e83a5588d6bfcdbec2035f56b7c58c71930a40d2934f4ebbb5545456 extended 6
demo log rows 6 ok true []
ok: demo log verifies ok
tamper log rows 3 ok false [ 'gap: seq 2..2 missing (entries deleted)' ]
ok: tamper log is flagged with a gap
```
