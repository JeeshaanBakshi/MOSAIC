#![cfg(test)]
use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, String,
};

const USDC: i128 = 10_000_000; // 7 decimals: 1 USDC = 10,000,000
const STAKE: i128 = 30 * USDC;
const FEE: i128 = USDC; // a lender pays 1 USDC per check
const SHARE_BPS: u32 = 7_000; // 70% of it goes to the issuers

struct Setup<'a> {
    env: Env,
    client: MosaicClient<'a>,
    usdc: TokenClient<'a>,
    contract: Address,
    admin: Address,
    supplier: Address,
}

/// A fake chain with: a test USDC coin, the MOSAIC contract, an admin, and one approved supplier with 1000 USDC.
fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000_000);
    let admin = Address::generate(&env);
    let supplier = Address::generate(&env);

    let coin = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(&env, &coin.address()).mint(&supplier, &(1_000 * USDC));

    let contract = env.register(Mosaic, ());
    let client = MosaicClient::new(&env, &contract);
    client.init(&admin, &coin.address(), &FEE, &SHARE_BPS, &STAKE);
    client.add_issuer(&supplier, &String::from_str(&env, "Gupta Wholesale"), &IssuerKind::Supplier);

    let usdc = TokenClient::new(&env, &coin.address());
    Setup { env, client, usdc, contract, admin, supplier }
}

fn issue(s: &Setup, issuer: &Address, ttl: u64) -> u64 {
    s.client.issue_credential(
        issuer,
        &String::from_str(&s.env, "sharma-store"),
        &symbol_short!("buyer"),
        &String::from_str(&s.env, "Regular buyer for 18 months, pays on time"),
        &BytesN::from_array(&s.env, &[7u8; 32]),
        &ttl,
    )
}

fn issue_claim(s: &Setup, issuer: &Address, claim: Symbol, ttl: u64) -> u64 {
    s.client.issue_credential(
        issuer,
        &shop(s),
        &claim,
        &String::from_str(&s.env, "A claim"),
        &BytesN::from_array(&s.env, &[7u8; 32]),
        &ttl,
    )
}

fn shop(s: &Setup) -> String {
    String::from_str(&s.env, "sharma-store")
}

#[test]
fn admin_can_add_issuer_and_anyone_can_read_it() {
    let s = setup();
    let got = s.client.get_issuer(&s.supplier).unwrap();
    assert_eq!(got.name, String::from_str(&s.env, "Gupta Wholesale"));
    assert!(got.active);
    assert_eq!(s.client.get_issuer(&Address::generate(&s.env)), None);
}

#[test]
fn add_issuer_asks_for_the_admins_signature() {
    let s = setup();
    s.client.add_issuer(&Address::generate(&s.env), &String::from_str(&s.env, "X"), &IssuerKind::Supplier);
    assert_eq!(s.env.auths()[0].0, s.admin);
}

#[test]
fn init_only_works_once() {
    let s = setup();
    let coin = s.usdc.address.clone();
    assert_eq!(s.client.try_init(&s.admin, &coin, &FEE, &SHARE_BPS, &STAKE), Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn issuing_locks_the_stake_in_the_contract() {
    let s = setup();
    let id = issue(&s, &s.supplier, 0);
    assert_eq!(id, 1);
    assert_eq!(s.usdc.balance(&s.supplier), 970 * USDC); // 30 left the supplier...
    assert_eq!(s.usdc.balance(&s.contract), STAKE); // ...and sit in the contract

    let views = s.client.get_credentials(&shop(&s));
    assert_eq!(views.len(), 1);
    let v = views.get(0).unwrap();
    assert_eq!(v.status, Status::Valid);
    assert_eq!(v.credential.stake, STAKE);
    assert_eq!(v.credential.expires_at - v.credential.issued_at, 90 * DAY_SECS);
}

#[test]
fn ids_count_up_per_credential() {
    let s = setup();
    assert_eq!(issue_claim(&s, &s.supplier, symbol_short!("buyer"), 0), 1);
    assert_eq!(issue_claim(&s, &s.supplier, symbol_short!("receipts"), 0), 2);
    assert_eq!(s.client.get_credentials(&shop(&s)).len(), 2);
}

#[test]
fn someone_not_in_the_registry_cannot_issue() {
    let s = setup();
    let stranger = Address::generate(&s.env);
    let result = s.client.try_issue_credential(
        &stranger,
        &shop(&s),
        &symbol_short!("buyer"),
        &String::from_str(&s.env, "trust me"),
        &BytesN::from_array(&s.env, &[0u8; 32]),
        &0,
    );
    assert_eq!(result, Err(Ok(Error::IssuerNotApproved)));
}

#[test]
fn credential_expires_after_its_ttl() {
    let s = setup();
    issue(&s, &s.supplier, 100); // lasts 100 seconds
    assert_eq!(s.client.get_credentials(&shop(&s)).get(0).unwrap().status, Status::Valid);
    s.env.ledger().with_mut(|l| l.timestamp += 100);
    assert_eq!(s.client.get_credentials(&shop(&s)).get(0).unwrap().status, Status::Expired);
}

#[test]
fn only_the_issuer_can_revoke_their_credential() {
    let s = setup();
    let id = issue(&s, &s.supplier, 0);
    let other = Address::generate(&s.env);
    assert_eq!(s.client.try_revoke(&other, &id), Err(Ok(Error::NotYourCredential)));
    s.client.revoke(&s.supplier, &id);
    assert_eq!(s.client.get_credentials(&shop(&s)).get(0).unwrap().status, Status::Revoked);
    assert_eq!(s.usdc.balance(&s.contract), STAKE); // revoking does not free the stake
}

// ---------- one active credential per (issuer, shop, claim type) ----------

#[test]
fn same_issuer_cannot_issue_the_same_claim_twice() {
    let s = setup();
    issue(&s, &s.supplier, 0);
    let again = s.client.try_issue_credential(
        &s.supplier,
        &shop(&s),
        &symbol_short!("buyer"),
        &String::from_str(&s.env, "Same claim again"),
        &BytesN::from_array(&s.env, &[9u8; 32]),
        &0,
    );
    assert_eq!(again, Err(Ok(Error::DuplicateClaim)));
    assert_eq!(s.client.get_credentials(&shop(&s)).len(), 1); // still just one
    assert_eq!(s.usdc.balance(&s.supplier), 970 * USDC); // and no second stake was taken
}

#[test]
fn can_issue_again_after_revoking() {
    let s = setup();
    let first = issue(&s, &s.supplier, 0);
    s.client.revoke(&s.supplier, &first);
    let second = issue(&s, &s.supplier, 0);
    assert_eq!(second, 2);
}

#[test]
fn can_issue_again_after_expiry() {
    let s = setup();
    issue(&s, &s.supplier, 100);
    s.env.ledger().with_mut(|l| l.timestamp += 100); // the first one has now expired
    assert_eq!(issue(&s, &s.supplier, 0), 2);
}

#[test]
fn a_different_claim_type_or_issuer_or_shop_is_allowed() {
    let s = setup();
    issue(&s, &s.supplier, 0); // supplier says "buyer" about sharma-store

    // same issuer, different claim type
    issue_claim(&s, &s.supplier, symbol_short!("receipts"), 0);

    // same issuer and claim type, different shop
    s.client.issue_credential(
        &s.supplier,
        &String::from_str(&s.env, "mehta-kirana"),
        &symbol_short!("buyer"),
        &String::from_str(&s.env, "A claim"),
        &BytesN::from_array(&s.env, &[7u8; 32]),
        &0,
    );

    // different issuer, same shop and claim type
    let other = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.usdc.address).mint(&other, &(100 * USDC));
    s.client.add_issuer(&other, &String::from_str(&s.env, "PayLink"), &IssuerKind::PaymentProvider);
    issue(&s, &other, 0);

    assert_eq!(s.client.get_credentials(&shop(&s)).len(), 3);
}

// ---------- a claim earns nothing until the backend's checks have passed ----------

#[test]
fn a_new_claim_has_not_passed_until_the_admin_marks_it() {
    let s = setup();
    let id = issue(&s, &s.supplier, 0);
    assert!(!s.client.get_credentials(&shop(&s)).get(0).unwrap().credential.passed);

    s.client.mark_checked(&id, &true);
    assert_eq!(s.env.auths()[0].0, s.admin); // it needed the admin's signature
    assert!(s.client.get_credentials(&shop(&s)).get(0).unwrap().credential.passed);

    s.client.mark_checked(&id, &false); // a later failed check turns it off again
    assert!(!s.client.get_credentials(&shop(&s)).get(0).unwrap().credential.passed);
}

#[test]
fn marking_an_unknown_credential_fails() {
    let s = setup();
    assert_eq!(s.client.try_mark_checked(&99, &true), Err(Ok(Error::CredentialNotFound)));
}

// ---------- robustness ----------

#[test]
fn init_needs_the_admins_signature() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let coin = env.register_stellar_asset_contract_v2(admin.clone());
    let client = MosaicClient::new(&env, &env.register(Mosaic, ()));
    client.init(&admin, &coin.address(), &FEE, &SHARE_BPS, &STAKE);
    assert_eq!(env.auths()[0].0, admin); // without this, the first caller after deploy could become admin
}

#[test]
fn a_negative_stake_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let coin = env.register_stellar_asset_contract_v2(admin.clone());
    let client = MosaicClient::new(&env, &env.register(Mosaic, ()));
    assert_eq!(client.try_init(&admin, &coin.address(), &FEE, &SHARE_BPS, &-5), Err(Ok(Error::InvalidAmount)));
}

#[test]
fn a_lifetime_that_overflows_is_an_error_not_a_crash() {
    let s = setup();
    let result = s.client.try_issue_credential(
        &s.supplier,
        &shop(&s),
        &symbol_short!("buyer"),
        &String::from_str(&s.env, "x"),
        &BytesN::from_array(&s.env, &[1u8; 32]),
        &u64::MAX,
    );
    assert_eq!(result, Err(Ok(Error::InvalidTtl)));
    assert_eq!(s.usdc.balance(&s.supplier), 1_000 * USDC); // nothing was locked
}

#[test]
fn oversized_input_is_rejected() {
    let s = setup();
    let long = String::from_str(&s.env, &"x".repeat(300));
    let result = s.client.try_issue_credential(
        &s.supplier,
        &shop(&s),
        &symbol_short!("buyer"),
        &long,
        &BytesN::from_array(&s.env, &[1u8; 32]),
        &0,
    );
    assert_eq!(result, Err(Ok(Error::InputTooLong)));
}

#[test]
fn a_shop_cannot_collect_unlimited_credentials() {
    let s = setup();
    StellarAssetClient::new(&s.env, &s.usdc.address).mint(&s.supplier, &(10_000 * USDC));
    for _ in 0..MAX_CREDS_PER_SHOP {
        let id = issue(&s, &s.supplier, 0);
        s.client.revoke(&s.supplier, &id); // revoking frees the (issuer, claim) slot but the list still grows
    }
    assert_eq!(
        s.client.try_issue_credential(
            &s.supplier,
            &shop(&s),
            &symbol_short!("buyer"),
            &String::from_str(&s.env, "one too many"),
            &BytesN::from_array(&s.env, &[1u8; 32]),
            &0,
        ),
        Err(Ok(Error::TooManyCredentials))
    );
}

#[test]
fn keep_alive_works_for_anyone_and_changes_nothing_else() {
    let s = setup();
    issue(&s, &s.supplier, 0);
    s.client.keep_alive(&shop(&s));
    s.client.keep_alive(&String::from_str(&s.env, "never-seen")); // an unknown shop is fine
    assert_eq!(s.client.get_credentials(&shop(&s)).len(), 1);
}

// ---------- the lender side: fee split, stacking, disputes, defaults, stake release ----------

/// A second approved issuer (a payment provider) and a lender with 100 USDC, on top of `setup()`.
fn with_lender<'a>(s: &Setup<'a>) -> (Address, Address) {
    let provider = Address::generate(&s.env);
    let lender = Address::generate(&s.env);
    let coin = StellarAssetClient::new(&s.env, &s.usdc.address);
    coin.mint(&provider, &(1_000 * USDC));
    coin.mint(&lender, &(100 * USDC));
    s.client.add_issuer(&provider, &String::from_str(&s.env, "PayLink"), &IssuerKind::PaymentProvider);
    (provider, lender)
}

#[test]
fn verify_splits_the_fee_between_issuers_whose_claims_passed_and_the_platform() {
    let s = setup();
    let (provider, lender) = with_lender(&s);
    let a = issue(&s, &s.supplier, 0);
    let b = issue_claim(&s, &provider, symbol_short!("receipts"), 0);
    s.client.mark_checked(&a, &true);
    s.client.mark_checked(&b, &true);
    let n = s.client.verify(&lender, &shop(&s));
    assert_eq!(n, 1); // the stacking counter: this was the first check
    assert_eq!(s.usdc.balance(&s.supplier), (1_000 - 30) * USDC + 3_500_000); // +0.35
    assert_eq!(s.usdc.balance(&provider), (1_000 - 30) * USDC + 3_500_000);
    assert_eq!(s.usdc.balance(&s.admin), 3_000_000); // the platform's 0.30
    assert_eq!(s.usdc.balance(&lender), 99 * USDC); // paid exactly 1
}

#[test]
fn a_claim_that_did_not_pass_earns_nothing() {
    let s = setup();
    let (provider, lender) = with_lender(&s);
    let a = issue(&s, &s.supplier, 0);
    issue_claim(&s, &provider, symbol_short!("receipts"), 0); // never marked as passed
    s.client.mark_checked(&a, &true);
    s.client.verify(&lender, &shop(&s));
    assert_eq!(s.usdc.balance(&s.supplier), (1_000 - 30) * USDC + 7_000_000); // the whole 70%
    assert_eq!(s.usdc.balance(&provider), (1_000 - 30) * USDC);
}

#[test]
fn if_no_issuer_earned_the_lender_pays_only_the_platform_share() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    issue(&s, &s.supplier, 0); // not passed
    s.client.verify(&lender, &shop(&s));
    assert_eq!(s.usdc.balance(&s.supplier), (1_000 - 30) * USDC);
    assert_eq!(s.usdc.balance(&s.admin), 3_000_000);
    assert_eq!(s.usdc.balance(&lender), 100 * USDC - 3_000_000); // paid only 0.30
}

#[test]
fn the_stacking_counter_counts_checks_in_the_last_30_days() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    assert_eq!(s.client.verify(&lender, &shop(&s)), 1);
    assert_eq!(s.client.verify(&lender, &shop(&s)), 2);
    assert_eq!(s.client.verify(&lender, &shop(&s)), 3);
    assert_eq!(s.client.checks_last_30_days(&shop(&s)), 3);
    s.env.ledger().set_timestamp(1_000_000 + 31 * DAY_SECS);
    assert_eq!(s.client.checks_last_30_days(&shop(&s)), 0); // old checks fall out of the window
    assert_eq!(s.client.verify(&lender, &shop(&s)), 1);
}

#[test]
fn a_suspended_issuer_earns_nothing_and_its_credential_reads_as_suspended() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    let a = issue(&s, &s.supplier, 0);
    s.client.mark_checked(&a, &true);
    s.client.verify(&lender, &shop(&s)); // a lender must have checked, to dispute
    s.client.report_default(&lender, &shop(&s));
    let d = s.client.open_dispute(&lender, &a);
    s.client.resolve_dispute(&d, &true);
    // Strike 1 revoked that credential. A second claim, a second dispute: strike 2 suspends.
    let b = issue_claim(&s, &s.supplier, symbol_short!("on_time"), 0);
    s.client.mark_checked(&b, &true);
    let d2 = s.client.open_dispute(&lender, &b);
    s.client.resolve_dispute(&d2, &true);
    assert!(!s.client.get_issuer(&s.supplier).unwrap().active);
    assert_eq!(s.client.get_issuer(&s.supplier).unwrap().upheld_claims, 2);
    assert_eq!(s.client.try_issue_credential(
        &s.supplier, &shop(&s), &symbol_short!("receipts"), &String::from_str(&s.env, "x"),
        &BytesN::from_array(&s.env, &[7u8; 32]), &0,
    ), Err(Ok(Error::IssuerSuspended)));
}

#[test]
fn only_a_lender_who_checked_the_shop_can_dispute_or_report_a_default() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    let a = issue(&s, &s.supplier, 0);
    assert_eq!(s.client.try_open_dispute(&lender, &a), Err(Ok(Error::NotAVerifier)));
    assert_eq!(s.client.try_report_default(&lender, &shop(&s)), Err(Ok(Error::NotAVerifier)));
    s.client.verify(&lender, &shop(&s));
    assert!(s.client.try_open_dispute(&lender, &a).is_ok());
}

#[test]
fn a_dispute_cannot_be_upheld_before_the_shop_defaults() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    let a = issue(&s, &s.supplier, 0);
    s.client.verify(&lender, &shop(&s));
    let d = s.client.open_dispute(&lender, &a);
    assert_eq!(s.client.try_resolve_dispute(&d, &true), Err(Ok(Error::ShopNotInDefault)));
    assert!(!s.client.get_dispute(&d).unwrap().resolved); // nothing changed
    assert_eq!(s.usdc.balance(&lender), 100 * USDC - 3_000_000); // only the verify fee (0.30, nothing passed) was paid
    s.client.report_default(&lender, &shop(&s));
    assert!(s.client.has_defaulted(&shop(&s)));
    s.client.resolve_dispute(&d, &true);
}

#[test]
fn an_upheld_dispute_slashes_the_stake_to_the_lender() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    let a = issue(&s, &s.supplier, 0);
    s.client.verify(&lender, &shop(&s));
    s.client.report_default(&lender, &shop(&s));
    let before = s.usdc.balance(&lender);
    let d = s.client.open_dispute(&lender, &a);
    assert_eq!(s.client.try_open_dispute(&lender, &a), Err(Ok(Error::DisputeAlreadyOpen)));
    s.client.resolve_dispute(&d, &true);
    assert_eq!(s.usdc.balance(&lender) - before, STAKE); // +30
    assert_eq!(s.usdc.balance(&s.contract), 0);
    let view = s.client.get_credentials(&shop(&s)).get(0).unwrap();
    assert_eq!(view.status, Status::Revoked);
    assert_eq!(view.credential.stake, 0);
    assert_eq!(s.client.get_issuer(&s.supplier).unwrap().upheld_claims, 1);
    assert!(s.client.get_issuer(&s.supplier).unwrap().active); // one strike is not enough
    assert_eq!(s.client.try_resolve_dispute(&d, &true), Err(Ok(Error::DisputeAlreadyResolved)));
    assert_eq!(s.client.try_open_dispute(&lender, &a), Err(Ok(Error::NoStakeLeft)));
}

#[test]
fn a_rejected_dispute_moves_nothing() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    let a = issue(&s, &s.supplier, 0);
    s.client.verify(&lender, &shop(&s));
    let d = s.client.open_dispute(&lender, &a);
    s.client.resolve_dispute(&d, &false);
    assert_eq!(s.usdc.balance(&s.contract), STAKE);
    assert_eq!(s.client.get_issuer(&s.supplier).unwrap().upheld_claims, 0);
    assert_eq!(s.client.list_disputes().len(), 1);
    assert_eq!(s.client.try_resolve_dispute(&99, &true), Err(Ok(Error::DisputeNotFound)));
}

#[test]
fn only_the_admin_resolves_disputes() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    let a = issue(&s, &s.supplier, 0);
    s.client.verify(&lender, &shop(&s));
    let d = s.client.open_dispute(&lender, &a);
    s.client.resolve_dispute(&d, &false);
    assert_eq!(s.env.auths()[0].0, s.admin);
}

#[test]
fn the_stake_comes_back_after_expiry_but_not_before_and_not_twice() {
    let s = setup();
    let id = issue(&s, &s.supplier, 0);
    assert_eq!(s.client.try_release_stake(&s.supplier, &id), Err(Ok(Error::NotExpiredYet)));
    s.env.ledger().set_timestamp(1_000_000 + 91 * DAY_SECS);
    assert_eq!(s.client.release_stake(&s.supplier, &id), STAKE);
    assert_eq!(s.usdc.balance(&s.supplier), 1_000 * USDC);
    assert_eq!(s.client.try_release_stake(&s.supplier, &id), Err(Ok(Error::NoStakeLeft)));
    assert_eq!(s.client.try_release_stake(&Address::generate(&s.env), &id), Err(Ok(Error::NotYourCredential)));
}

#[test]
fn an_open_dispute_blocks_the_stake_release() {
    let s = setup();
    let (_, lender) = with_lender(&s);
    let id = issue(&s, &s.supplier, 0);
    s.client.verify(&lender, &shop(&s));
    s.client.open_dispute(&lender, &id);
    s.env.ledger().set_timestamp(1_000_000 + 91 * DAY_SECS);
    assert_eq!(s.client.try_release_stake(&s.supplier, &id), Err(Ok(Error::DisputeAlreadyOpen)));
}

#[test]
fn becoming_an_issuer_request_then_reject_then_approve() {
    let s = setup();
    let who = Address::generate(&s.env);
    let name = String::from_str(&s.env, "Quick Traders");
    let hash = BytesN::from_array(&s.env, &[9u8; 32]);
    s.client.request_issuer(&who, &name, &IssuerKind::Supplier, &hash);
    assert_eq!(s.client.list_issuer_requests().len(), 1);
    assert_eq!(
        s.client.try_request_issuer(&who, &name, &IssuerKind::Supplier, &hash),
        Err(Ok(Error::RequestAlreadyPending))
    );
    s.client.reject_issuer(&who);
    assert!(s.client.get_issuer_request(&who).unwrap().rejected); // stays visible as rejected
    assert_eq!(s.client.try_reject_issuer(&who), Err(Ok(Error::RequestNotFound))); // not twice
    s.client.request_issuer(&who, &name, &IssuerKind::Supplier, &hash); // may apply again
    assert!(!s.client.get_issuer_request(&who).unwrap().rejected);
    s.client.add_issuer(&who, &name, &IssuerKind::Supplier);
    assert_eq!(s.client.get_issuer_request(&who), None);
    assert_eq!(s.client.list_issuer_requests().len(), 0);
    assert_eq!(s.client.try_request_issuer(&who, &name, &IssuerKind::Supplier, &hash), Err(Ok(Error::AlreadyApproved)));
    assert_eq!(s.client.try_add_issuer(&who, &name, &IssuerKind::Supplier), Err(Ok(Error::AlreadyApproved)));
}

#[test]
fn the_app_can_list_issuers_and_shops() {
    let s = setup();
    let (_, _) = with_lender(&s);
    assert_eq!(s.client.list_issuers().len(), 2);
    assert_eq!(s.client.list_shops().len(), 0);
    issue(&s, &s.supplier, 0);
    issue_claim(&s, &s.supplier, symbol_short!("on_time"), 0);
    assert_eq!(s.client.list_shops().len(), 1); // one shop, however many credentials
    assert_eq!(s.client.get_config().verify_fee, FEE);
}
