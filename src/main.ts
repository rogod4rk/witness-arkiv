import { createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { formatEther, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildAppend, ENTRY_DAYS, expiringKeys, headOf, newSecret, publicClient, readLog, renewal, socketClient, verify } from "./core";
import demo from "./demo.json";

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const pc = publicClient();
const explorer = "https://tiramisu.explorer.arkiv.network";

// inputs: URL fragment first, then the seeded demo log
const frag = new URLSearchParams(location.hash.slice(1));
$("w").value = frag.get("w") ?? demo.writer;
$("l").value = frag.get("l") ?? demo.log;
$("k").value = frag.get("k") ?? demo.key;

// wallet: throwaway key in localStorage (testnet only)
let pk = localStorage.getItem("witness.pk") as Hex | null;
if (!pk) localStorage.setItem("witness.pk", (pk = generatePrivateKey()));
const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ chain: tiramisu, transport: http(), account });
const mine = () => JSON.parse(localStorage.getItem("witness.log") ?? "null") as { log: string; key: Hex } | null;
const startLog = () => { const s = newSecret(); localStorage.setItem("witness.log", JSON.stringify(s)); return s; };

async function refreshAccount() {
  const bal = await pc.getBalance({ address: account.address });
  const el = $<HTMLElement>("acct");
  el.textContent = `Writer ${account.address}, balance ${formatEther(bal)} GLM. `;
  if (bal === 0n) el.append(Object.assign(document.createElement("a"), { href: "https://hub.arkiv.network/faucet", target: "_blank", textContent: "Get test GLM from the faucet." }));
}

// audit
const li = (parent: HTMLElement, text: string, cls = "") => { const e = document.createElement("li"); e.className = cls; e.textContent = text; parent.append(e); };
let stop = () => {};
async function runVerify() {
  const writer = $("w").value.trim() as Address, log = $("l").value.trim(), key = ($("k").value.trim() || undefined) as Hex | undefined;
  const out = $<HTMLElement>("out");
  if (!writer || !log) { out.textContent = "Enter a writer address and a log id."; return; }
  out.textContent = "Reading from Arkiv...";
  const { rows, foreign } = await readLog(pc, writer, log);
  const v = await verify(rows, writer, log, key, foreign);
  out.replaceChildren();
  const h = document.createElement("div");
  h.className = `verdict ${v.ok ? "ok" : "bad"}`;
  h.textContent = !rows.length ? "No entries found for this writer and log" : v.ok ? `Intact: ${v.entries.length} entries chain from genesis` : "TAMPERING OR LOSS DETECTED";
  out.append(h);
  const ul = document.createElement("ul");
  v.issues.forEach((i) => li(ul, i, "bad"));
  if (v.foreign) li(ul, `${v.foreign} look-alike entr${v.foreign === 1 ? "y" : "ies"} from other wallets ignored (not the writer's $creator)`);
  for (const e of v.entries) li(ul, `#${e.seq} ${e.event ? `${new Date(e.event.t).toISOString()} ${e.event.actor} ${e.event.action} ${e.event.detail}` : "(encrypted, no key)"}  ${e.key.slice(0, 14)}...`);
  out.append(ul);
  if (v.head) { const c = document.createElement("code"); c.textContent = `head: seq ${v.head.seq}, chain ${v.head.chain}`; out.append(c); }
  stop();
  // live tail over a websocket: re-verify when the writer creates something
  stop = socketClient().watchEntityEvents({ onEntityCreated: (e) => { if (e.owner.toLowerCase() === writer.toLowerCase()) runVerify(); }, onError: (e) => console.warn(e) });
}
$("verify").onclick = () => runVerify().catch((e) => ($<HTMLElement>("out").textContent = String(e.message ?? e)));
$("share").onclick = async () => {
  const p = new URLSearchParams({ w: $("w").value, l: $("l").value, k: $("k").value });
  await navigator.clipboard.writeText(`${location.origin}${location.pathname}#${p}`);
  $<HTMLElement>("wout").textContent = "Share link copied. The key lives in the fragment, so no server ever sees it.";
};

// write
const say = (m: string) => ($<HTMLElement>("wout").textContent = m);
const busy = async (b: HTMLButtonElement, f: () => Promise<void>) => { b.disabled = true; try { await f(); } catch (e) { say(`Failed: ${(e as Error).message.slice(0, 200)}`); } finally { b.disabled = false; refreshAccount(); } };

$<HTMLButtonElement>("append").onclick = (ev) => busy(ev.currentTarget as HTMLButtonElement, async () => {
  const s = mine() ?? startLog();
  say("Verifying the existing log, then writing one atomic batch...");
  const head = await headOf(pc, account.address, s.log);
  const { creates } = await buildAppend(s.key, s.log, head, [{ t: Date.now(), actor: $("actor").value, action: $("action").value, detail: $("detail").value }]);
  const r = await wallet.executeBatch({ creates });
  $("w").value = account.address; $("l").value = s.log; $("k").value = s.key;
  say(`Written. Transaction ${explorer}/tx/${r.txHash}`);
  await runVerify();
});
$<HTMLButtonElement>("fresh").onclick = () => { startLog(); say("New empty log started. Append to write its first entry."); };
$<HTMLButtonElement>("renew").onclick = (ev) => busy(ev.currentTarget as HTMLButtonElement, async () => {
  const log = $("l").value.trim(), writer = $("w").value.trim() as Address;
  const keys = await expiringKeys(pc, writer, log, ENTRY_DAYS);
  if (!keys.length) { say("Nothing expires soon."); return; }
  const r = await wallet.executeBatch(renewal(keys, ENTRY_DAYS * 2));
  say(`Extended ${keys.length} entries. Anyone can do this, the writer does not have to. ${explorer}/tx/${r.txHash}`);
});

refreshAccount();
if ($("w").value && $("l").value) runVerify().catch(console.warn);
