import { createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { formatEther, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildAppend, ENTRY_DAYS, expiringKeys, headOf, newSecret, publicClient, readLog, renewal, socketClient, verify, type Head } from "./core";
import demo from "./demo.json";

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const pc = publicClient();
const explorer = "https://tiramisu.explorer.arkiv.network";

// inputs: URL fragment first, then the seeded demo log
const frag = new URLSearchParams(location.hash.slice(1));
$("w").value = frag.get("w") ?? demo.writer;
$("l").value = frag.get("l") ?? demo.log;
$("k").value = frag.get("k") ?? demo.key;
$("c").value = frag.get("c") ?? "";

// auditor checkpoint: "seq:hash" of a head the auditor has seen. Verify fails if the chain no longer contains it.
const pinKey = (log: string) => `witness.head.${log}`;
const parseHead = (v: string): Head | undefined => { const m = /^(\d+):(0x[0-9a-fA-F]{64})$/.exec(v.trim()); return m ? { seq: Number(m[1]), chain: m[2] as Hex } : undefined; };
const showHead = (h: Head) => `${h.seq}:${h.chain}`;

// wallet: throwaway key in localStorage (testnet only)
let pk = localStorage.getItem("witness.pk") as Hex | null;
if (!pk) localStorage.setItem("witness.pk", (pk = generatePrivateKey()));
const account = privateKeyToAccount(pk);
const wallet = createWalletClient({ chain: tiramisu, transport: http(), account });
// keys are kept per log id, so starting a new log never discards the key of an older one
const keys = () => JSON.parse(localStorage.getItem("witness.keys") ?? "{}") as Record<string, Hex>;
const saveKey = (log: string, key: Hex) => { localStorage.setItem("witness.keys", JSON.stringify({ ...keys(), [log]: key })); localStorage.setItem("witness.cur", log); };
const legacy = localStorage.getItem("witness.log");
if (legacy) { const o = JSON.parse(legacy); if (o) saveKey(o.log, o.key); localStorage.removeItem("witness.log"); }
const mine = () => { const log = localStorage.getItem("witness.cur"); return log && keys()[log] ? { log, key: keys()[log] } : null; };
const startLog = () => { const s = newSecret(); saveKey(s.log, s.key); return s; };

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
  const writer = $("w").value.trim() as Address, log = $("l").value.trim();
  if (log && !$("k").value.trim() && keys()[log]) $("k").value = keys()[log];
  const key = $("k").value.trim() || undefined;
  const out = $<HTMLElement>("out");
  if (!writer || !log) { out.textContent = "Enter a writer address and a log id."; return; }
  out.textContent = "Reading from Arkiv...";
  const { rows, foreign, block } = await readLog(pc, writer, log);
  const typed = $("c").value.trim();
  const checkpoint = parseHead(typed) ?? (typed ? undefined : parseHead(localStorage.getItem(pinKey(log)) ?? ""));
  const v = await verify(rows, writer, log, { key, foreign, nowBlock: block, checkpoint });
  if (typed && !checkpoint) v.issues.push("checkpoint must look like seq:0xhash (66 hex chars after the colon)");
  out.replaceChildren();
  const h = document.createElement("div");
  h.className = `verdict ${v.ok ? "ok" : "bad"}`;
  h.textContent = !rows.length ? "No entries found for this writer and log" : v.ok ? `Intact: ${v.entries.length} entries chain from ${v.expired ? "the surviving seals" : "genesis"}${checkpoint ? `, consistent with checkpoint at seq ${checkpoint.seq}` : ", no checkpoint pinned (the writer could have rewritten history)"}` : "TAMPERING OR LOSS DETECTED";
  out.append(h);
  const ul = document.createElement("ul");
  v.issues.forEach((i) => li(ul, i, "bad"));
  if (v.keyProblem) li(ul, `Key problem: ${v.keyProblem}`, "bad");
  if (v.expired) li(ul, `expired (normal): ${v.expired} entr${v.expired === 1 ? "y" : "ies"} aged out after ${ENTRY_DAYS} days, their seals remain`);
  if (v.foreign) li(ul, `${v.foreign} look-alike entr${v.foreign === 1 ? "y" : "ies"} from other wallets ignored (not the writer's $creator)`);
  for (const e of v.entries) li(ul, `#${e.seq} ${e.event ? `${new Date(e.event.t).toISOString()} ${e.event.actor} ${e.event.action} ${e.event.detail}` : "(encrypted, no key)"}  ${e.key.slice(0, 14)}...`);
  out.append(ul);
  if (v.head) { const c = document.createElement("code"); c.textContent = `head: seq ${v.head.seq}, chain ${v.head.chain}`; out.append(c); }
  // pin the newest verified head so later runs catch a rewrite of anything up to it
  if (v.ok && v.head && v.head.seq >= (parseHead(localStorage.getItem(pinKey(log)) ?? "")?.seq ?? 0)) localStorage.setItem(pinKey(log), showHead(v.head));
  stop();
  // live tail over a websocket: re-verify when the writer creates something
  const again = (e: { owner: string }) => { if (e.owner.toLowerCase() === writer.toLowerCase()) runVerify(); };
  stop = socketClient().watchEntityEvents({ onEntityCreated: again, onEntityDeleted: again, onError: (e) => console.warn(e) });
}
$("verify").onclick = () => runVerify().catch((e) => ($<HTMLElement>("out").textContent = String(e.message ?? e)));
$("share").onclick = async () => {
  const p = new URLSearchParams({ w: $("w").value, l: $("l").value, k: $("k").value, c: $("c").value || localStorage.getItem(pinKey($("l").value.trim())) || "" });
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
$<HTMLButtonElement>("fresh").onclick = () => { const old = mine(); const s = startLog(); say(`New empty log ${s.log} started. ${old ? `The key of ${old.log} stays saved in this browser. ` : ""}Append to write its first entry.`); };
$<HTMLButtonElement>("renew").onclick = (ev) => busy(ev.currentTarget as HTMLButtonElement, async () => {
  const log = $("l").value.trim(), writer = $("w").value.trim() as Address;
  const keys = await expiringKeys(pc, writer, log, ENTRY_DAYS);
  if (!keys.length) { say("Nothing expires soon."); return; }
  const r = await wallet.executeBatch(renewal(keys, ENTRY_DAYS * 2));
  say(`Extended ${keys.length} entries. Anyone can do this, the writer does not have to. ${explorer}/tx/${r.txHash}`);
});

refreshAccount();
if ($("w").value && $("l").value) runVerify().catch(console.warn);
