// The shapes the real Soroban contract returns. Pages and the mock both use these,
// so when you connect the real contract the pages don't change.
//
// Differences from the real contract (on purpose, to keep JSON/localStorage simple):
//  - money is a plain `number` of stroops (1 USDC = 10_000_000), the contract uses i128/bigint
//  - addresses are plain strings, claim_hash is a hex string, ids are numbers
// CONNECT: when you wire the real contract, convert bigint -> number (or switch these types to bigint).

export type IssuerKind = "Supplier" | "PaymentProvider";

/** Computed when you read, never stored (same as the contract). */
export type Status = "Valid" | "Expired" | "Revoked" | "Suspended";

export interface Issuer {
  address: string;
  name: string;
  kind: IssuerKind;
  active: boolean; // false = suspended
  upheldClaims: number; // disputes against this issuer that were upheld
}

export interface Credential {
  id: number;
  issuer: string;
  shopId: string; // "shop-1": shops are just a name, never a wallet
  claimType: string; // "buyer" | "receipts" | "on_time"
  summary: string; // one-line conclusion, never raw data
  claimHash: string; // fingerprint of the off-chain evidence
  issuedAt: number; // unix seconds
  expiresAt: number;
  revoked: boolean;
  stake: number; // USDC still locked behind this claim (0 once released or slashed)
  passed: boolean; // the backend's fraud checks (2-4) passed: only passed claims earn fees
}

export interface CredentialView {
  credential: Credential;
  status: Status;
  issuerName: string;
}

export interface Dispute {
  id: number;
  chainId?: number; // the dispute's id on the real contract, when it was mirrored to Stellar
  credentialId: number;
  lender: string;
  resolved: boolean;
  upheld: boolean;
}

/** An issuer's request to join the registry. Only a HASH of their evidence is on-chain; the evidence itself stays off-chain. */
export type RequestStatus = "Pending" | "Rejected";
export interface IssuerRequest {
  address: string;
  name: string;
  kind: IssuerKind;
  evidenceHash: string;
  status: RequestStatus;
  requestedAt: number;
}

export interface Config {
  admin: string;
  usdc: string; // address of the USDC token contract
  verifyFee: number; // what a lender pays per verify
  issuerShareBps: number; // share of the fee that goes to issuers, in basis points (7000 = 70%)
  stakeAmount: number; // what an issuer locks per credential
}

export interface Payout {
  to: string;
  amount: number;
}

export interface VerifyResult {
  credentials: CredentialView[];
  checksLast30Days: number; // fraud check 6 (the stacking counter)
  /** MOCK EXTRA: where the fee went. The real contract only emits this as an event/transfer. */
  payouts: Payout[];
}

/** Every write returns its result plus the transaction hash (shown in toasts). */
export interface Tx<T> {
  result: T;
  hash: string;
  /** true = this hash is a REAL Stellar testnet transaction. false/absent = simulated, not sent to Stellar. */
  onchain?: boolean;
}

// ---------- errors: named exactly like the Rust `Error` enum in the contract ----------

export type ContractErrorName =
  | "AlreadyInitialized"
  | "NotInitialized"
  | "NotAdmin"
  | "IssuerNotApproved"
  | "IssuerSuspended"
  | "CredentialNotFound"
  | "NotYourCredential"
  | "DuplicateClaim"
  | "TooManyCredentials"
  | "InputTooLong"
  | "DisputeNotFound"
  | "DisputeAlreadyOpen"
  | "DisputeAlreadyResolved"
  | "NotExpiredYet"
  | "NoStakeLeft"
  | "AlreadyApproved"
  | "ShopNotInDefault"
  | "NotAVerifier"
  | "RequestAlreadyPending"
  | "RequestNotFound"
  | "InsufficientBalance"; // really thrown by the USDC token contract, not MOSAIC

const MESSAGES: Record<ContractErrorName, string> = {
  AlreadyInitialized: "The contract was already set up.",
  NotInitialized: "The contract hasn't been set up yet.",
  NotAdmin: "Only the admin can do this.",
  IssuerNotApproved: "This account is not in the issuer registry (fraud check 1).",
  IssuerSuspended: "This issuer is suspended after 2 upheld disputes.",
  CredentialNotFound: "No credential with that id.",
  NotYourCredential: "Only the issuer who signed a credential can do this.",
  TooManyCredentials: "This shop already has the maximum number of credentials (100).",
  InputTooLong: "The shop id or summary is too long.",
  DuplicateClaim: "You already have an active credential of this type for this shop. Revoke it, or wait for it to expire, before issuing another.",
  DisputeNotFound: "No dispute with that id.",
  DisputeAlreadyOpen: "This credential already has an open dispute.",
  DisputeAlreadyResolved: "This dispute was already resolved.",
  NotExpiredYet: "The stake stays locked until the credential expires.",
  NoStakeLeft: "There is no stake left on this credential.",
  AlreadyApproved: "This account is already in the issuer registry.",
  ShopNotInDefault: "A dispute can only be upheld after a lender reports that the shop defaulted.",
  NotAVerifier: "Only a lender who checked this shop (and paid the fee) can do this.",
  RequestAlreadyPending: "This account already has a request waiting for the admin.",
  RequestNotFound: "There is no pending request from this account.",
  InsufficientBalance: "Not enough USDC in this account.",
};

export class ContractError extends Error {
  readonly code: ContractErrorName;
  constructor(code: ContractErrorName) {
    super(MESSAGES[code]);
    this.code = code;
    this.name = code;
  }
}

// ---------- errors from the BACKEND (the FastAPI rules engine), not the contract ----------

export type ApiErrorCode = "InvalidInput" | "NoApplication" | "InvalidOtp" | "OtpExpired" | "TooManyAttempts" | "Forbidden" | "NotFound" | "RateLimited" | "NotSentToStellar";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = code;
  }
}

/** What an applicant fills in to join the issuer registry. */
export interface ApplicationForm {
  businessName: string;
  kind: IssuerKind;
  registrationNumber: string; // GST number for suppliers, RBI licence number for payment providers
  ownerName: string;
  phone: string;
  email: string;
  bankAccountHolder: string;
}
