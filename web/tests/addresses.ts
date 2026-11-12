// Prints the demo accounts' addresses as JSON, for the browser test.
import { ACCOUNTS, CONTRACT_ADDRESS } from "../lib/engine/accounts";
console.log(JSON.stringify({ ...Object.fromEntries(Object.entries(ACCOUNTS).map(([k, v]) => [k, v.address])), contract: CONTRACT_ADDRESS }));
