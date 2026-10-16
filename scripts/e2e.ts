// Real write+read against Tiramisu. Needs a funded PRIVATE_KEY in .env (see README, "Fund the key").
// Optional SECOND_KEY (also funded) exercises the foreign-creator and permissionless-extension paths.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { bytes32, str, u64 } from "@arkiv-network/sdk/attr";
import { http, formatEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildAppend, ENTRY_DAYS, expiringKeys, genesis, headOf, newSecret, PROJECT, publicClient, readLog, renewal, socketClient, verify, type Event } from "../src/core";

const pc = publicClient();
const explorer = "https://tiramisu.explorer.arkiv.network";
const wallet = (pk: Hex) => createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(pk) });
const A = wallet(process.env.PRIVATE_KEY as Hex);
const writer = A.account.address;
const ev = (n: number, action: string): Event => ({ t: Date.now() + n, actor: `svc-${n}`, action, detail: `synthetic event ${n}` });
const step = (s: string) => console.log(`\n== ${s}`);
const need = (c: boolean, m: string) => { if (!c) throw new Error(`FAILED: ${m}`); console.log(`ok: ${m}`); };

step("setup");
console.log("chain", await pc.getChainId(), "writer", writer);
for (let i = 0; (await pc.getBalance({ address: writer })) === 0n; i++) {
  if (i === 0) console.log(`balance is 0. Fund ${writer} at https://hub.arkiv.network/faucet (waiting up to 10 min)`);
  if (i > 120) throw new Error("no funds");
  await new Promise((r) => setTimeout(r, 5000));
}
console.log("balance GLM", formatEther(await pc.getBalance({ address: writer })));

step("1. clean log: one atomic batch (3 entries + seal) while a websocket watcher listens");
const { log, key } = newSecret();
const seen: string[] = [];
const unwatch = socketClient().watchEntityEvents({ onEntityCreated: (e) => { if (e.owner === writer) seen.push(e.entityKey); }, onError: (e) => console.log("ws error", e.message) });
await new Promise((r) => setTimeout(r, 3000));
const first = await buildAppend(key, log, genesis(log), [ev(1, "role.grant"), ev(2, "key.rotate"), ev(3, "export.run")]);
const w1 = await A.executeBatch({ creates: first.creates });
console.log("tx", `${explorer}/tx/${w1.txHash}`, "entities", w1.createdEntities.length);
for (let i = 0; i < 15 && seen.length < 4; i++) await new Promise((r) => setTimeout(r, 1000));
unwatch();
need(seen.length === 4, `websocket delivered ${seen.length}/4 EntityCreated events without polling`);

step("2. read back with a fresh public client, filtered by $creator, verify, decrypt");
const r1 = await readLog(pc, writer, log);
const v1 = await verify(r1.rows, writer, log, { key, foreign: r1.foreign, nowBlock: r1.block });
console.log("query: project = str('%s') AND log = str('%s') AND $creator = addr('%s')", PROJECT, log, writer);
need(v1.ok && v1.entries.length === 3, `3 entries chain from genesis, issues=[${v1.issues}]`);
need(v1.entries[1].event?.action === "key.rotate", "payload decrypts to the synthetic event");

step("3. append continues from the verified head");
const head = await headOf(pc, writer, log);
const second = await buildAppend(key, log, head, [ev(4, "role.revoke")]);
const w2 = await A.executeBatch({ creates: second.creates });
console.log("tx", `${explorer}/tx/${w2.txHash}`);
const r2 = await readLog(pc, writer, log);
const v2 = await verify(r2.rows, writer, log, { key, nowBlock: r2.block });
need(v2.ok && v2.entries.length === 4 && v2.head?.seq === 4, "log is now 4 entries, still valid");

step("4. readonly: a patch must be rejected");
try { await A.patchEntity({ entityKey: w1.createdEntities[0], set: { seq: u64(99) } }); need(false, "patch was accepted"); }
catch (e) { need(/ReadOnlyEntity|created readonly/i.test((e as Error).message), `patch rejected: ${(e as Error).message.slice(0, 80)}`); }

step("5. lease: extend entries expiring soon (range query on $expiresAt)");
const keys = await expiringKeys(pc, writer, log, ENTRY_DAYS + 1);
// only the 4 entries (14 day lease) fall inside the window, the 90 day seals do not
need(keys.length === 4, `${keys.length} entries expire within ${ENTRY_DAYS + 1} days (expected exactly 4)`);
const ext = await A.executeBatch(renewal(keys, ENTRY_DAYS + 7));
console.log("tx", `${explorer}/tx/${ext.txHash}`);

step("6. tamper: delete entry 2 of a second log, verify must flag the gap");
const t = newSecret();
const tl = await buildAppend(t.key, t.log, genesis(t.log), [ev(1, "a"), ev(2, "b"), ev(3, "c")]);
const tw = await A.executeBatch({ creates: tl.creates });
const del = await A.deleteEntity({ entityKey: tw.createdEntities[1] });
console.log("tamper log", t.log, "\nbatch tx", `${explorer}/tx/${tw.txHash}`, "\ndelete tx", `${explorer}/tx/${del.txHash}`);
const rt = await readLog(pc, writer, t.log);
const vt = await verify(rt.rows, writer, t.log, { key: t.key, foreign: rt.foreign, nowBlock: rt.block });
console.log("issues:", vt.issues);
need(!vt.ok && vt.issues.some((i) => /gap/.test(i)), "deleted entry detected as a gap");

step("7. forged entry from another wallet (needs SECOND_KEY funded)");
if (process.env.SECOND_KEY) {
  const B = wallet(process.env.SECOND_KEY as Hex);
  const forged = await B.createEntity({
    payload: new Uint8Array([1, 2, 3]), contentType: "application/octet-stream", expires: ExpirationTime.fromDays(1),
    attributes: { project: str(PROJECT), type: str("entry"), log: str(log), seq: u64(5), chain: bytes32(v2.head!.chain) },
    flags: { readonly: true, permissionlessExtension: true },
  });
  console.log("forger", B.account.address, "tx", `${explorer}/tx/${forged.txHash}`);
  const r3 = await readLog(pc, writer, log);
  need(r3.foreign === 1 && (await verify(r3.rows, writer, log, { key, foreign: r3.foreign, nowBlock: r3.block })).ok, "forged entry ignored by $creator filter, counted as foreign");
  const ext2 = await B.extendEntity({ entityKey: w1.createdEntities[0], expires: ExpirationTime.fromDays(ENTRY_DAYS + 9) });
  console.log("permissionless extension by non-owner, tx", `${explorer}/tx/${ext2.txHash}`);
} else console.log("SKIPPED: set SECOND_KEY in .env to a funded wallet");

writeFileSync(new URL("../src/demo.json", import.meta.url), JSON.stringify({ writer, log, key, tamperLog: { log: t.log, key: t.key } }, null, 2) + "\n");
console.log("\nDEMO LOG", JSON.stringify({ writer, log }), "\nALL CHECKS PASSED");
process.exit(0);
