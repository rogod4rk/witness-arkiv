// Creates a throwaway key in .env if none exists and prints its address.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
if (!existsSync(".env") || !/^PRIVATE_KEY=/m.test(readFileSync(".env", "utf8"))) appendFileSync(".env", `PRIVATE_KEY=${generatePrivateKey()}\n`);
const pk = readFileSync(".env", "utf8").match(/^PRIVATE_KEY=(0x[0-9a-f]{64})/m)![1] as `0x${string}`;
console.log(privateKeyToAccount(pk).address);
