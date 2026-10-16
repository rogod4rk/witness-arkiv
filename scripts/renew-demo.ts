// Keeps the judges' demo logs alive: extends every live entry and seal of both logs in src/demo.json by 60 days.
// Needs the funded PRIVATE_KEY in .env (the writer of the demo logs).
import "dotenv/config";
import { createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import demo from "../src/demo.json" with { type: "json" };
import { publicClient, readLog, renewal, verify } from "../src/core";

const DAYS = 60;
const pc = publicClient();
const A = createWalletClient({ chain: tiramisu, transport: http(), account: privateKeyToAccount(process.env.PRIVATE_KEY as Hex) });
if (A.account.address.toLowerCase() !== demo.writer.toLowerCase()) throw new Error("PRIVATE_KEY is not the demo writer");
const need = (c: boolean, m: string) => { if (!c) throw new Error(`FAILED: ${m}`); console.log(`ok: ${m}`); };
const logs = [demo, demo.tamperLog];

// an extension sets a new expiry and the engine rejects one that is not later, so a seal that already has more than DAYS left is skipped
const target = (await pc.getBlockNumber()) + BigInt(DAYS * 43_200);
const keys: Hex[] = [];
for (const l of logs) {
  const { rows } = await readLog(pc, demo.writer as Hex, l.log);
  for (const r of rows) if (r.expiresAt !== undefined && r.expiresAt < target) keys.push(r.key);
  console.log(l.log, rows.length, "rows,", keys.length, "to extend so far");
}
const tx = await A.executeBatch(renewal(keys, DAYS));
console.log("renew tx", `https://tiramisu.explorer.arkiv.network/tx/${tx.txHash}`, "extended", keys.length);

const r1 = await readLog(pc, demo.writer as Hex, demo.log);
const v1 = await verify(r1.rows, demo.writer, demo.log, { key: demo.key, nowBlock: r1.block });
console.log("demo log rows", r1.rows.length, "ok", v1.ok, v1.issues);
need(v1.ok && v1.entries.length === 4, "demo log verifies ok");
const r2 = await readLog(pc, demo.writer as Hex, demo.tamperLog.log);
const v2 = await verify(r2.rows, demo.writer, demo.tamperLog.log, { key: demo.tamperLog.key, nowBlock: r2.block });
console.log("tamper log rows", r2.rows.length, "ok", v2.ok, v2.issues);
need(!v2.ok && v2.issues.some((i) => /gap/.test(i)), "tamper log is flagged with a gap");
process.exit(0);
