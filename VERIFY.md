# Verification log

Run on 2026-10-16, Node 22.14, `@arkiv-network/sdk` 0.8.1, Tiramisu (chain 7738577).

## STATUS: funded end-to-end run is PENDING

The throwaway writer `0xD7532a8170840b922121e6961093b7c5d9215925` has 0 GLM. The faucet (https://hub.arkiv.network/faucet) requires a wallet sign-in plus a captcha (`POST /api/faucet` returns `400 CAPTCHA verification required.`), so it could not be claimed from a script, and the captcha was not bypassed. Claim 10 GLM for that address in a browser, then run `npm run e2e` and paste its output below. Until then no transaction has been sent, and everything under "Verified" is what could be proven without funds.

## Verified

### Offline logic (`npm test`)

```
ok 1 - clean log verifies and decrypts
ok 2 - altered payload is caught
ok 3 - deleted middle entry is a gap
ok 4 - deleted tail is caught by the seal
ok 5 - entries from another creator are ignored and counted
ok 6 - wrong key fails to decrypt
# tests 6  pass 6  fail 0
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

## Pending (needs funds): paste `npm run e2e` output here

`npm run e2e` checks, in order: websocket delivered 4/4 EntityCreated events for one atomic batch; read by `$creator` verifies and decrypts 3 entries; append continues from the verified head; a patch on a `readonly` entity is rejected; `$expiresAt` range query finds the entities and a batch of extensions lands; deleting an entry of a second log is flagged as a gap; with `SECOND_KEY`, a forged entry is ignored and counted, and a non-owner extends an entry (permissionless extension). It prints explorer links for every transaction and writes the demo log into `src/demo.json`.
