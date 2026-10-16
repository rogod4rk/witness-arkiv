# Demo script (about 2:45)

Record the app at the deployed URL. Have the demo log loaded (seed it first with `npm run e2e`, then open the share link). Have the Tiramisu explorer open in a second tab on one of the transactions.

**0:00 to 0:20, the problem**
"This is a company's admin audit log: who granted access, who rotated a key, who exported data. Normally it lives in a database an admin can edit. After an incident, the log is the first thing that gets cleaned up, and the auditor has to trust the operator's export. Witness fixes that without publishing anything readable."

**0:20 to 0:50, what the explorer shows** (switch to explorer tab)
"Here is one entry on Arkiv's explorer. Three attributes: a random log id, a counter, and a hash. The payload is ciphertext. No names, no actions. The key never touched a server, it is in the URL fragment of the share link."

**0:50 to 1:25, audit** (app tab, "Audit a log")
"The auditor needs only the writer's address and the log id. The app reads straight from Arkiv, no backend of ours. It filters by dollar-creator, the immutable on-chain creator, so it only trusts entities that wallet wrote. It recomputed the hash chain from genesis: intact. With the key, the entries decrypt. Without it, they are just bytes."

**1:25 to 1:55, forgery and tampering**
"Anyone can copy our attributes onto their own entity. Look: one look-alike from another wallet, ignored and counted, because its creator is not the writer. Entries are read-only, so nobody can patch them. The owner could still delete one. Watch." (run the delete from the e2e output or show the pre-made tamper log) "Gap at sequence two. The seal catches a deleted tail too."

**1:55 to 2:25, live and lifetimes**
"Append an event." (click Append) "One atomic batch: the entry and a seal over the new head. The page updates over a websocket, no refresh loop. Entries live fourteen days, seals ninety, so a deleted tail stays detectable after entries expire. Entries are created so anyone can extend them. Here the auditor clicks Renew, and the range query on expires-at finds exactly what is about to disappear."

**2:25 to 2:45, why Arkiv**
"On Postgres the operator rewrites history. On IPFS there is no creator, no expiry, no query. A subgraph is an indexer someone runs. Here the creator, the read-only flag, the expiry and the query all come from the chain. What stays off Arkiv: the key and the plaintext. Witness, on Arkiv."
