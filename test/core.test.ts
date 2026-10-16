import test from "node:test";
import assert from "node:assert/strict";
import { buildAppend, genesis, newSecret, verify, type Event, type Row } from "../src/core";

const W = "0x1111111111111111111111111111111111111111";
const ev = (n: number): Event => ({ t: n, actor: "svc-admin", action: "role.grant", detail: `synthetic ${n}` });

async function fixture() {
  const { log, key } = newSecret();
  const { creates } = await buildAppend(key, log, genesis(log), [ev(1), ev(2), ev(3)]);
  const rows: Row[] = creates.map((c, i) => ({
    key: `0x${String(i).padStart(64, "0")}`, creator: W, type: c.attributes.type.value as string,
    seq: Number(c.attributes.seq.value), chain: c.attributes.chain.value as `0x${string}`, payload: c.payload,
  }));
  return { log, key, rows };
}

test("clean log verifies and decrypts", async () => {
  const { log, key, rows } = await fixture();
  const v = await verify(rows, W, log, key);
  assert.equal(v.ok, true, v.issues.join());
  assert.deepEqual(v.entries.map((e) => e.event?.detail), ["synthetic 1", "synthetic 2", "synthetic 3"]);
});

test("altered payload is caught", async () => {
  const { log, key, rows } = await fixture();
  rows[1].payload = rows[1].payload.slice().fill(7, 14);
  assert.equal((await verify(rows, W, log, key)).ok, false);
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

test("wrong key fails to decrypt", async () => {
  const { log, rows } = await fixture();
  const v = await verify(rows, W, log, newSecret().key);
  assert.match(v.issues.join(), /decrypt/);
});
