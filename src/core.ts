import { createPublicClient, ExpirationTime, type Entity } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { bytes32, str, u64 } from "@arkiv-network/sdk/attr";
import { and, eq, lt } from "@arkiv-network/sdk/query";
import { concat, hexToBytes, keccak256, stringToHex, toHex, webSocket, http, type Address, type Hex } from "viem";

export const PROJECT = "arkiv-witness";
export const ENTRY_DAYS = 14; // detail records: short, renewed while an audit is open
export const ANCHOR_DAYS = 90; // seals outlive the entries they commit to

export const publicClient = () => createPublicClient({ chain: tiramisu, transport: http() });
// a real socket: watchEntityEvents with a webSocket transport and no fromBlock subscribes instead of polling
export const socketClient = () => createPublicClient({ chain: tiramisu, transport: webSocket() });

export type Event = { t: number; actor: string; action: string; detail: string };
export type Row = { key: Hex; creator: string; type: string; seq: number; chain: Hex; payload: Uint8Array; expiresAt?: bigint };
export type Head = { seq: number; chain: Hex };

// ---- crypto: AES-GCM, key never leaves the client. AAD binds a ciphertext to its log and seq.
const aad = (log: string, seq: number) => new TextEncoder().encode(`${log}:${seq}`);
const aesKey = (raw: Uint8Array, use: KeyUsage) => crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, [use]);
export const newSecret = () => ({ log: toHex(crypto.getRandomValues(new Uint8Array(8))).slice(2), key: toHex(crypto.getRandomValues(new Uint8Array(32))) });

export async function seal(key: Hex, log: string, seq: number, ev: Event): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(log, seq) }, await aesKey(hexToBytes(key), "encrypt"), new TextEncoder().encode(JSON.stringify(ev)));
  return concat([iv, new Uint8Array(ct)]);
}
export async function open(key: Hex, log: string, seq: number, payload: Uint8Array): Promise<Event> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: payload.slice(0, 12), additionalData: aad(log, seq) }, await aesKey(hexToBytes(key), "decrypt"), payload.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---- hash chain: link(n) = keccak(link(n-1) | seq | keccak(payload))
export const genesis = (log: string): Head => ({ seq: 0, chain: keccak256(stringToHex(`witness:${log}`)) });
export const link = (prev: Hex, seq: number, payload: Uint8Array): Hex => keccak256(concat([prev, toHex(BigInt(seq), { size: 8 }), keccak256(payload)]));

const flags = { readonly: true, permissionlessExtension: true } as const;

// One atomic batch: the new entries plus a seal (anchor) over the new head.
export async function buildAppend(key: Hex, log: string, head: Head, events: Event[]) {
  const creates = [];
  let { seq, chain } = head;
  for (const ev of events) {
    seq += 1;
    const payload = await seal(key, log, seq, ev);
    chain = link(chain, seq, payload);
    creates.push({
      payload, contentType: "application/octet-stream", flags,
      attributes: { project: str(PROJECT), type: str("entry"), log: str(log), seq: u64(seq), chain: bytes32(chain) },
      expires: ExpirationTime.fromDays(ENTRY_DAYS),
    });
  }
  creates.push({
    payload: new Uint8Array(), contentType: "application/octet-stream", flags,
    attributes: { project: str(PROJECT), type: str("anchor"), log: str(log), seq: u64(seq), chain: bytes32(chain) },
    expires: ExpirationTime.fromDays(ANCHOR_DAYS),
  });
  return { creates, head: { seq, chain } };
}

// ---- reads
const toRow = (e: Entity): Row => {
  const a = e.attributes as Record<string, { value: unknown }>;
  return { key: e.key as Hex, creator: String(e.creator), type: String(a.type.value), seq: Number(a.seq.value), chain: a.chain.value as Hex, payload: e.payload as Uint8Array, expiresAt: e.expiresAt };
};

// Trusted rows: only entities whose immutable $creator is the writer. Anyone can copy the attributes, nobody can forge $creator.
export async function readLog(pc: ReturnType<typeof publicClient>, writer: Address, log: string) {
  const where = [eq("project", str(PROJECT)), eq("log", str(log))];
  const rows: Row[] = [];
  const trusted = pc.select({ key: true, creator: true, expiresAt: true, payload: true, attributes: true }).where(...where).createdBy(writer).limit(200);
  for await (const e of trusted) rows.push(toRow(e as Entity));
  let all = 0;
  for await (const _ of pc.select({ key: true }).where(...where).limit(200)) all++;
  return { rows, foreign: all - rows.length };
}

export type Verdict = { ok: boolean; issues: string[]; entries: { seq: number; key: Hex; event?: Event }[]; head: Head | null; foreign: number };

export async function verify(rows: Row[], writer: string, log: string, key?: Hex, foreign = 0): Promise<Verdict> {
  const issues: string[] = [];
  const mine = rows.filter((r) => r.creator.toLowerCase() === writer.toLowerCase());
  foreign += rows.length - mine.length;
  const entries = mine.filter((r) => r.type === "entry").sort((a, b) => a.seq - b.seq);
  const anchors = mine.filter((r) => r.type === "anchor");

  const seen = new Set<number>();
  let prev: Hex | null = null;
  let last = 0;
  const out: Verdict["entries"] = [];
  for (const r of entries) {
    if (seen.has(r.seq)) { issues.push(`fork: two entries claim seq ${r.seq}`); continue; }
    seen.add(r.seq);
    if (prev === null) {
      if (r.seq > 1) issues.push(`entries 1..${r.seq - 1} are gone (expired or deleted), checking from seq ${r.seq}`);
      else if (link(genesis(log).chain, 1, r.payload) !== r.chain) issues.push(`seq 1 does not chain from the log genesis`);
    } else if (r.seq !== last + 1) {
      issues.push(`gap: seq ${last + 1}..${r.seq - 1} missing (entries deleted)`);
    } else if (link(prev, r.seq, r.payload) !== r.chain) {
      issues.push(`seq ${r.seq} does not chain from seq ${last}`);
    }
    prev = r.chain; last = r.seq;
    let event: Event | undefined;
    if (key) {
      try { event = await open(key, log, r.seq, r.payload); } catch { issues.push(`seq ${r.seq} fails to decrypt (wrong key or altered ciphertext)`); }
    }
    out.push({ seq: r.seq, key: r.key, event });
  }
  // a seal commits to a head; entries after it may not vanish and the head may not change
  const bySeq = new Map(entries.map((r) => [r.seq, r]));
  for (const a of anchors) {
    const e = bySeq.get(a.seq);
    if (!e) { if (a.seq > last) issues.push(`seal at seq ${a.seq} but the log ends at ${last} (tail deleted)`); }
    else if (e.chain !== a.chain) issues.push(`seal at seq ${a.seq} disagrees with the entry chain`);
  }
  const head = entries.length ? { seq: last, chain: prev as Hex } : null;
  return { ok: issues.length === 0, issues, entries: out, head, foreign };
}

// The next append continues from the verified head, so a tampered log is never extended silently.
export async function headOf(pc: ReturnType<typeof publicClient>, writer: Address, log: string): Promise<Head> {
  const { rows } = await readLog(pc, writer, log);
  const v = await verify(rows, writer, log);
  if (!v.ok) throw new Error(`log fails verification: ${v.issues[0]}`);
  return v.head ?? genesis(log);
}

// Keys of this log's entries that expire within `days`: the set a renewal extends.
export async function expiringKeys(pc: ReturnType<typeof publicClient>, writer: Address, log: string, days: number) {
  const head = await pc.getBlockNumber();
  const keys: Hex[] = [];
  const q = pc.select({ key: true }).where(and(eq("project", str(PROJECT)), eq("log", str(log)), lt("$expiresAt", u64(head + BigInt(days * 43_200))))).createdBy(writer).limit(200);
  for await (const e of q) keys.push(e.key as Hex);
  return keys;
}

export const renewal = (keys: Hex[], days: number) => ({ extensions: keys.map((entityKey) => ({ entityKey, expires: ExpirationTime.fromDays(days) })) });
