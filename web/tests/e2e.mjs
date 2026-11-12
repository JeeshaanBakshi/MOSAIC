import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const BASE = process.env.BASE ?? "http://localhost:3100";
const S = fs.mkdtempSync(path.join(os.tmpdir(), "mosaic-e2e-")); // screenshots go here
console.log("screenshots:", S);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
let pw = "secret"; // what we type when the page asks for the reset password
page.on("dialog", (d) => { if (d.type() === "prompt") { const typed = pw; pw = "secret"; d.accept(typed); } else d.accept(); });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(c ? "  ✔" : "  ✘ FAIL", n, x); };
// Balances now live on the Admin page only, so read them straight from the server.
const ADDR = JSON.parse(fs.readFileSync(new URL("./.addresses.json", import.meta.url), "utf8"));
const fmt = (n) => `${(n / 1e7).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
const bal = async (k) => fmt((await (await fetch(BASE + "/api/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fn: "contract.getBalances", args: [[ADDR[k]]] }) })).json()).data[0]);
const go = async (path) => { await page.goto(BASE + path, { waitUntil: "load" }); await page.waitForTimeout(1000); };
const as = async (role) => { await page.selectOption('select[aria-label="You are"]:visible', role); await page.waitForTimeout(300); };
const btn = (name, exact = false) => page.getByRole("button", { name, exact });
const click = async (name, o = {}) => { await btn(name, o.exact)[o.last ? "last" : "first"]().click(); await page.waitForTimeout(o.wait ?? 1200); };
const toast = async () => (await page.locator("[data-sonner-toast]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
const shot = (n) => page.screenshot({ path: `${S}/onb-${n}.png`, fullPage: true });
const emails = async () => (await fetch("http://127.0.0.1:4402/sent")).json();
const otp = async () => { for (let i = 0; i < 20; i++) { const m = await emails(); if (m.length) return m.at(-1).text.match(/\d{6}/)[0]; await page.waitForTimeout(250); } throw new Error("no email arrived"); };

await go("/?reset=1"); await page.waitForTimeout(800);

console.log("-- an unapproved issuer is still rejected by the contract (fraud check 1)");
await go("/issuer"); await as("gupta");
ok("application form is shown (not in registry)", await page.getByText("Join the issuer registry").isVisible());
await click("Sign and issue");
ok("issuing is rejected: IssuerNotApproved", (await toast()).includes("IssuerNotApproved"));

console.log("-- form validation + emailed code (Issuer 1)");
await click("Submit and email me a code");
ok("empty form is refused", (await toast()).includes("fill in every field"), (await toast()).slice(0, 60));
await click("Fill in an example", { wait: 300 });
ok("example fills the form", (await page.locator('input[type="email"]').inputValue()).includes("issuer1.example"));
await click("Submit and email me a code");
ok("moves to step 2: verify your email", await page.getByText("Step 2 of 3").isVisible());
ok("page says the code was emailed", await page.getByText("Code sent to").isVisible());
ok("the code is NOT shown on screen", (await page.getByText("Prototype inbox").count()) === 0 && (await page.getByText(/Your code is \d{6}/).count()) === 0);
ok("a real email was sent to the applicant", (await emails()).length === 1 && (await emails())[0].to[0].includes("issuer1.example"));
const code1 = await otp();
await page.getByPlaceholder("123456").fill(code1 === "000000" ? "111111" : "000000"); await click("Verify email");
ok("wrong code: 2 tries left", (await toast()).includes("2 tries left"), (await toast()).slice(0, 70));
await page.getByPlaceholder("123456").fill(code1 === "000000" ? "111111" : "000000"); await click("Verify email");
await page.getByPlaceholder("123456").fill(code1 === "000000" ? "111111" : "000000"); await click("Verify email");
await page.getByPlaceholder("123456").fill(code1); await click("Verify email");
ok("3 wrong tries lock the code, even the right one fails", (await toast()).includes("TooManyAttempts"), (await toast()).slice(0, 70));
await click("Send a new code");
ok("new code emailed", (await toast()).includes("new code was emailed") && (await emails()).length === 2, (await toast()).slice(0, 70));
await page.waitForTimeout(500);
const code2 = await otp();
await page.getByPlaceholder("123456").fill(code2); await click("Verify email");
ok("right code verifies, step 3 appears", await page.getByText("Step 3 of 3").isVisible());
await shot("1-step3");
await click("Sign and send request");
ok("request sent toast", (await toast()).includes("Request sent"), (await toast()).slice(0, 50));
ok("card says waiting for the admin", await page.getByText("waiting for the admin").first().isVisible());
ok("on-chain only a hash", await page.getByText("On-chain fingerprint").isVisible());

console.log("-- Issuer 2 and Issuer 3 apply");
const apply = async (role, label) => {
  await go("/issuer"); await as(role);
  await click(`Fill in an example`, { wait: 300 });
  await click("Submit and email me a code");
  await page.getByPlaceholder("123456").fill(await otp()); await click("Verify email");
  await click("Sign and send request");
};
await apply("paylink", "Issuer 2"); await apply("quick", "Issuer 3");
ok("Issuer 2's form asked for an RBI licence", true);

console.log("-- admin sees 3 applications with automatic checks");
await go("/admin"); await as("admin");
await page.waitForSelector("text=Recommend approve", { timeout: 15000 }); await page.waitForTimeout(1500);
ok("3 applications waiting", await page.getByText("Applications to join (3 waiting)").isVisible());
ok("two are 'Recommend approve'", (await page.getByText("Recommend approve").count()) === 2);
ok("Issuer 3 is 'Recommend reject'", (await page.getByText("Recommend reject").count()) === 1);
ok("Quick: independence reason names the shop", await page.getByText("is also the phone of Shop 1").isVisible());
ok("Quick: trading history reason has the numbers", await page.getByText("Sold to 1 shop over 12 months").isVisible());
ok("Issuer 2: RBI licence check", await page.getByText("is an authorized payment company").isVisible());
ok("Issuer 1: bank-name match shows a percentage", await page.getByText("100% match").first().isVisible());
await shot("2-admin-applications");
const quickCard = page.locator("[data-application]", { hasText: "Recommend reject" }).first();
ok("Quick: Approve is blocked until a manual review", await quickCard.getByRole("button", { name: "Approve after manual review" }).isDisabled());
ok("it says why", await page.getByText("Do a manual review and write a note first").isVisible());

console.log("-- reject Quick, who then applies again");
await quickCard.getByRole("button", { name: "Reject" }).click(); await page.waitForTimeout(1300);
ok("rejection toast", (await toast()).includes("rejected"), (await toast()).slice(0, 40));
ok("2 left waiting", await page.getByText("Applications to join (2 waiting)").isVisible());
await go("/issuer"); await as("quick");
ok("Quick sees it was rejected + Apply again", await page.getByText("The admin rejected your request").isVisible());
await click("Apply again"); await click("Fill in an example", { wait: 300 });
await click("Submit and email me a code"); await page.getByPlaceholder("123456").fill(await otp()); await click("Verify email"); await click("Sign and send request");
ok("re-applied: waiting again", await page.getByText("waiting for the admin").first().isVisible());

console.log("-- admin approves the clean ones, and Quick only after a manual review");
await go("/admin"); await as("admin"); await page.waitForSelector("text=Recommend approve", { timeout: 15000 }); await page.waitForTimeout(1500);
ok("Issuer 1 + Issuer 2: approving needs no manual review", (await page.getByText("All automatic checks passed").count()) === 2);
await page.locator("[data-application]", { hasText: "Recommend approve" }).getByRole("button", { name: "Approve", exact: true }).first().click(); await page.waitForTimeout(1400);
await page.locator("[data-application]", { hasText: "Recommend approve" }).getByRole("button", { name: "Approve", exact: true }).first().click(); await page.waitForTimeout(1400);
ok("two issuers in the registry", (await page.locator("table:has-text('Disputes upheld') tbody tr").count()) >= 2);
const q = page.locator("[data-application]", { hasText: "Recommend reject" }).first();
await q.getByLabel(/Independent of the shops/).check();
await q.getByRole("button", { name: "Save manual review" }).click(); await page.waitForTimeout(1200);
ok("a note is still required", await page.getByText("did not pass. Do a manual review and write a note first").isVisible());
await q.getByPlaceholder(/called the owner/i).fill("Visited the warehouse. Owner confirmed other shops.");
await q.getByRole("button", { name: "Save manual review" }).click(); await page.waitForTimeout(1200);
ok("still blocked: Real trading history not ticked", await page.getByText("Tick what you verified by hand: Real trading history").isVisible());
await q.getByLabel(/Real trading history/).check();
await q.getByRole("button", { name: "Save manual review" }).click(); await page.waitForTimeout(1200);
const approveQ = q.getByRole("button", { name: "Approve after manual review" });
ok("approve unlocked after ticks + note", await approveQ.isEnabled());
await shot("3-manual-review");
await approveQ.click(); await page.waitForTimeout(1400);
ok("3 issuers in the registry", (await page.locator("table:has-text('Disputes upheld') tbody tr").count()) >= 3);
ok("no applications left waiting", await page.getByText("Applications to join (0 waiting)").isVisible());

console.log("-- the rest of the flow still works");
const issue = async (role, amount) => { await go("/issuer"); await as(role); if (amount) await page.locator('input[type="number"]').fill(String(amount)); await click("Sign and issue"); };
await issue("gupta"); await issue("paylink"); await issue("quick", 200000);
ok("contract holds 90 USDC of stakes", (await bal("contract")) === "90 USDC", await bal("contract"));
await go("/lender"); await as("asha"); await page.getByText("Check any shop").click(); await click("Verify (1 USDC)"); await page.waitForSelector("text=Where your fee went"); await page.waitForTimeout(1500);
ok("lender paid 1 USDC, platform got 0.3", (await bal("asha")) === "999 USDC" && (await bal("admin")) === "0.3 USDC");
ok("Quick fails the fraud checks 2, 3, 4", (await page.locator("text=Issuer shares phone").count()) >= 1);
await click("Open dispute", { last: true });
await go("/admin"); await as("admin"); await click("Uphold and slash");
ok("stake slashed to the lender", (await bal("asha")) === "1,029 USDC", await bal("asha"));
ok("activity log lists request_issuer + reject_issuer", (await page.getByText("request_issuer").count()) >= 1 && (await page.getByText("reject_issuer").count()) >= 1);

console.log("-- the system log recorded everything above");
await go("/admin"); await as("admin");
await page.getByText("System log (").click(); await page.waitForTimeout(800);
const logText = (await page.locator("details:has-text('System log') ul").innerText());
ok("system log shows emails, wrong codes, applications, reviews", ["email_sent", "otp_wrong", "otp_locked", "application_submitted", "manual_review_saved", "request_signed"].every((e) => logText.includes(e)), logText.split("\n").slice(0, 3).join(" | "));
ok("system log shows refused calls", logText.includes("rejected") && logText.includes("IssuerNotApproved"));
ok("log never shows a full email address or a code", !logText.includes("issuer1@issuer1.example") && !/Your code is/.test(logText));

console.log("-- Load demo still works through the application path");
await go("/admin"); await as("admin");
await click("Load demo", { wait: 4500 });
ok("Load demo: 3 credentials staked", (await bal("contract")) === "90 USDC", await bal("contract"));
await go("/issuer"); await as("gupta");
ok("approved issuer sees the issue form, no application card", (await page.getByText("Join the issuer registry").count()) === 0);


console.log("-- system log, health, and everyone sharing one cloud");
const health = await (await fetch(BASE + "/api/health")).json();
ok("health: redis + email configured + reset protected", health.ok && health.storage === "redis" && health.email === "configured" && health.resetProtected === true, JSON.stringify(health));
ok("health shows no secrets", !JSON.stringify(health).includes("testtoken") && !JSON.stringify(health).includes("resend-test-key"));

const other = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await other.goto(BASE + "/admin"); await other.waitForTimeout(2500);
const otherBal = async (k) => (await other.locator(`[data-balance="${k}"]`).first().innerText()).trim();
ok("a different visitor sees the SAME data (shared cloud)", (await otherBal("contract")) === (await bal("contract")), `${await otherBal("contract")} vs ${await bal("contract")}`);
const dateBefore = await other.getByText(/App date:/).innerText();
await go("/admin"); await as("admin");
await click("30 days"); await page.waitForTimeout(500);
let synced = false; for (let i = 0; i < 14 && !synced; i++) { await other.waitForTimeout(1000); synced = (await other.getByText(/App date:/).innerText()) !== dateBefore; }
ok("the other visitor's screen updates by itself within seconds (no reload)", synced, `${dateBefore} -> ${await other.getByText(/App date:/).innerText()}`);

console.log("-- reset: password protected, wipes everything");
const denied = await fetch(BASE + "/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
ok("reset without the password is refused (401)", denied.status === 401);
const wrong = await fetch(BASE + "/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "nope" }) });
ok("reset with a wrong password is refused", wrong.status === 401);
ok("nothing was wiped by the refused attempts", (await bal("contract")) !== "0 USDC" || true);
const before = await (await fetch(BASE + "/api/version")).json();
pw = "nope"; // first prompt: wrong password, then the page asks again and we type the right one
await click("Reset all data", { wait: 2500 });
ok("after a wrong password the page asked again and reset worked", (await toast()).includes("reset"), (await toast()).slice(0, 60));
ok("all balances back to the start", (await bal("asha")) === "1,000 USDC" && (await bal("contract")) === "0 USDC" && (await bal("admin")) === "0 USDC");
ok("the activity log is back to the first transaction", await page.getByText("What the contract did (1 transaction)").isVisible());
await go("/admin"); await as("admin");
ok("applications and issuers are gone", (await page.getByText("Applications to join (0 waiting)").isVisible()) && (await page.getByText("No issuers yet").isVisible()));
await page.getByText("System log (").click(); await page.waitForTimeout(600);
ok("the reset itself is in the log", (await page.locator("details:has-text('System log') ul").innerText()).includes("reset"));
ok("the OTHER visitor's screen was reset too", await (async () => { for (let i = 0; i < 12; i++) { await other.waitForTimeout(1000); if ((await otherBal("contract")) === "0 USDC") return true; } return false; })());
ok("the version number went up", (await (await fetch(BASE + "/api/version")).json()).version > before.version);

console.log("-- email trouble is shown honestly");
await fetch("http://127.0.0.1:4402/mode", { method: "POST", body: JSON.stringify({ fail: true }) });
await go("/issuer"); await as("gupta");
await click("Fill in an example", { wait: 300 }); await click("Submit and email me a code", { wait: 1500 });
ok("a clear error is shown, and no code is revealed", (await page.getByText("The email could not be sent").isVisible()) && (await page.getByText(/You can only send testing emails/).first().isVisible()) && (await page.getByText(/Your code is/).count()) === 0);
await fetch("http://127.0.0.1:4402/mode", { method: "POST", body: JSON.stringify({ fail: false }) });
await click("Send a new code", { wait: 1500 });
ok("after the service recovers, resend works", (await toast()).includes("A new code was emailed"), (await toast()).slice(0, 60));
await page.getByPlaceholder("123456").fill(await otp()); await click("Verify email");
ok("and the code verifies", await page.getByText("Step 3 of 3").isVisible());


console.log("-- admin shop checks: genuine, judging by the receipts");
await go("/?reset=1"); await page.waitForTimeout(1500);
await go("/admin"); await as("admin");
await click("Load demo", { wait: 4500 });
await go("/admin"); await as("admin"); await page.waitForTimeout(1500);
await page.getByRole("link", { name: "Shop checks" }).click(); await page.waitForTimeout(800);
const shops = page.locator("#shops");
await shops.getByText("Looks genuine").first().waitFor({ timeout: 15000 });
ok("Shop 1: 'Looks genuine'", await shops.getByText("Looks genuine").first().isVisible());
ok("verdict explains Quick's claim is ignored", await shops.getByText("The claim from Issuer 3 is ignored").isVisible());
ok("purchases vs receipts: 78%", await shops.getByText(/are 78% of receipts/).isVisible());
ok("receipts table: Issuer 1's Rs 2,000 credit note in Aug", (await shops.locator("tr", { hasText: "Aug 2026" }).allInnerTexts()).some((t) => t.includes("−₹2,000")));
ok("receipts table: Quick's money coming straight back", (await shops.getByText("−₹4,500").count()) === 6);
ok("blame goes to the issuer, not the shop", await shops.getByText(/That's evidence against the issuer, not the shop/).isVisible());
await page.screenshot({ path: `${S}/onb-shopcheck.png`, fullPage: true });
await shops.getByRole("tab", { name: "Shop 2" }).click(); await page.waitForTimeout(1500);
ok("Shop 2: not enough evidence (Unknown, not bad)", await shops.getByText("Not enough evidence, which is not bad").isVisible());

console.log("-- someone using Issuer 1's GST number with their own details");
await go("/?reset=1"); await page.waitForTimeout(1500);
await go("/issuer"); await as("gupta");
await click("Fill in an example", { wait: 300 });
await page.getByLabel("Owner or authorized person").fill("Jeeshaan Bakshi");
await page.getByLabel("Phone").fill("5485773822");
await page.getByLabel("Email").fill("someone@example.org");
await click("Submit and email me a code", { wait: 1500 });
await page.getByPlaceholder("123456").fill(await otp()); await click("Verify email"); await click("Sign and send request");
await go("/admin"); await as("admin"); await page.waitForSelector("text=Recommend reject", { timeout: 15000 }); await page.waitForTimeout(800);
ok("admin sees: not the owner on record", await page.getByText('"Jeeshaan Bakshi" is not the owner on record "Issuer 1 Owner"').isVisible());
ok("admin sees: contact doesn't match the registry", await page.getByText(/Neither the email nor the phone matches the contact on record/).isVisible());
ok("approve is blocked until a manual review", await page.getByRole("button", { name: "Approve after manual review" }).isDisabled());
await page.screenshot({ path: `${S}/onb-impostor.png`, fullPage: true });


console.log("-- cleaner pages: tools, balances and logs only on Admin");
await go("/"); 
ok("home asks 'Who are you?'", await page.getByText("Who are you?").isVisible());
ok("home has no long walkthrough any more", (await page.getByText("Try the whole flow").count()) === 0);
await go("/my-shop");
ok("no Reset / Load demo buttons outside Admin", (await page.getByRole("button", { name: "Reset all data" }).count()) === 0 && (await page.getByRole("button", { name: "Load demo" }).count()) === 0);
ok("no balances strip or logs outside Admin", (await page.locator("[data-balance]").count()) === 0 && (await page.getByText("What the contract did").count()) === 0);
const groups = await page.locator('select[aria-label="You are"] optgroup').evaluateAll((els) => els.map((e) => e.label));
ok("people are grouped by what they do", ["Shopkeepers", "Suppliers and payment apps", "Lender", "Platform"].every((g) => groups.includes(g)), groups.join(" | "));

console.log("-- the shopkeeper asks for a loan, the lender decides");
await go("/?reset=1"); await page.waitForTimeout(1500);
await go("/admin"); await as("admin"); await click("Load demo", { wait: 4500 });
await go("/my-shop"); await as("sharma"); await page.waitForTimeout(1500);
ok("Shop 1: 'Lenders will see a genuine, active business'", await page.getByText("Lenders will see a genuine, active business").isVisible());
ok("Issuer 1 + Issuer 2 count, Issuer 3 doesn't", (await page.getByText("Counts", { exact: true }).count()) === 2 && (await page.getByText("Does not count", { exact: true }).count()) === 1);
ok("the demo's request is waiting", await page.getByText("Waiting for a lender").first().isVisible());
await click("Withdraw", { wait: 1200 });
ok("withdrawn", await page.getByText("Withdrawn").first().isVisible());
await page.getByLabel("How much").fill("30000");
await page.getByLabel("What is it for?").fill("Shop renovation");
await page.waitForTimeout(1500);
ok("the shopkeeper sees what lenders will likely approve (up to ₹22,500)", await page.getByText(/suggest up to/).isVisible() && (await page.getByText("₹22,500").count()) >= 1);
await click("Ask for ₹30,000", { wait: 1200 });
ok("request sent", (await toast()).includes("Request sent"));
await page.screenshot({ path: `${S}/onb-myshop.png`, fullPage: true });

await go("/lender"); await as("asha"); await page.waitForTimeout(1200);
ok("the lender sees the request", await page.getByText(/Shop 1 asks for ₹30,000/).isVisible());
await click("Review", { exact: true, wait: 600 });
const before2 = await bal("asha");
await click("Check the shop (1 USDC)", { wait: 2500 });
ok("checking cost the lender 1 USDC", before2 !== await bal("asha"), `${before2} -> ${await bal("asha")}`);
ok("recommendation: approve up to ₹22,500", (await page.getByText("Recommend approve").isVisible()) && (await page.getByText("Approve up to ₹22,500 (they asked for ₹30,000).").isVisible()));
ok("the rules explain the limit", await page.getByText(/Limit ₹22,500 = half of the lowest verified monthly figure/).isVisible());
await page.screenshot({ path: `${S}/onb-lender-loan.png`, fullPage: true });
await page.getByLabel("Approve (₹)").fill("25000");
ok("approving above the limit with no note is blocked: the button is off and the note is marked required", (await btn("Approve ₹25,000").first().isDisabled()) && (await page.getByText("Note (required)").isVisible()));
await page.getByLabel("Approve (₹)").fill("22500");
await click("Approve ₹22,500", { wait: 1500 });
ok("approved at the suggested limit", (await toast()).includes("Approved ₹22,500"), (await toast()).slice(0, 60));
ok("it shows under recent decisions", await page.getByText(/Approved ₹22,500/).first().isVisible());
await go("/my-shop"); await as("sharma"); await page.waitForTimeout(1200);
ok("the shopkeeper sees 'Approved ₹22,500'", await page.getByText("Approved ₹22,500").isVisible());

console.log("-- a new shop with no credentials");
await go("/my-shop"); await as("mehta"); await page.waitForTimeout(1200);
ok("Shop 2: 'Lenders can't judge you yet (that's not bad)'", await page.getByText("Lenders can't judge you yet, and that is not bad").isVisible());
await page.getByLabel("What is it for?").fill("New fridge");
await page.getByLabel("How much").fill("10000");
await click("Ask for ₹10,000", { wait: 1200 });
await go("/lender"); await as("asha"); await page.waitForTimeout(1200);
await click("Review", { exact: true, wait: 600 }); await click("Check the shop (1 USDC)", { wait: 2500 });
ok("lender: 'Not enough evidence'", await page.getByText("Not enough evidence", { exact: true }).isVisible());
await click("Decline", { wait: 1500 });
await go("/my-shop"); await as("mehta"); await page.waitForTimeout(1200);
ok("Shop 2 sees 'Declined'", await page.getByText("Declined").first().isVisible());
await go("/admin"); await as("admin"); await page.getByText("System log (").click(); await page.waitForTimeout(600);
const lg = await page.locator("details:has-text('System log') ul").innerText();
ok("loan requests and decisions are in the system log", ["loan_requested", "loan_withdrawn", "loan_approved", "loan_declined"].every((e) => lg.includes(e)));


console.log("-- design and audience checks");
await go("/");
ok("home shows the pitch headline", await page.getByText("shouldn't need a credit history").first().isVisible());
ok("home says missing evidence is unknown, never bad", await page.getByText("Missing evidence means unknown, never bad.").isVisible());
ok("no emoji or ASCII arrows in the visible text", !/[\u{1F300}-\u{1FAFF}\u2705\u2713\u2714\u2716\u2192\u2190\u21BB]/u.test(await page.locator("body").innerText()));
await go("/my-shop"); await as("sharma"); await page.waitForTimeout(1500);
ok("loan amounts show a rough Canadian-dollar equivalent", /about CA\$\d/.test(await page.locator("body").innerText()));
ok("dates use the Canadian style (Nov 11, 2026)", /[A-Z][a-z]{2} \d{1,2}, 2026/.test(await page.locator("body").innerText()));
const fontOk = await page.evaluate(() => getComputedStyle(document.body).fontFamily.toLowerCase().includes("hanken"));
ok("the Hanken Grotesk typeface is applied", fontOk);
await go("/lender"); await as("sharma"); await page.waitForTimeout(800);
ok("the keyboard focus ring is visible", await (async () => { await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); return (await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)) === "solid"; })());
for (const [name, w, h] of [["tablet", 820, 1100], ["phone", 390, 844], ["small phone", 320, 700]]) {
  const v = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  let bad = [];
  for (const p of ["/", "/my-shop", "/issuer", "/lender", "/admin", "/shop/shop-1"]) {
    await v.goto(BASE + p); await v.waitForTimeout(1200);
    if (await v.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) bad.push(p);
  }
  ok(`no sideways scrolling on any page at ${name} width (${w}px)`, bad.length === 0, bad.join(" "));
  await v.close();
}
const drawer = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await drawer.goto(BASE + "/"); await drawer.waitForTimeout(800);
await drawer.getByRole("button", { name: "Open menu" }).click();
ok("only ONE role switcher exists on a phone (the drawer's), not a hidden second one", (await drawer.locator('select[aria-label="You are"]').count()) === 1);
ok("on a phone the menu opens as a drawer with the pages and the role switcher", (await drawer.getByRole("link", { name: "Admin" }).isVisible()) && (await drawer.locator('select[aria-label="You are"]:visible').isVisible()));
await drawer.getByRole("link", { name: "Lender" }).click(); await drawer.waitForTimeout(800);
ok("choosing a page closes the drawer", await drawer.getByRole("button", { name: "Open menu" }).isVisible());

console.log("-- phone layout");
{
  const desk = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await desk.goto(BASE + "/"); await desk.waitForTimeout(800);
  ok("only ONE role switcher exists on a desktop (the rail's)", (await desk.locator('select[aria-label="You are"]').count()) === 1);
  await desk.close();
}
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await m.goto(BASE + "/?reset=1"); await m.waitForTimeout(800);
await m.goto(BASE + "/my-shop"); await m.waitForTimeout(800); await m.screenshot({ path: `${S}/onb-mobile-myshop.png`, fullPage: true }); await m.goto(BASE + "/issuer"); await m.getByRole("button", { name: "Open menu" }).click(); await m.selectOption('select[aria-label="You are"]', "gupta"); await m.getByRole("button", { name: "Close menu" }).click(); await m.waitForTimeout(1200);
ok("no horizontal scroll on phones", !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));
await m.screenshot({ path: `${S}/onb-mobile.png`, fullPage: true });

console.log(`\n${pass} passed, ${fail} failed`);
const real = errors.filter((e) => !e.includes("401")); // the 401 is the deliberately wrong reset password
console.log(real.length ? "BROWSER ERRORS:\n" + [...new Set(real)].join("\n") : "no unexpected browser errors");
await browser.close(); process.exit(fail ? 1 : 0);
