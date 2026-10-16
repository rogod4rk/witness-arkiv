# Witness

Tamper-evident, private audit logs on [Arkiv](https://arkiv.network), the Web3 database. Built for the Arkiv Global Tour Stop (Security and Privacy tracks, also relevant to Censorship Resistance).

## The problem

A company's admin audit trail (who granted whom access, who rotated a key, who ran an export) normally sits in a database that an administrator can edit. After a breach or an insider incident, the first thing that goes missing is the log. Auditors, incident responders and regulators have to trust an export from the very operator they are checking. Putting the log on a public chain fixes that, but then every actor name and action is exposed to the world.

Witness gives the auditor a log that cannot be changed or truncated without the check failing, and gives the public nothing readable.

## How it works

- Each event is encrypted in the browser with AES-256-GCM. The key never leaves the client and travels only in the URL fragment of a share link.
- Each ciphertext is chained: `chain(n) = keccak256(chain(n-1) | seq | keccak256(payload))`.
- Each event becomes an Arkiv entity with the flags `readonly` (attributes and payload frozen) and `permissionlessExtension` (anyone can keep it alive, nobody can alter it).
- Every append is one atomic `executeBatch`: the new entries plus a seal (`anchor`) over the new head.
- The auditor opens the app with a writer address and a log id. The app reads with `createdBy(writer)`, so look-alike entities written by other wallets are ignored and counted. It recomputes the chain, checks the seals and, with the key, decrypts.

What the explorer shows: random log id, a counter, a hash, ciphertext. No names, no actions.

| Arkiv feature | Used for | Where |
|---|---|---|
| `$creator` via `createdBy()` | Only the writer's entities are trusted, forged copies are counted and shown | `readLog` in `src/core.ts` |
| `readonly` creation flag | Entries and seals cannot be patched | `buildAppend` |
| `permissionlessExtension` + `extendEntity` batch | Anyone, including the auditor, renews retention | `renewal`, "Renew" button |
| Entity Expiration per type | Entries 14 days, seals 90 days, so a deleted tail stays detectable | `ENTRY_DAYS`, `ANCHOR_DAYS` |
| Range query on `$expiresAt` | Finds the entries a renewal must extend | `expiringKeys` |
| `executeBatch` | Entries and seal land together or not at all | `buildAppend` |
| `watchEntityEvents` over `webSocket()`, no `fromBlock` | The verdict updates live when the writer appends | `socketClient`, `src/main.ts` |
| Cursor pagination (`for await`) | Reads logs longer than one page | `readLog` |

Full data contract: [arkiv/schema.md](arkiv/schema.md). Friction report: [arkiv/friction.md](arkiv/friction.md).

Deliberately off Arkiv: the decryption key, the plaintext, who the actors are.

Why not Postgres, IPFS or a subgraph: on a database the operator controls, the operator can rewrite history and the auditor cannot tell. IPFS has no creator, no expiry and no query. A subgraph is an indexer someone runs and can change. Here the auditor needs only a public RPC and the writer address, and the writer's identity comes from the immutable `$creator`.

## Run it

```bash
npm install
npm test          # hash chain, tamper and forgery cases (no network)
npm run dev       # app at http://localhost:5173
npm run build     # static site in dist/
```

### Fund the key

Writes cost GLM. The faucet needs a browser (wallet sign-in plus a captcha), so it cannot be scripted:

1. `npm run key` creates a throwaway key in `.env` (gitignored) and prints its address.
2. Claim 10 GLM for that address at https://hub.arkiv.network/faucet.
3. Optional: a second funded key as `SECOND_KEY` in `.env` enables the forgery and permissionless-extension checks.

In the web app the browser makes its own throwaway key and shows its address and faucet link.

### Reproduce the Arkiv usage

```bash
npm run e2e
```

This writes a log (atomic batch, websocket watcher listening), reads it back by `$creator`, verifies and decrypts, appends from the verified head, tries a patch (must fail), renews entries, deletes an entry of a second log (the gap must be flagged), and writes the demo log into `src/demo.json`. Transaction links print as it goes. The exact query the app runs:

```
project = str('arkiv-witness') AND log = str('<log>') AND $creator = addr('<writer>')
```

You can also paste any writer address and log id into the "Audit a log" box of the app. Read-only checks with no funds: `npx tsx scripts/readcheck.ts`.

## Security notes

- Data is synthetic. Do not log real personal data. It is encrypted, but Arkiv entities are public and permanent in practice for the life of the entry.
- Keys and plaintext never go on Arkiv. The browser key is a throwaway testnet key kept in `localStorage`.
- Limits: the owner of an entity can still delete it before expiry. Deletion is detected (gap or seal mismatch) but not prevented. If the very last entries and the seal are all deleted together, the log looks like a shorter valid log; the auditor should record the head `seq` and `chain` out of band (the verdict shows both).

## Layout

`src/core.ts` crypto, hash chain, queries, verification. `src/main.ts` UI. `scripts/e2e.ts` live end to end run. `test/core.test.ts` offline checks. `arkiv/` schema and friction report.

MIT licensed.
