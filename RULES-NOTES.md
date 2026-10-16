# Rules notes (verified 2026-10-16)

Source of truth: https://github.com/Arkiv-Network/global-tour-stop-pre-devcon (RULES.md, docs/scoring-rubric.md, docs/submission-checklist.md, AGENTS.md). The repo outranks the Devfolio page. Rules frozen since 9 Oct 2026.

## Verified facts
- Chain id 7738577 (0x7614d1): confirmed via eth_chainId on https://rpc.tiramisu.db-chain.testnet.arkiv.network
- SDK @arkiv-network/sdk latest = 0.8.1 (npm view). Rules require 0.8.x.
- Deadline: 18 Oct 2026 23:59 London = 22:59 UTC. Judged at the recorded commit SHA; never rewrite history after.
- Window: work must be created 9 to 18 Oct 2026.

## Gates (all required)
Public deployment on Tiramisu usable without access; reproducible steps + exact query; public repo MIT with README setup; /arkiv/schema.md; on-chain evidence (writer wallet addresses); /arkiv/friction.md; demo video <= 3 min; every Devfolio question answered; at least one track; built 9-18 Oct (disclose pre-existing work with baseline SHA); evidence that survives expiry (tx hashes on explorer + video).

## Score: 4 x 25
Why this pillar (per track) / Why Arkiv / How you use Arkiv / Friction report. Each 0-5. Minimum 50/100 to win. Ties: Why Arkiv, then How you use Arkiv, then earlier submission.

## Disqualifiers
SDK never queried; Postgres app with Arkiv logo; private keys/secrets in Arkiv; real personal data in plaintext or hashed (use synthetic data); malicious code; late.

## Prizes
$750 USDC + Devcon ticket per CROPS track (CR, Open Source, Privacy, Security); Best Indian Use Case $2,000 (needs Indian-national team member). One prize per team.

## Vocabulary
Say "Entity Expiration", "Lifetime Extension", "Arkiv entities", "the Web3 database". Never "TTL".
