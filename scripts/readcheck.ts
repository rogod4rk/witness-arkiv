// Read-only smoke test of the exact queries the app runs. No funds needed.
import { expiringKeys, publicClient, readLog, socketClient, verify } from "../src/core";
const pc = publicClient();
const writer = "0xD7532a8170840b922121e6961093b7c5d9215925";
console.log("chainId", await pc.getChainId(), "head", await pc.getBlockNumber());
const r = await readLog(pc, writer, "00000000deadbeef");
console.log("readLog rows", r.rows.length, "foreign", r.foreign, "verdict", (await verify(r.rows, writer, "00000000deadbeef")).ok);
console.log("expiringKeys", (await expiringKeys(pc, writer, "00000000deadbeef", 15)).length);
let hit = 0;
const un = socketClient().watchEntityEvents({ onEvent: () => hit++, onError: (e) => console.log("ws err", e.message) });
await new Promise((r) => setTimeout(r, 6000));
un();
console.log("websocket events seen in 6s (any wallet):", hit);
process.exit(0);
