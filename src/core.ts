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
export type Row = { key: Hex; creator: string; type: string; seq: number; chain: Hex; payload: Uint8Array; expiresAt?: bigint; createdAt?: bigint; updatedAt?: bigint; readonly?: boolean };
export type Head = { seq: number; chain: Hex };

// ---- crypto: AES-GCM, key never leaves the client. AAD binds a ciphertext to its log and seq.
const aad = (log: string, seq: number) => new TextEncoder().encode(`${log}:${seq}`);
const aesKey = (raw: Uint8Array, use: KeyUsage) => crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-GCM", false, [use]);
export const newSecret = () => ({ log: toHex(crypto.getRandomValues(new Uint8Array(8))).slice(2), key: toHex(crypto.getRandomValues(new Uint8Array(32))) });

// 32 bytes of hex, with or without the 0x. Anything else is a typo, not a decryption result.
export function parseKey(raw: string): Hex {
  const k = raw.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new Error("key must be 64 hex characters (32 bytes)");
  return `0x${k}`;
}

export async function seal(key: Hex, log: string, seq: number, ev: Event): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(log, seq) }, await aesKey(hexToBytes(parseKey(key)), "encrypt"), new TextEncoder().encode(JSON.stringify(ev)));
  return concat([iv, new Uint8Array(ct)]);
}
export async function open(key: Hex, log: string, seq: number, payload: Uint8Array): Promise<Event> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: payload.slice(0, 12), additionalData: aad(log, seq) }, await aesKey(hexToBytes(parseKey(key)), "decrypt"), payload.slice(12));
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
  return { key: e.key as Hex, creator: String(e.creator), type: String(a.type.value), seq: Number(a.seq.value), chain: a.chain.value as Hex, payload: e.payload as Uint8Array, expiresAt: e.expiresAt, createdAt: e.createdAt, updatedAt: e.updatedAt, readonly: e.creationFlags?.readonly };
};

// Trusted rows: only entities whose immutable $creator is the writer. Anyone can copy the attributes, nobody can forge $creator.
// Both queries read the same block, so the foreign count cannot drift against the trusted rows.
export async function readLog(pc: ReturnType<typeof publicClient>, writer: Address, log: string) {
  const where = [eq("project", str(PROJECT)), eq("log", str(log))];
  const block = await pc.getBlockNumber();
  const rows: Row[] = [];
  const trusted = pc.select({ key: true, creator: true, createdAt: true, updatedAt: true, expiresAt: true, creationFlags: true, payload: true, attributes: true }).where(...where).createdBy(writer).atBlock(block).limit(200);
  for await (const e of trusted) rows.push(toRow(e as Entity));
  let all = 0;
  for await (const _ of pc.select({ key: true }).where(...where).atBlock(block).limit(200)) all++;
  return { rows, foreign: all - rows.length, block };
}

export type Verdict = {
  ok: boolean; issues: string[]; entries: { seq: number; key: Hex; event?: Event }[]; head: Head | null; foreign: number;
  expired: number; // entries that aged out normally (their seal is older than ENTRY_DAYS), not tampering
  keyProblem?: string; // malformed key, or a key that fails on a row whose chain checks out: not tampering
};
export type VerifyOpts = { key?: string; foreign?: number; nowBlock?: bigint; checkpoint?: Head };

const BLOCKS_PER_DAY = 43_200;

export async function verify(rows: Row[], writer: string, log: string, opts: VerifyOpts = {}): Promise<Verdict> {
  const issues: string[] = [];
  let keyProblem: string | undefined;
  let key: Hex | undefined;
  if (opts.key) { try { key = parseKey(opts.key); } catch (e) { keyProblem = (e as Error).message; } }
  const mine = rows.filter((r) => r.creator.toLowerCase() === writer.toLowerCase());
  const foreign = (opts.foreign ?? 0) + rows.length - mine.length;
  const entries = mine.filter((r) => r.type === "entry").sort((a, b) => a.seq - b.seq);
  const anchors = mine.filter((r) => r.type === "anchor").sort((a, b) => a.seq - b.seq);

  // trusted rows must be frozen: read-only and never patched
  for (const r of mine) {
    if (r.readonly !== true) issues.push(`${r.type} seq ${r.seq} is not read-only`);
    // readonly entities reject content patches on chain; only extensions bump updatedAt, so a bump is only suspicious without readonly
    if (r.readonly !== true && r.updatedAt !== undefined && r.createdAt !== undefined && r.updatedAt > r.createdAt) issues.push(`${r.type} seq ${r.seq} was updated after creation`);
  }

  // Normal expiry is a missing prefix or a fully expired log, and only when the first seal covering the seq is older than
  // the entry lifetime. A hole with a surviving entry before it is a deletion at any age.
  const expired = new Set<number>();
  const aged = (seq: number) => {
    const a = anchors.find((x) => x.seq >= seq);
    return opts.nowBlock !== undefined && a?.createdAt !== undefined && opts.nowBlock - a.createdAt > BigInt(ENTRY_DAYS * BLOCKS_PER_DAY);
  };
  const lost = (from: number, to: number) => {
    const live = [];
    for (let s = from; s <= to; s++) aged(s) ? expired.add(s) : live.push(s);
    return live.length ? `${live[0]}..${live.at(-1)}` : "";
  };

  const seen = new Set<number>();
  let prev: Hex | null = null;
  let last = 0;
  const out: Verdict["entries"] = [];
  for (const r of entries) {
    if (seen.has(r.seq)) { issues.push(`fork: two entries claim seq ${r.seq}`); continue; }
    seen.add(r.seq);
    let checked = false;
    if (prev === null) {
      if (r.seq > 1) { const m = lost(1, r.seq - 1); if (m) issues.push(`entries ${m} are gone (deleted), checking from seq ${r.seq}`); }
      else { checked = true; if (link(genesis(log).chain, 1, r.payload) !== r.chain) issues.push(`seq 1 does not chain from the log genesis`); }
    } else if (r.seq !== last + 1) {
      issues.push(`gap: seq ${last + 1}..${r.seq - 1} missing (entries deleted)`);
    } else {
      checked = true;
      if (link(prev, r.seq, r.payload) !== r.chain) issues.push(`seq ${r.seq} does not chain from seq ${last}`);
    }
    prev = r.chain; last = r.seq;
    let event: Event | undefined;
    if (key) {
      try { event = await open(key, log, r.seq, r.payload); }
      catch {
        if (checked) keyProblem ??= `the key does not decrypt seq ${r.seq}, but the hash chain is intact: wrong key, not tampering`;
        else issues.push(`seq ${r.seq} fails to decrypt and its chain link could not be checked (wrong key or altered ciphertext)`);
      }
    }
    out.push({ seq: r.seq, key: r.key, event });
  }
  // a seal commits to a head; entries after it may not vanish and the head may not change
  const bySeq = new Map(entries.map((r) => [r.seq, r]));
  for (const a of anchors) {
    const e = bySeq.get(a.seq);
    if (!e) {
      if (a.seq > last) {
        const m = last ? `${last + 1}..${a.seq}` : lost(1, a.seq);
        if (m) issues.push(`seal at seq ${a.seq} but the log ends at ${last} (tail deleted)`);
      }
    } else if (e.chain !== a.chain) issues.push(`seal at seq ${a.seq} disagrees with the entry chain`);
  }
  // the head is the furthest point an entry or a seal vouches for, so appends continue after entry expiry
  const top = anchors.at(-1);
  const head: Head | null = top && top.seq > last ? { seq: top.seq, chain: top.chain } : entries.length ? { seq: last, chain: prev as Hex } : null;

  const cp = opts.checkpoint;
  if (cp && ![...entries, ...anchors].some((r) => r.seq === cp.seq && r.chain.toLowerCase() === cp.chain.toLowerCase())) {
    issues.push(`history rewritten since checkpoint: the chain no longer contains hash ${cp.chain.slice(0, 12)}... at seq ${cp.seq}`);
  }
  return { ok: issues.length === 0, issues, entries: out, head, foreign, expired: expired.size, keyProblem };
}

// The next append continues from the verified head, so a tampered log is never extended silently.
export async function headOf(pc: ReturnType<typeof publicClient>, writer: Address, log: string): Promise<Head> {
  const { rows, block } = await readLog(pc, writer, log);
  const v = await verify(rows, writer, log, { nowBlock: block });
  if (!v.ok) throw new Error(`log fails verification: ${v.issues[0]}`);
  return v.head ?? genesis(log);
}

// Keys of this log's entries that expire within `days`: the set a renewal extends.
export async function expiringKeys(pc: ReturnType<typeof publicClient>, writer: Address, log: string, days: number) {
  const head = await pc.getBlockNumber();
  const keys: Hex[] = [];
  const q = pc.select({ key: true }).where(and(eq("project", str(PROJECT)), eq("type", str("entry")), eq("log", str(log)), lt("$expiresAt", u64(head + BigInt(days * 43_200))))).createdBy(writer).limit(200);
  for await (const e of q) keys.push(e.key as Hex);
  return keys;
}

export const renewal = (keys: Hex[], days: number) => ({ extensions: keys.map((entityKey) => ({ entityKey, expires: ExpirationTime.fromDays(days) })) });
