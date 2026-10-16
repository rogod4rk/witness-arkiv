# Friction report

Versions: `@arkiv-network/sdk` 0.8.1, `viem` 2.x, Node 22.14, Tiramisu chain 7738577, docs read on 2026-10-16. Every item below was reproduced during this build.

## 1. Faucet cannot be used from a script or an agent (Faucet)

- Expected: a coding agent or CI job can fund a throwaway key, since the challenge's AGENTS.md asks the builder for a funded test wallet.
- Actual: `GET https://hub.arkiv.network/api/faucet` returns `{"error":"Unauthorized"}`. After a wallet sign-in (SIWE against `/api/auth/siwe/nonce` and `/verify`, which does work) the info call succeeds, but `POST /api/faucet` returns `400 {"error":"CAPTCHA verification required."}`. The captcha is served from `cap.arkiv.network`.
- Repro: sign in with a fresh key, then `curl -X POST https://hub.arkiv.network/api/faucet -H 'content-type: application/json' -d '{"recipient":"0x..."}'`.
- Fix: an unauthenticated rate-limited faucet endpoint for testnet keys, or a documented headless path. At minimum, say in the Tiramisu page that funding needs a browser.

## 2. Zero-balance write gives no useful error (TypeScript SDK, RPC)

- Expected: `insufficient funds` or a named reason, as the Mutating data page lists for `EntityMutationError`.
- Actual: `walletClient.createEntity(...)` from a wallet with 0 GLM throws `Transaction failed: Execution error without revert data`. `eth_getBalance` returns `0x0` and `eth_gasPrice` returns `0x3b9aca02`, so the cause is only inferable.
- Repro: generate a key, do not fund it, call `createEntity({ payload, contentType: "application/json", attributes: { project: str("x") }, expires: ExpirationTime.fromHours(1) })`.
- Fix: map the node's estimation failure to a funds check in the SDK (read the balance before throwing), or add `insufficient funds` to the documented error table.

## 3. Live Events page does not say how to get a real socket (Docs, WebSocket events)

- Expected: the Live Events page explains the transport choice. It says `watchEntityEvents` "polls the chain" and its example uses `http()`.
- Actual: the challenge's `AGENTS.md` says a WebSocket transport without `fromBlock` opens a real socket. Tested: with `transport: webSocket()` the transport made zero `request` calls in 5 s and delivered events (6 in 6 s on a busy testnet); with `http()` it called `eth_newFilter` and `eth_blockNumber`. So it works, but only the rules repo documents it.
- Repro: wrap the transport's `request`, call `watchEntityEvents({ onError })` for 5 s, compare the two transports.
- Fix: add a "WebSocket" section to Live Events with the one-line `webSocket()` example and the `fromBlock` caveat.

## 4. Smooth paths, tested with the same rigour

- Chain ID `0x7614d1` from `eth_chainId` matches the docs and README (`7738577`). Expected and got the same.
- `createdBy()` plus `eq()` plus a `lt("$expiresAt", u64(...))` range, walked with `for await`, parsed and ran against the live node on the first try (empty result for an unused log, as expected).
- `eth_call` of a batch of 2 `create` operations (one with an empty payload, `bytes32` attribute, `readonly` + `permissionlessExtension` flags) was accepted by the node with no revert, confirming the encoding before any funds were spent.
- Vite 8 bundles the SDK for the browser with no polyfills or config.
