// Test shim: the server engine, under the names the tests use.
export * as contract from "../lib/engine/contract";
export * as backend from "../lib/engine/backend";
export * as demo from "../lib/engine/demo";
export { ACCOUNTS, CONTRACT_ADDRESS } from "../lib/engine/accounts";
export { ContractError, ApiError } from "../lib/engine/types";
export { withState, resetEverything } from "../lib/engine/store";
