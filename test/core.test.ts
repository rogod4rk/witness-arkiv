import test from "node:test";
import assert from "node:assert/strict";
import { buildAppend, ENTRY_DAYS, genesis, newSecret, parseKey, verify, type Event, type Head, type Row } from "../src/core";

const W = "0x1111111111111111111111111111111111111111";
const ev = (n: number): Event => ({ t: n, actor: "svc-admin", action: "role.grant", detail: `synthetic ${n}` });

async function fixture() {
  const { log, key } = newSecret();
  const { creates } = await buildAppend(key, log, genesis(log), [ev(1), ev(2), ev(3)]);
  const rows: Row[] = creates.map((c, i) => ({
    key: `0x${String(i).padStart(64, "0")}`, creator: W, type: c.attributes.type.value as string,
    seq: Number(c.attributes.seq.value), chain: c.attributes.chain.value as `0x${string}`, payload: c.payload,
    createdAt: 100n, updatedAt: 100n, readonly: true,
  }));
  return { log, key, rows };
}

test("clean log verifies and decrypts", async () => {
  const { log, key, rows } = await fixture();
  const v = await verify(rows, W, log, { key });
  assert.equal(v.ok, true, v.issues.join());
  assert.deepEqual(v.entries.map((e) => e.event?.detail), ["synthetic 1", "synthetic 2", "synthetic 3"]);
});

test("altered payload is caught", async () => {
  const { log, key, rows } = await fixture();
  rows[1].payload = rows[1].payload.slice().fill(7, 14);
  assert.equal((await verify(rows, W, log, { key })).ok, false);
});

test("deleted middle entry is a gap", async () => {
  const { log, rows } = await fixture();
  const v = await verify(rows.filter((r) => r.seq !== 2), W, log);
  assert.match(v.issues.join(), /gap/);
});

test("deleted tail is caught by the seal", async () => {
  const { log, rows } = await fixture();
  const v = await verify(rows.filter((r) => r.seq !== 3 || r.type === "anchor"), W, log);
  assert.match(v.issues.join(), /tail deleted/);
});

test("entries from another creator are ignored and counted", async () => {
  const { log, rows } = await fixture();
  const forged: Row = { ...rows[0], key: "0xff", creator: "0x2222222222222222222222222222222222222222", seq: 4 };
  const v = await verify([...rows, forged], W, log);
  assert.equal(v.ok, true);
  assert.equal(v.foreign, 1);
});

const days = (n: number) => BigInt(n * 43_200);

test("wrong key is a key problem, not tampering", async () => {
  const { log, rows } = await fixture();
  const v = await verify(rows, W, log, { key: newSecret().key });
  assert.equal(v.ok, true);
  assert.match(v.keyProblem ?? "", /wrong key, not tampering/);
});

test("key format is validated, with or without 0x", async () => {
  const { log, key, rows } = await fixture();
  assert.throws(() => parseKey("0x1234"), /64 hex/);
  assert.equal((await verify(rows, W, log, { key: "zz" })).keyProblem, "key must be 64 hex characters (32 bytes)");
  const v = await verify(rows, W, log, { key: key.slice(2) });
  assert.equal(v.ok, true);
  assert.equal(v.keyProblem, undefined);
  assert.equal(v.entries[0].event?.detail, "synthetic 1");
});

test("checkpoint catches a writer rewrite of history", async () => {
  const { log, key, rows } = await fixture();
  const cp: Head = (await verify(rows, W, log)).head!;
  assert.equal((await verify(rows, W, log, { checkpoint: cp })).ok, true);
  // writer deletes entry 3 and its seal, re-appends a different seq 3 with the same key
  const kept = rows.filter((r) => r.seq < 3);
  const re = await buildAppend(key, log, { seq: 2, chain: kept.find((r) => r.type === "entry" && r.seq === 2)!.chain }, [{ ...ev(3), detail: "FORGED" }]);
  const forged: Row[] = re.creates.map((c, i) => ({ key: `0x${(90 + i).toString(16)}`, creator: W, type: c.attributes.type.value as string, seq: Number(c.attributes.seq.value), chain: c.attributes.chain.value as `0x${string}`, payload: c.payload, createdAt: 100n, updatedAt: 100n, readonly: true }));
  const rewritten = [...kept, ...forged];
  assert.equal((await verify(rewritten, W, log)).ok, true, "without a checkpoint the rewrite is invisible");
  const v = await verify(rewritten, W, log, { checkpoint: cp });
  assert.equal(v.ok, false);
  assert.match(v.issues.join(), /history rewritten since checkpoint/);
});

test("rows that are not read-only or were patched are flagged", async () => {
  const { log, rows } = await fixture();
  const open_ = rows.map((r, i) => (i === 0 ? { ...r, readonly: false } : r));
  assert.match((await verify(open_, W, log)).issues.join(), /not read-only/);
  const patched = rows.map((r, i) => (i === 1 ? { ...r, readonly: undefined, updatedAt: 200n } : r));
  assert.match((await verify(patched, W, log)).issues.join(), /updated after creation/);
  const renewed = rows.map((r) => ({ ...r, updatedAt: 200n }));
  assert.deepEqual((await verify(renewed, W, log)).issues, []);
});

test("natural expiry is reported separately and does not fail the log", async () => {
  const { log, key, rows } = await fixture();
  const now = 100n + days(ENTRY_DAYS + 1);
  const gone = rows.filter((r) => r.type === "anchor");
  const v = await verify(gone, W, log, { nowBlock: now });
  assert.equal(v.ok, true, v.issues.join());
  assert.equal(v.expired, 3);
  assert.deepEqual(v.head, { seq: 3, chain: gone[0].chain });
  // an append continues from the surviving seal head and the extended log verifies
  const next = await buildAppend(key, log, v.head!, [ev(4)]);
  const more: Row[] = next.creates.map((c, i) => ({ key: `0x${(50 + i).toString(16)}`, creator: W, type: c.attributes.type.value as string, seq: Number(c.attributes.seq.value), chain: c.attributes.chain.value as `0x${string}`, payload: c.payload, createdAt: now, updatedAt: now, readonly: true }));
  const v2 = await verify([...gone, ...more], W, log, { key, nowBlock: now });
  assert.equal(v2.ok, true, v2.issues.join());
  assert.equal(v2.head?.seq, 4);
  // the same loss inside the entry lifetime is still tampering
  assert.equal((await verify(gone, W, log, { nowBlock: 100n + days(1) })).ok, false);
});

test("an interior deletion is a gap at any age, even when the seal is old", async () => {
  const { log, key } = newSecret();
  const { creates } = await buildAppend(key, log, genesis(log), [ev(1), ev(2), ev(3), ev(4)]);
  const rows: Row[] = creates.map((c, i) => ({
    key: `0x${String(i).padStart(64, "0")}`, creator: W, type: c.attributes.type.value as string,
    seq: Number(c.attributes.seq.value), chain: c.attributes.chain.value as `0x${string}`, payload: c.payload,
    createdAt: 100n, updatedAt: 200n, readonly: true, // entries renewed, so 1, 3 and 4 are still alive on day 15
  }));
  const day15 = 100n + days(15);
  const v = await verify(rows.filter((r) => !(r.type === "entry" && r.seq === 2)), W, log, { key, nowBlock: day15 });
  assert.equal(v.ok, false);
  assert.match(v.issues.join(), /gap: seq 2\.\.2 missing/);
  // a deleted tail entry with its predecessors alive is also a deletion, whatever the seal's age
  const t = await verify(rows.filter((r) => !(r.type === "entry" && r.seq === 4)), W, log, { key, nowBlock: day15 });
  assert.match(t.issues.join(), /tail deleted/);
  assert.equal((await verify(rows, W, log, { key, nowBlock: day15 })).ok, true);
});
