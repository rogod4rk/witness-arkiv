# Devfolio submission draft: Witness

Answers are ordered like the Devfolio form (checklist in the rules repo, `docs/submission-checklist.md`). Answers to the numbered questions are private to organizers and judges, the repo files are public.

## Standard fields

**Project name:** Witness

**Tagline:** Tamper-evident audit logs nobody but you can read, on Arkiv.

**Project media:** screenshots of the audit verdict (intact, then a deleted entry flagged as a gap) and one Tiramisu explorer entry showing only a random id, a counter, a hash and ciphertext.

**Links:**
- Repo: https://github.com/rogod4rk/witness-arkiv
- Live app: https://arkiv-entry.vercel.app
- Demo video (2:07): https://arkiv-entry.vercel.app/demo.mp4

**Builders:** rogo (GitHub rogod4rk)

### Description

Witness is a tamper-evident audit log for the events a company most wants to keep honest: who granted access, who rotated a key, who exported data. Each event is encrypted in the browser, chained to the one before it with a hash, and written to Arkiv as a read-only entity. An auditor opens the app with a writer address and a log id, reads straight from Arkiv, recomputes the chain and gets a verdict: intact, or a specific gap, fork or tampered entry. With the key (it lives in the URL fragment of the share link, never on a server) the entries decrypt. Without it the public sees ciphertext and a counter.

### The problem it solves (required)

After a breach or an insider incident the audit log is the first thing that gets cleaned up. It normally sits in a database that an administrator can edit, so the people who need it most (the auditor, the incident responder, the regulator) are asked to trust an export from the operator they are checking. Moving the log onto a public chain removes the operator, but then every actor name and action is readable by anyone, forever, which most companies cannot accept.

Witness makes the log tamper-evident against everyone but the writer, and against the writer too once an auditor has pinned a checkpoint (an expected head `seq` and hash; the app stores the last intact one and the share link carries it). Everyone else sees nothing readable. Day one change for an auditor: instead of "here is our export", they get a link, run the check themselves against a public RPC, and see exactly which sequence number is missing if something was removed.

### Challenges I ran into (required)

- **Forgery by attribute copy.** Attributes are just data, so anyone can create an entity with our `project` and `log` values. Trust had to come from the one thing nobody can fake, the on-chain `$creator`, so every trusted read goes through `createdBy(writer)`. The unfiltered query is run only to count look-alikes, which the UI shows rather than hides.
- **Deleting the tail.** A hash chain catches a removed middle entry but not a removed end. The fix is a second entity type, a seal over the head, written in the same atomic `executeBatch` as the entries and given a longer Entity Expiration (90 days against 14), so a deleted tail leaves a seal that points past the last entry.
- **Read-only means nobody can fix a mistake, including us.** We accepted that: the flag is the point. Entries are created `readonly` and `permissionlessExtension`, so the flag lets anyone, an auditor included, extend their lifetime without being able to touch the content (the funded run extended them as the writer; a non-owner extension was not demonstrated on chain).
- **No funds for scripted tests.** The faucet needs a browser captcha, so an agent or CI job cannot fund a key. We proved the encoding with an `eth_call` dry run first and logged it in the friction report.
- **Residual limits we state openly.** The owner of an entity can still delete it. We detect that, we cannot prevent it. Seals are written by the writer too, so a writer who deletes entries and seals and re-appends a different history still verifies until an auditor pins a checkpoint (expected head `seq` and hash). With a pinned checkpoint the rewrite fails with "history rewritten since checkpoint". Appends have no compare-and-swap, so concurrent writers can fork a log (detected, not prevented).

## Tracks to enter

**Security (primary), Privacy (second).** One prize per team, so entering both costs nothing, and the "Why this pillar" criterion is scored once per track.

- **Security** is the strongest fit. The rubric's own test for this pillar is "the app shows or filters Arkiv entities by their on-chain creator (`$creator`), not by a field anyone can write", and that is the core mechanism here: every trusted read uses `createdBy(writer)`, and the UI counts look-alike entities from other wallets instead of trusting them. The people harmed today are auditors and responders misled by an edited log.
- **Privacy** also holds on its own terms: the explorer shows five attributes (project, type, random log id, counter, hash) and ciphertext, no personal data, the key never leaves the client, and entry lifetime can be extended by a third party through the `permissionlessExtension` flag.
- Not entered: Open Source (the data contract is documented but this is not a dataset others build on), Censorship Resistance (a reasonable argument exists, but it dilutes the story), Best Indian Use Case (no India-specific user group).

### Why this pillar, per track (write into each track's answer if the form asks)

**Security:** Who is misled today: an auditor or incident responder handed a log export by the operator under investigation, plus a regulator relying on it. Why today's tools fail them: a database log can be rewritten and an export can be curated, and a copy of a public record can be passed off as the original. What changes from day one: authorship comes from `$creator`, so a forged copy is rejected by construction and counted on screen (shown in unit tests; the funded run did not seed a forged entity, since that needs a second funded wallet); entries are `readonly`, so nobody patches one (the verifier also flags any trusted row that is not read-only); the chain and the seal expose a deletion as a named gap, and an interior deletion is flagged whatever the age of the seal (only a missing oldest prefix, or a log that has fully expired behind an old seal, counts as normal expiry); a pinned checkpoint exposes a rewrite by the writer.

**Privacy:** Who is exposed today: the admins and service accounts named in the log, and the company whose access structure it reveals. Putting the log on a public chain in plaintext would leak both. What changes: only ciphertext and counters are public, the decryption key sits in the URL fragment and never reaches a server, and the `permissionlessExtension` flag lets anyone, typically the auditor, extend entries without being able to change them (not demonstrated on chain by a non-owner).

## Our questions

**1. Live app URL:** https://arkiv-entry.vercel.app

**2. Does any team member hold Indian nationality?** No

**3. Why Arkiv?**

The product is an argument about who can be trusted, and Arkiv supplies the pieces that argument needs, from the chain and not from us.

- **Postgres or our own API:** the operator edits history and the auditor cannot tell. Witness catches that for everyone but the writer, and for the writer once a checkpoint is pinned. Here the writer's identity is the immutable `$creator`, and the reader needs only a public RPC and an address.
- **IPFS:** content addressing proves bytes did not change, but there is no creator (anyone can pin the same bytes), no expiry (so nothing like a short-lived entry with a longer-lived seal), and no query (finding "the entries of log X by writer Y, expiring within 14 days" needs an index someone runs).
- **A subgraph:** that is an indexer a third party operates and can change. Witness reads the chain's own query, so there is no second system whose honesty the auditor must also check.
- **Only on Arkiv:** `$creator` as a query filter, creation flags that make an entity read-only yet extendable by anyone, per-entity Entity Expiration, a range query on `$expiresAt` that finds what is about to disappear, and a live event stream, all in one data layer.
- **Deliberately off Arkiv:** the decryption key, the plaintext and the identity of the actors. Arkiv carries ciphertext, a counter and a hash. The key is in the URL fragment.

**4. How do you use Arkiv?** (links are to `src/core.ts` unless noted)

| Feature | How and why | Code |
|---|---|---|
| `$creator` via `createdBy()` | Every trusted read is filtered to the writer address, so copied attributes from other wallets cannot enter the verdict. A second unfiltered query counts look-alikes. | `readLog`, https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/src/core.ts#L77 |
| Creation flags `readonly` + `permissionlessExtension` | Entries and seals cannot be patched (the funded run showed a patch rejected). The `permissionlessExtension` flag is meant to let anyone extend their lifetime; a non-owner extension was not run on chain (needs `SECOND_KEY`). | `flags`, https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/src/core.ts#L45 |
| `executeBatch` | The new entries and the seal over the new head land together or not at all. | `buildAppend`, https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/src/core.ts#L48 |
| Attributes vs payload | Queried values are typed attributes (`project`, `type`, `log`, `seq` as `u64` so it supports ranges, `chain` as `bytes32`). The encrypted event is the payload. | `arkiv/schema.md` |
| Entity Expiration per type | Entries 14 days, seals 90 days, so a deleted tail stays detectable after entries expire. | `ENTRY_DAYS`, `ANCHOR_DAYS`, https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/src/core.ts#L8 |
| Range query on `$expiresAt` | Finds exactly the entries a renewal must extend. | `expiringKeys`, https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/src/core.ts#L186 |
| Lifetime Extension | The Renew button extends the expiring set as a lease. The funded run renewed as the writer; the `permissionlessExtension` flag is what would let an auditor do the same. | `renewal`, https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/src/core.ts#L194 |
| Cursor pagination | `for await` over `select().limit(200)` reads logs longer than one page. | `readLog` |
| `watchEntityEvents` over `webSocket()`, no `fromBlock` | The verdict re-verifies live when the writer appends, over a real socket instead of polling. | https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/src/main.ts#L77 |

**5. Friction report:** https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/arkiv/friction.md

Three issues, each with expected, actual, versions and a repro: (1) the faucet needs a browser captcha, so no script or agent can fund a key (`POST /api/faucet` returns `400 CAPTCHA verification required.`), (2) a zero-balance write fails with `Execution error without revert data` instead of an insufficient funds error, (3) the Live Events docs only show `http()` and never say that `webSocket()` without `fromBlock` opens a real socket (we measured zero polling requests against `eth_newFilter` calls on `http()`). It also records what worked first try, so the report is balanced.

**6. Wallet addresses that create your Arkiv entities**

| Address | Role |
|---|---|
| `0xD7532a8170840b922121e6961093b7c5d9215925` | Writer of the seeded demo logs, created by `npm run e2e`. This is the `$creator` the auditor trusts. |
| Browser throwaway key (one per visitor, shown in the app) | Writer of logs a visitor creates in the live app. |

Creation transactions (from the funded `npm run e2e`, full output in VERIFY.md):
- First atomic batch (3 entries + seal): https://tiramisu.explorer.arkiv.network/tx/0xbd4089545251f222dc97d420646504d9c157f45b5c7f8b8d94736cdb33ff8350
- Append: https://tiramisu.explorer.arkiv.network/tx/0x23e89c06232686d42fcd6bf54b07f2ac024b44aa9bcc7e57269d50527004ca94
- Renewal of expiring entries: https://tiramisu.explorer.arkiv.network/tx/0xdcb50c5ad29a95107b6784416ccd2a4620871b69530229645c82f0e39d7a5332
- Demo logs renewed by 60 days (`scripts/renew-demo.ts`): https://tiramisu.explorer.arkiv.network/tx/0x32964937e83a5588d6bfcdbec2035f56b7c58c71930a40d2934f4ebbb5545456
- Tamper log batch: https://tiramisu.explorer.arkiv.network/tx/0x1ec13d2da41c0186384a54923f6d049774e46ff0437972ec70d109a6ec4892c3
- Delete (the tamper): https://tiramisu.explorer.arkiv.network/tx/0xa7947563a6a13ad94fac673b5b40015ad67d7707833eb92666a9fb758e165a0a

**7. Link to `/arkiv/schema.md`:** https://github.com/rogod4rk/witness-arkiv/blob/ee8592c8d774b33ff30a794c744f34f9f1010db4/arkiv/schema.md

**8. How can judges reproduce your Arkiv usage?**

Fastest, no setup and no funds:

1. Open https://arkiv-entry.vercel.app. The demo log is prefilled (writer `0xD7532a8170840b922121e6961093b7c5d9215925`, log id and key from `src/demo.json`: `f1622ce195e2a7bc`). Click Verify. The verdict reads straight from Arkiv, no backend of ours.
2. Open the same writer on the explorer: https://tiramisu.explorer.arkiv.network/address/0xD7532a8170840b922121e6961093b7c5d9215925. Each entry shows a random log id, a counter, a hash and ciphertext.
3. Clear the key field and Verify again: the chain still verifies, the entries stay unreadable.
4. The seeded second log has a deleted entry: Verify it (log id `97c139c402e7c3e9`) and the verdict names the missing sequence number.

The exact query the app runs (paste the writer and log id):

```
project = str('arkiv-witness') AND log = str('<log id>') AND $creator = addr('0xD7532a8170840b922121e6961093b7c5d9215925')
```

In the SDK: `select({...}).where(eq("project", str("arkiv-witness")), eq("log", str(log))).createdBy(writer).limit(200)`. Dropping `$creator` gives the look-alike count.

Re-run everything yourself:

```bash
git clone https://github.com/rogod4rk/witness-arkiv && cd witness-arkiv
npm install
npm test          # offline: chain, tamper, forgery cases (11 tests)
npx tsx scripts/readcheck.ts   # read-only checks against Tiramisu, no funds
npm run key       # creates a throwaway key in .env, prints its address
# claim 10 GLM for that address at https://hub.arkiv.network/faucet (browser, captcha)
npm run e2e       # writes, reads by $creator, tries a patch (must fail), renews, deletes, prints tx links
npm run dev       # app at http://localhost:5173
```

**9. Pre-existing work you reused:** None. Everything, including the Arkiv integration and the verification logic, was built between 9 and 18 October 2026 (first commit 16 October). Libraries only: `@arkiv-network/sdk` 0.8.1, `viem`, Vite, TypeScript. First commit: 6ff59ed, 16 Oct 2026. No earlier baseline exists.

**10. Arkiv surfaces you used:** TypeScript SDK, Direct JSON-RPC (`eth_chainId`, `eth_call` dry run of a batch before spending funds, in `scripts/readcheck.ts` and `scripts/dryrun.ts`), WebSocket events, Docs, Faucet, Block Explorer.

**11. If you selected Other:** leave blank.

**12. How long after you started did you write your first Arkiv entity?** Under 4 hours. First commit 14:32 UTC, first entity 18:03 UTC, both on 16 Oct. Most of that gap was waiting on the captcha faucet.

**13. Which LLMs did you use?** Claude (Anthropic) through Claude Code, for planning, code and docs drafting. All output was reviewed and run by the team.

**14. The one thing Arkiv should improve first:** A headless way to fund a testnet key. Every agent or CI based builder hits the captcha wall before writing a single entity, and the failure that follows (`Execution error without revert data`) does not say the cause is an empty balance. An unauthenticated, rate-limited testnet faucet endpoint, plus an `insufficient funds` error from the SDK, would remove the first hour of friction for everyone.

**15. Open to a 20-minute feedback call?** Yes

**16. Built between 9 and 18 October, pre-existing work disclosed:** tick (answer 9 is "None").

**17. Repo public under MIT, every link accessible:** tick after confirming the repo is public, `LICENSE` is MIT (it is in the repo), the demo video link opens logged out, and the live URL opens in a private window.

**18. Devcon 8 in Mumbai:** Not attending

## Before pressing submit

- Funded `npm run e2e` has run and `src/demo.json` holds the writer, log id and key; the app is redeployed so the prefilled demo log verifies.
- Push, then swap `main` in the links for the judged commit SHA. Never rewrite history after the deadline (18 Oct 2026, 23:59 London).
- No private keys, key material or credentialed RPC URLs in any answer. The demo key in `src/demo.json` encrypts synthetic data only.
