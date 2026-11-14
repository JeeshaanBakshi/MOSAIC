#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, String,
    Symbol, Vec,
};

const DAY_SECS: u64 = 24 * 60 * 60;
const DEFAULT_TTL_SECS: u64 = 90 * DAY_SECS; // credentials last 90 days
const STACKING_WINDOW_SECS: u64 = 30 * DAY_SECS; // fraud check 6 counts lender checks in the last 30 days
const SUSPEND_AFTER: u32 = 2; // 2 upheld disputes suspend an issuer
const BPS: i128 = 10_000; // basis points: 10,000 = 100%

// Soroban deletes ("archives") stored data nobody pays to keep alive. Every write pushes its data's life out again.
// The network caps a single extension at about 31 days, so we ask for ~29 (500,000 ledgers of ~5 seconds each).
const BUMP_THRESHOLD: u32 = 100_000; // when fewer than this many ledgers remain...
const BUMP_TO: u32 = 500_000; //        ...extend to this many

// Size limits, so nobody can stuff the chain with junk or make a shop's list too long to read.
const MAX_SHOP_ID_LEN: u32 = 64;
const MAX_SUMMARY_LEN: u32 = 280;
const MAX_CREDS_PER_SHOP: u32 = 100;
// ---------- data we store ----------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum IssuerKind {
    Supplier,
    PaymentProvider,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Issuer {
    pub address: Address,
    pub name: String,
    pub kind: IssuerKind,
    pub active: bool, // false = suspended
    pub upheld_claims: u32, // disputes against this issuer that were upheld (2 suspend it)
}

/// Someone asking to join the registry. Only a HASH of their evidence goes on-chain; the evidence stays off-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuerRequest {
    pub address: Address,
    pub name: String,
    pub kind: IssuerKind,
    pub evidence_hash: BytesN<32>,
    pub requested_at: u64,
    pub rejected: bool, // stays visible as rejected; the applicant may apply again
}

/// A lender saying "this credential is false". The admin decides.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Dispute {
    pub id: u64,
    pub credential_id: u64,
    pub lender: Address,
    pub resolved: bool,
    pub upheld: bool,
}

/// Settings fixed at init.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub usdc: Address,      // address of the USDC coin's contract
    pub verify_fee: i128,   // what a lender pays per verify (7 decimals: 1 USDC = 10_000_000)
    pub issuer_share_bps: u32, // share of the fee that goes to issuers, in basis points (7000 = 70%)
    pub stake_amount: i128, // how much an issuer locks per credential (7 decimals: 30 USDC = 300_000_000)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Credential {
    pub id: u64,
    pub issuer: Address,
    pub shop_id: String,        // e.g. "sharma-store". Shops are just a name, never a wallet.
    pub claim_type: Symbol,     // e.g. "buyer", "receipts"
    pub summary: String,        // one-line conclusion, never raw data
    pub claim_hash: BytesN<32>, // fingerprint of the off-chain evidence
    pub issued_at: u64,
    pub expires_at: u64,
    pub revoked: bool,
    pub stake: i128,            // USDC still locked behind this claim
    pub passed: bool,           // the backend's fraud checks (2-4) passed. Only passed claims earn fees.
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Valid,
    Expired,
    Revoked,
    Suspended, // its issuer was suspended
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CredentialView {
    pub credential: Credential,
    pub status: Status,
}

#[contracttype]
pub enum DataKey {
    Config,
    NextCredId,
    Issuer(Address),
    Cred(u64),
    ShopCreds(String), // shop_id -> list of its credential ids
    IssuerList,        // every approved issuer's address
    Request(Address),  // an application to join
    RequestList,       // everyone who has applied
    ShopList,          // every shop id that has a credential
    NextDisputeId,
    Dispute(u64),
    DisputeList,       // all dispute ids
    OpenDispute(u64),  // credential id -> its open dispute id
    Checks(String),    // shop_id -> times of lender checks (fraud check 6)
    Verifiers(String), // shop_id -> lenders who paid to check it (only they can dispute or report a default)
    Defaulted(String), // shop_id -> when a lender reported a default (a dispute can only be upheld after this)
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    IssuerNotApproved = 3,
    IssuerSuspended = 4,
    CredentialNotFound = 5,
    NotYourCredential = 6,
    DuplicateClaim = 7, // this issuer already has an active credential of this type for this shop
    InvalidTtl = 8,           // the lifetime is so long it overflows
    InvalidAmount = 9,        // a negative stake
    TooManyCredentials = 10,  // this shop already has the maximum number of credentials
    InputTooLong = 11,        // shop id or summary over the size limit
    AlreadyApproved = 12,        // already in the issuer registry
    RequestAlreadyPending = 13,  // already has a request waiting for the admin
    RequestNotFound = 14,        // no pending request from this account
    DisputeNotFound = 15,
    DisputeAlreadyOpen = 16,     // this credential already has an open dispute
    DisputeAlreadyResolved = 17,
    NotExpiredYet = 18,          // the stake stays locked until the credential expires
    NoStakeLeft = 19,            // already released or slashed
    ShopNotInDefault = 20,       // a dispute can only be upheld after the shop defaulted
    NotAVerifier = 21,           // only a lender who checked this shop can dispute it or report its default
}

// ---------- the contract ----------

#[contract]
pub struct Mosaic;

#[contractimpl]
impl Mosaic {
    pub fn init(
        env: Env,
        admin: Address,
        usdc: Address,
        verify_fee: i128,
        issuer_share_bps: u32,
        stake_amount: i128,
    ) -> Result<(), Error> {
        // The admin must sign. Otherwise whoever calls init first (after deploy) would become the admin.
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if stake_amount < 0 || verify_fee < 0 || (issuer_share_bps as i128) > BPS {
            return Err(Error::InvalidAmount);
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config { admin, usdc, verify_fee, issuer_share_bps, stake_amount },
        );
        env.storage().instance().set(&DataKey::NextCredId, &1u64);
        env.storage().instance().set(&DataKey::NextDisputeId, &1u64);
        bump_instance(&env);
        Ok(())
    }

    /// Fraud check 1: only the admin can approve an issuer. Approving clears their request.
    pub fn add_issuer(env: Env, issuer: Address, name: String, kind: IssuerKind) -> Result<(), Error> {
        let config = get_config(&env)?;
        config.admin.require_auth();
        let key = DataKey::Issuer(issuer.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyApproved);
        }
        let record = Issuer { address: issuer.clone(), name, kind, active: true, upheld_claims: 0 };
        env.storage().persistent().set(&key, &record);
        let mut list: Vec<Address> =
            env.storage().persistent().get(&DataKey::IssuerList).unwrap_or(Vec::new(&env));
        list.push_back(issuer.clone());
        env.storage().persistent().set(&DataKey::IssuerList, &list);
        // The request, if any, is done: remove it from the waiting list.
        env.storage().persistent().remove(&DataKey::Request(issuer.clone()));
        remove_from_request_list(&env, &issuer);
        bump_persistent(&env, &key);
        bump_persistent(&env, &DataKey::IssuerList);
        bump_instance(&env);
        Ok(())
    }

    /// Anyone can ASK to become an issuer. They sign it themselves; only a hash of their evidence is stored.
    pub fn request_issuer(
        env: Env,
        issuer: Address,
        name: String,
        kind: IssuerKind,
        evidence_hash: BytesN<32>,
    ) -> Result<(), Error> {
        issuer.require_auth();
        get_config(&env)?;
        if env.storage().persistent().has(&DataKey::Issuer(issuer.clone())) {
            return Err(Error::AlreadyApproved);
        }
        let key = DataKey::Request(issuer.clone());
        if let Some(old) = env.storage().persistent().get::<_, IssuerRequest>(&key) {
            if !old.rejected {
                return Err(Error::RequestAlreadyPending);
            }
        }
        let req = IssuerRequest {
            address: issuer.clone(),
            name,
            kind,
            evidence_hash,
            requested_at: env.ledger().timestamp(),
            rejected: false,
        };
        env.storage().persistent().set(&key, &req);
        let mut list: Vec<Address> =
            env.storage().persistent().get(&DataKey::RequestList).unwrap_or(Vec::new(&env));
        if !list.contains(issuer.clone()) {
            list.push_back(issuer);
        }
        env.storage().persistent().set(&DataKey::RequestList, &list);
        bump_persistent(&env, &key);
        bump_persistent(&env, &DataKey::RequestList);
        bump_instance(&env);
        Ok(())
    }

    /// The admin says no. The request stays visible as rejected, and the applicant may apply again.
    pub fn reject_issuer(env: Env, issuer: Address) -> Result<(), Error> {
        let config = get_config(&env)?;
        config.admin.require_auth();
        let key = DataKey::Request(issuer);
        let mut req: IssuerRequest =
            env.storage().persistent().get(&key).ok_or(Error::RequestNotFound)?;
        if req.rejected {
            return Err(Error::RequestNotFound);
        }
        req.rejected = true;
        env.storage().persistent().set(&key, &req);
        bump_persistent(&env, &key);
        bump_instance(&env);
        Ok(())
    }

    pub fn get_issuer_request(env: Env, issuer: Address) -> Option<IssuerRequest> {
        env.storage().persistent().get(&DataKey::Request(issuer))
    }

    /// Everyone who has asked to join and has not been approved yet (including rejected ones).
    pub fn list_issuer_requests(env: Env) -> Vec<IssuerRequest> {
        let list: Vec<Address> =
            env.storage().persistent().get(&DataKey::RequestList).unwrap_or(Vec::new(&env));
        let mut out = Vec::new(&env);
        for a in list.iter() {
            if let Some(r) = env.storage().persistent().get::<_, IssuerRequest>(&DataKey::Request(a)) {
                out.push_back(r);
            }
        }
        out
    }

    pub fn list_issuers(env: Env) -> Vec<Issuer> {
        let list: Vec<Address> =
            env.storage().persistent().get(&DataKey::IssuerList).unwrap_or(Vec::new(&env));
        let mut out = Vec::new(&env);
        for a in list.iter() {
            if let Some(i) = env.storage().persistent().get::<_, Issuer>(&DataKey::Issuer(a)) {
                out.push_back(i);
            }
        }
        out
    }

    pub fn get_config(env: Env) -> Result<Config, Error> {
        get_config(&env)
    }

    pub fn get_issuer(env: Env, issuer: Address) -> Option<Issuer> {
        env.storage().persistent().get(&DataKey::Issuer(issuer))
    }

    /// An approved issuer signs a claim about a shop and locks a stake behind it (fraud check 5).
    /// ttl_secs = 0 means the default 90 days. Returns the new credential's id.
    pub fn issue_credential(
        env: Env,
        issuer: Address,
        shop_id: String,
        claim_type: Symbol,
        summary: String,
        claim_hash: BytesN<32>,
        ttl_secs: u64,
    ) -> Result<u64, Error> {
        issuer.require_auth(); // only the issuer themselves can speak for the issuer
        let config = get_config(&env)?;
        if shop_id.len() > MAX_SHOP_ID_LEN || summary.len() > MAX_SUMMARY_LEN {
            return Err(Error::InputTooLong);
        }

        // Fraud check 1: must be approved, and not suspended.
        let record: Issuer = env
            .storage()
            .persistent()
            .get(&DataKey::Issuer(issuer.clone()))
            .ok_or(Error::IssuerNotApproved)?;
        if !record.active {
            return Err(Error::IssuerSuspended);
        }

        // A shop's list must stay short enough to read in one call.
        let existing: Vec<u64> =
            env.storage().persistent().get(&DataKey::ShopCreds(shop_id.clone())).unwrap_or(Vec::new(&env));
        if existing.len() >= MAX_CREDS_PER_SHOP {
            return Err(Error::TooManyCredentials);
        }

        // One active credential per (issuer, shop, claim type). Otherwise one issuer could stack
        // 18 identical claims and look like 18 independent voices. A revoked or expired one doesn't count.
        if has_active_claim(&env, &shop_id, &issuer, &claim_type) {
            return Err(Error::DuplicateClaim);
        }

        // Fraud check 5: move the stake from the issuer into this contract.
        // This is a call to the USDC coin's contract: "transfer from issuer to me".
        if config.stake_amount > 0 {
            token::TokenClient::new(&env, &config.usdc).transfer(
                &issuer,
                env.current_contract_address(),
                &config.stake_amount,
            );
        }

        // Hand out the next id (1, 2, 3, ...).
        let id: u64 = env.storage().instance().get(&DataKey::NextCredId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextCredId, &(id + 1));

        let ttl = if ttl_secs == 0 { DEFAULT_TTL_SECS } else { ttl_secs };
        let now = env.ledger().timestamp();
        let expires_at = now.checked_add(ttl).ok_or(Error::InvalidTtl)?; // a huge ttl would overflow
        let cred = Credential {
            id,
            issuer,
            shop_id: shop_id.clone(),
            claim_type,
            summary,
            claim_hash,
            issued_at: now,
            expires_at,
            revoked: false,
            stake: config.stake_amount,
            passed: false, // a new claim earns nothing until the checks have passed
        };
        env.storage().persistent().set(&DataKey::Cred(id), &cred);

        // Remember this shop id, so the app can list the shops that have credentials.
        if existing.is_empty() {
            let mut shops: Vec<String> =
                env.storage().persistent().get(&DataKey::ShopList).unwrap_or(Vec::new(&env));
            shops.push_back(shop_id.clone());
            env.storage().persistent().set(&DataKey::ShopList, &shops);
            bump_persistent(&env, &DataKey::ShopList);
        }

        // Add the id to this shop's list.
        let list_key = DataKey::ShopCreds(shop_id);
        let mut ids: Vec<u64> = env.storage().persistent().get(&list_key).unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage().persistent().set(&list_key, &ids);

        bump_persistent(&env, &DataKey::Cred(id));
        bump_persistent(&env, &list_key);
        bump_persistent(&env, &DataKey::Issuer(cred.issuer.clone()));
        bump_instance(&env);
        Ok(id)
    }

    /// The admin (acting for the backend rules engine) records whether a claim passed fraud checks 2-4.
    /// The chain can't see payments, so the backend tells it. Only passed claims earn a share of lender fees.
    pub fn mark_checked(env: Env, id: u64, passed: bool) -> Result<(), Error> {
        let config = get_config(&env)?;
        config.admin.require_auth();
        let mut cred: Credential =
            env.storage().persistent().get(&DataKey::Cred(id)).ok_or(Error::CredentialNotFound)?;
        cred.passed = passed;
        env.storage().persistent().set(&DataKey::Cred(id), &cred);
        bump_persistent(&env, &DataKey::Cred(id));
        bump_instance(&env);
        Ok(())
    }

    /// Anyone can pay to keep a shop's credentials from being archived. No signature needed: it only extends life.
    pub fn keep_alive(env: Env, shop_id: String) {
        let ids: Vec<u64> =
            env.storage().persistent().get(&DataKey::ShopCreds(shop_id.clone())).unwrap_or(Vec::new(&env));
        for id in ids.iter() {
            bump_persistent(&env, &DataKey::Cred(id));
        }
        if !ids.is_empty() {
            bump_persistent(&env, &DataKey::ShopCreds(shop_id));
        }
        bump_instance(&env);
    }

    /// The issuer withdraws a claim. The stake stays locked until it would have expired.
    pub fn revoke(env: Env, issuer: Address, id: u64) -> Result<(), Error> {
        issuer.require_auth();
        let mut cred: Credential =
            env.storage().persistent().get(&DataKey::Cred(id)).ok_or(Error::CredentialNotFound)?;
        if cred.issuer != issuer {
            return Err(Error::NotYourCredential);
        }
        cred.revoked = true;
        env.storage().persistent().set(&DataKey::Cred(id), &cred);
        bump_persistent(&env, &DataKey::Cred(id));
        bump_instance(&env);
        Ok(())
    }

    pub fn list_shops(env: Env) -> Vec<String> {
        env.storage().persistent().get(&DataKey::ShopList).unwrap_or(Vec::new(&env))
    }

    // ---------- lenders ----------

    /// A lender pays the fee and checks a shop. The fee is split in the same transaction:
    /// `issuer_share_bps` of it is shared between the issuers with a VALID credential that PASSED the backend's checks;
    /// the rest goes to the admin (the platform). If no issuer earned anything, the lender doesn't pay the issuer share at all.
    /// Returns fraud check 6: how many lender checks this shop had in the last 30 days (including this one).
    pub fn verify(env: Env, lender: Address, shop_id: String) -> Result<u32, Error> {
        lender.require_auth();
        let config = get_config(&env)?;
        let now = env.ledger().timestamp();
        let usdc = token::TokenClient::new(&env, &config.usdc);

        // Who gets paid? Each distinct issuer with at least one Valid, passed credential.
        let ids: Vec<u64> =
            env.storage().persistent().get(&DataKey::ShopCreds(shop_id.clone())).unwrap_or(Vec::new(&env));
        let mut payees: Vec<Address> = Vec::new(&env);
        for id in ids.iter() {
            let cred: Credential = env.storage().persistent().get(&DataKey::Cred(id)).unwrap();
            if cred.passed && status_of(&env, &cred, now) == Status::Valid && !payees.contains(cred.issuer.clone()) {
                payees.push_back(cred.issuer);
            }
        }

        // Example: fee 1 USDC, 70% share, 2 issuers -> 0.35 each, 0.30 to the platform.
        let pool = config.verify_fee * (config.issuer_share_bps as i128) / BPS;
        let n = payees.len() as i128;
        let each = if n > 0 { pool / n } else { 0 };
        for p in payees.iter() {
            if each > 0 {
                usdc.transfer(&lender, &p, &each);
            }
        }
        let platform = if n > 0 { config.verify_fee - each * n } else { config.verify_fee - pool };
        if platform > 0 {
            usdc.transfer(&lender, &config.admin, &platform);
        }

        // Fraud check 6: remember this check, then count the last 30 days.
        let key = DataKey::Checks(shop_id.clone());
        let old: Vec<u64> = env.storage().persistent().get(&key).unwrap_or(Vec::new(&env));
        let mut recent: Vec<u64> = Vec::new(&env);
        for t in old.iter() {
            if now < t + STACKING_WINDOW_SECS {
                recent.push_back(t);
            }
        }
        recent.push_back(now);
        env.storage().persistent().set(&key, &recent);
        bump_persistent(&env, &key);

        // Remember who paid to check this shop: only they can dispute its credentials or report its default.
        let vkey = DataKey::Verifiers(shop_id);
        let mut verifiers: Vec<Address> = env.storage().persistent().get(&vkey).unwrap_or(Vec::new(&env));
        if !verifiers.contains(lender.clone()) {
            verifiers.push_back(lender);
        }
        env.storage().persistent().set(&vkey, &verifiers);
        bump_persistent(&env, &vkey);
        bump_instance(&env);
        Ok(recent.len())
    }

    /// Fraud check 6, free to read: lender checks on this shop in the last 30 days.
    pub fn checks_last_30_days(env: Env, shop_id: String) -> u32 {
        let now = env.ledger().timestamp();
        let all: Vec<u64> =
            env.storage().persistent().get(&DataKey::Checks(shop_id)).unwrap_or(Vec::new(&env));
        let mut n = 0u32;
        for t in all.iter() {
            if now < t + STACKING_WINDOW_SECS {
                n += 1;
            }
        }
        n
    }

    /// A lender who checked this shop reports that it defaulted on a loan. Until then no dispute against
    /// its credentials can be upheld: a claim isn't "proven false" just because someone says so.
    pub fn report_default(env: Env, lender: Address, shop_id: String) -> Result<(), Error> {
        lender.require_auth();
        get_config(&env)?;
        require_verifier(&env, &shop_id, &lender)?;
        let key = DataKey::Defaulted(shop_id);
        env.storage().persistent().set(&key, &env.ledger().timestamp());
        bump_persistent(&env, &key);
        bump_instance(&env);
        Ok(())
    }

    pub fn has_defaulted(env: Env, shop_id: String) -> bool {
        env.storage().persistent().has(&DataKey::Defaulted(shop_id))
    }

    /// A lender who checked the shop says "this credential is false". One open dispute per credential.
    pub fn open_dispute(env: Env, lender: Address, credential_id: u64) -> Result<u64, Error> {
        lender.require_auth();
        get_config(&env)?;
        let cred: Credential =
            env.storage().persistent().get(&DataKey::Cred(credential_id)).ok_or(Error::CredentialNotFound)?;
        require_verifier(&env, &cred.shop_id, &lender)?;
        if cred.stake <= 0 {
            return Err(Error::NoStakeLeft);
        }
        if env.storage().persistent().has(&DataKey::OpenDispute(credential_id)) {
            return Err(Error::DisputeAlreadyOpen);
        }
        let id: u64 = env.storage().instance().get(&DataKey::NextDisputeId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextDisputeId, &(id + 1));
        let dispute = Dispute { id, credential_id, lender, resolved: false, upheld: false };
        env.storage().persistent().set(&DataKey::Dispute(id), &dispute);
        env.storage().persistent().set(&DataKey::OpenDispute(credential_id), &id);
        let mut list: Vec<u64> =
            env.storage().persistent().get(&DataKey::DisputeList).unwrap_or(Vec::new(&env));
        list.push_back(id);
        env.storage().persistent().set(&DataKey::DisputeList, &list);
        bump_persistent(&env, &DataKey::Dispute(id));
        bump_persistent(&env, &DataKey::OpenDispute(credential_id));
        bump_persistent(&env, &DataKey::DisputeList);
        bump_instance(&env);
        Ok(id)
    }

    /// The admin decides a dispute. Upheld (only possible after the shop defaulted): the claim was false, the stake goes
    /// to the lender, the credential is revoked, and the issuer gets a strike. 2 strikes suspend it.
    pub fn resolve_dispute(env: Env, dispute_id: u64, upheld: bool) -> Result<(), Error> {
        let config = get_config(&env)?;
        config.admin.require_auth();
        let mut dispute: Dispute =
            env.storage().persistent().get(&DataKey::Dispute(dispute_id)).ok_or(Error::DisputeNotFound)?;
        if dispute.resolved {
            return Err(Error::DisputeAlreadyResolved);
        }
        let mut cred: Credential = env
            .storage()
            .persistent()
            .get(&DataKey::Cred(dispute.credential_id))
            .ok_or(Error::CredentialNotFound)?;

        if upheld {
            // Fraud check 5: no default, no slash.
            if !env.storage().persistent().has(&DataKey::Defaulted(cred.shop_id.clone())) {
                return Err(Error::ShopNotInDefault);
            }
            let slashed = cred.stake;
            cred.stake = 0; // update the record BEFORE moving money
            cred.revoked = true;
            env.storage().persistent().set(&DataKey::Cred(cred.id), &cred);
            if slashed > 0 {
                token::TokenClient::new(&env, &config.usdc).transfer(
                    &env.current_contract_address(),
                    &dispute.lender,
                    &slashed,
                );
            }
            let ikey = DataKey::Issuer(cred.issuer.clone());
            let mut issuer: Issuer = env.storage().persistent().get(&ikey).unwrap();
            issuer.upheld_claims += 1;
            if issuer.upheld_claims >= SUSPEND_AFTER {
                issuer.active = false;
            }
            env.storage().persistent().set(&ikey, &issuer);
            bump_persistent(&env, &ikey);
            bump_persistent(&env, &DataKey::Cred(cred.id));
        }

        dispute.resolved = true;
        dispute.upheld = upheld;
        env.storage().persistent().set(&DataKey::Dispute(dispute_id), &dispute);
        env.storage().persistent().remove(&DataKey::OpenDispute(dispute.credential_id));
        bump_persistent(&env, &DataKey::Dispute(dispute_id));
        bump_instance(&env);
        Ok(())
    }

    pub fn get_dispute(env: Env, id: u64) -> Option<Dispute> {
        env.storage().persistent().get(&DataKey::Dispute(id))
    }

    pub fn list_disputes(env: Env) -> Vec<Dispute> {
        let ids: Vec<u64> =
            env.storage().persistent().get(&DataKey::DisputeList).unwrap_or(Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            if let Some(d) = env.storage().persistent().get::<_, Dispute>(&DataKey::Dispute(id)) {
                out.push_back(d);
            }
        }
        out
    }

    /// After a credential expires, and if no dispute is open, the issuer gets the stake back.
    pub fn release_stake(env: Env, issuer: Address, id: u64) -> Result<i128, Error> {
        issuer.require_auth();
        let config = get_config(&env)?;
        let mut cred: Credential =
            env.storage().persistent().get(&DataKey::Cred(id)).ok_or(Error::CredentialNotFound)?;
        if cred.issuer != issuer {
            return Err(Error::NotYourCredential);
        }
        if env.ledger().timestamp() < cred.expires_at {
            return Err(Error::NotExpiredYet);
        }
        if cred.stake <= 0 {
            return Err(Error::NoStakeLeft);
        }
        if env.storage().persistent().has(&DataKey::OpenDispute(id)) {
            return Err(Error::DisputeAlreadyOpen);
        }
        let amount = cred.stake;
        cred.stake = 0; // update the record BEFORE moving money
        env.storage().persistent().set(&DataKey::Cred(id), &cred);
        token::TokenClient::new(&env, &config.usdc).transfer(&env.current_contract_address(), &issuer, &amount);
        bump_persistent(&env, &DataKey::Cred(id));
        bump_instance(&env);
        Ok(amount)
    }

    /// All of a shop's credentials, each with its current status. Free to read.
    pub fn get_credentials(env: Env, shop_id: String) -> Vec<CredentialView> {
        let ids: Vec<u64> =
            env.storage().persistent().get(&DataKey::ShopCreds(shop_id)).unwrap_or(Vec::new(&env));
        let now = env.ledger().timestamp();
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            let cred: Credential = env.storage().persistent().get(&DataKey::Cred(id)).unwrap();
            // Status is worked out when you read, not stored.
            let status = status_of(&env, &cred, now);
            out.push_back(CredentialView { credential: cred, status });
        }
        out
    }
}

/// True if this issuer already has a Valid (not revoked, not expired) credential
/// of this claim type for this shop.
fn has_active_claim(env: &Env, shop_id: &String, issuer: &Address, claim_type: &Symbol) -> bool {
    let ids: Vec<u64> =
        env.storage().persistent().get(&DataKey::ShopCreds(shop_id.clone())).unwrap_or(Vec::new(env));
    let now = env.ledger().timestamp();
    for id in ids.iter() {
        let cred: Credential = env.storage().persistent().get(&DataKey::Cred(id)).unwrap();
        if cred.issuer == *issuer && cred.claim_type == *claim_type && !cred.revoked && now < cred.expires_at {
            return true;
        }
    }
    false
}

/// Valid, Expired, Revoked or Suspended: worked out when you read, never stored.
fn status_of(env: &Env, cred: &Credential, now: u64) -> Status {
    if cred.revoked {
        return Status::Revoked;
    }
    if now >= cred.expires_at {
        return Status::Expired;
    }
    let issuer: Option<Issuer> = env.storage().persistent().get(&DataKey::Issuer(cred.issuer.clone()));
    match issuer {
        Some(i) if i.active => Status::Valid,
        _ => Status::Suspended,
    }
}

fn require_verifier(env: &Env, shop_id: &String, lender: &Address) -> Result<(), Error> {
    let verifiers: Vec<Address> =
        env.storage().persistent().get(&DataKey::Verifiers(shop_id.clone())).unwrap_or(Vec::new(env));
    if verifiers.contains(lender.clone()) {
        Ok(())
    } else {
        Err(Error::NotAVerifier)
    }
}

fn remove_from_request_list(env: &Env, who: &Address) {
    let list: Vec<Address> =
        env.storage().persistent().get(&DataKey::RequestList).unwrap_or(Vec::new(env));
    let mut kept: Vec<Address> = Vec::new(env);
    for a in list.iter() {
        if a != *who {
            kept.push_back(a);
        }
    }
    env.storage().persistent().set(&DataKey::RequestList, &kept);
}

fn bump_persistent(env: &Env, key: &DataKey) {
    env.storage().persistent().extend_ttl(key, BUMP_THRESHOLD, BUMP_TO);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

fn get_config(env: &Env) -> Result<Config, Error> {
    env.storage().instance().get(&DataKey::Config).ok_or(Error::NotInitialized)
}

#[cfg(test)]
mod test;
