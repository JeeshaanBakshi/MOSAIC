#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env, String,
    Symbol, Vec,
};

const DAY_SECS: u64 = 24 * 60 * 60;
const DEFAULT_TTL_SECS: u64 = 90 * DAY_SECS; // credentials last 90 days

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
}

/// Settings fixed at init.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub usdc: Address,      // address of the USDC coin's contract
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
}

// ---------- the contract ----------

#[contract]
pub struct Mosaic;

#[contractimpl]
impl Mosaic {
    pub fn init(env: Env, admin: Address, usdc: Address, stake_amount: i128) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Config, &Config { admin, usdc, stake_amount });
        env.storage().instance().set(&DataKey::NextCredId, &1u64);
        Ok(())
    }

    /// Fraud check 1: only the admin can approve an issuer.
    pub fn add_issuer(env: Env, issuer: Address, name: String, kind: IssuerKind) -> Result<(), Error> {
        let config = get_config(&env)?;
        config.admin.require_auth();
        let record = Issuer { address: issuer.clone(), name, kind, active: true };
        env.storage().persistent().set(&DataKey::Issuer(issuer), &record);
        Ok(())
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

        // Fraud check 1: must be approved, and not suspended.
        let record: Issuer = env
            .storage()
            .persistent()
            .get(&DataKey::Issuer(issuer.clone()))
            .ok_or(Error::IssuerNotApproved)?;
        if !record.active {
            return Err(Error::IssuerSuspended);
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
                &env.current_contract_address(),
                &config.stake_amount,
            );
        }

        // Hand out the next id (1, 2, 3, ...).
        let id: u64 = env.storage().instance().get(&DataKey::NextCredId).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextCredId, &(id + 1));

        let ttl = if ttl_secs == 0 { DEFAULT_TTL_SECS } else { ttl_secs };
        let now = env.ledger().timestamp();
        let cred = Credential {
            id,
            issuer,
            shop_id: shop_id.clone(),
            claim_type,
            summary,
            claim_hash,
            issued_at: now,
            expires_at: now + ttl,
            revoked: false,
            stake: config.stake_amount,
            passed: false, // a new claim earns nothing until the checks have passed
        };
        env.storage().persistent().set(&DataKey::Cred(id), &cred);

        // Add the id to this shop's list.
        let list_key = DataKey::ShopCreds(shop_id);
        let mut ids: Vec<u64> = env.storage().persistent().get(&list_key).unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage().persistent().set(&list_key, &ids);

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
        Ok(())
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
        Ok(())
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
            let status = if cred.revoked {
                Status::Revoked
            } else if now >= cred.expires_at {
                Status::Expired
            } else {
                Status::Valid
            };
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

fn get_config(env: &Env) -> Result<Config, Error> {
    env.storage().instance().get(&DataKey::Config).ok_or(Error::NotInitialized)
}

#[cfg(test)]
mod test;
