// Dry run without funds: the node's eth_call validates a batch exactly like a real write (attribute grammar, flags, expiry).
import { createWalletClient, ExpirationTime } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { custom, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { buildAppend, genesis, newSecret } from "../src/core";

const base = http()({ chain: tiramisu });
const transport = custom({
  async request({ method, params }: { method: string; params?: unknown }) {
    if (method === "eth_estimateGas") {
      const { from, to, data } = (params as Record<string, string>[])[0];
      console.log("estimateGas call to", to, "data bytes", (data.length - 2) / 2);
      const r = await base.request({ method: "eth_call", params: [{ from, to, data }, "latest"] } as never);
      console.log("eth_call accepted the batch, return", r);
      return "0x30d40";
    }
    if (method === "eth_sendRawTransaction") throw new Error("dry-run stop");
    return base.request({ method, params } as never);
  },
});
const w = createWalletClient({ chain: tiramisu, transport, account: privateKeyToAccount(generatePrivateKey()) });
const { log, key } = newSecret();
const { creates } = await buildAppend(key, log, genesis(log), [{ t: 1, actor: "svc", action: "x", detail: "synthetic" }]);
if (process.argv[2] === "bad") (creates[0] as { expires: unknown }).expires = ExpirationTime.atBlock(1n);
try { await w.executeBatch({ creates }); } catch (e) { console.log("stopped:", (e as Error).message.slice(0, 200)); }
process.exit(0);
