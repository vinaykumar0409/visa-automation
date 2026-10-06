import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { AsyncLocalStorage } from "async_hooks";
import { spawn } from "child_process";

import { login } from "./login.js";

import {
    openSchedule,
    getOFCPosts
} from "./ofc.js";

import {
    checkPostAvailability,
    bookBestSlot
} from "./availability.js";


const AUTO_SUBMIT = true;

const START_URL =
    "https://www.ustraveldocs.com/in/en/nonimmigrant-visa";

const CHECK_INTERVAL =
    60 * 1000;

const BLOCK_BACKOFF =
    5 * 60 * 1000;

const START_STAGGER =
    0;

// All accounts begin monitoring together and check on the same ticks
const GATE_TIMEOUT =
    3 * 60 * 1000;

let totalAccounts = 0;

const settledAccounts = new Set();

let monitorBase = 0;

let openGate;

const monitoringGate =
    new Promise(resolve => {
        openGate = resolve;
    });

function settleAccount(name) {

    settledAccounts.add(name);

    if (settledAccounts.size >= totalAccounts) {
        openGate();
    }
}


// ------------------------------------------------------
// Prefix every log line with the account that produced it
// ------------------------------------------------------

const accountContext =
    new AsyncLocalStorage();

for (const method of ["log", "error"]) {

    const original =
        console[method].bind(console);

    console[method] = (...args) => {

        const name =
            accountContext.getStore();

        if (!name) {
            return original(...args);
        }

        if (typeof args[0] === "string") {
            args[0] =
                args[0].replace(
                    /^(\n*)/,
                    `$1[${name}] `
                );
            return original(...args);
        }

        return original(`[${name}]`, ...args);
    };
}


function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}


function loadAccounts() {

    const dir = path.resolve("creds");

    if (!fs.existsSync(dir)) {
        throw new Error(
            `Credentials folder not found: ${dir}`
        );
    }

    const accounts =
        fs.readdirSync(dir)
            .filter(file =>
                /^account.*\.json$/i.test(file)
            )
            .sort()
            .map(file => {

                const credentials =
                    JSON.parse(
                        fs.readFileSync(
                            path.join(dir, file),
                            "utf8"
                        )
                    );

                if (
                    !credentials.username ||
                    !credentials.password
                ) {
                    throw new Error(
                        `${file}: username/password missing`
                    );
                }

                return {
                    name: path.basename(file, ".json"),
                    credentials
                };
            });

    if (!accounts.length) {
        throw new Error(
            `No account*.json files found in ${dir}`
        );
    }

    return accounts;
}


async function waitForAzureLogin(page) {

    console.log(
        "\nWaiting for Azure B2C login form..."
    );

    while (true) {

        const state =
            await page.evaluate(() => {

                const username =
                    document.querySelector(
                        "#signInName"
                    );

                const password =
                    document.querySelector(
                        "#password"
                    );

                return {
                    url: location.href,
                    title: document.title,
                    loginForm:
                        !!username &&
                        !!password
                };
            }).catch(() => null);


        if (!state) {

            await sleep(1000);

            continue;
        }


        if (state.loginForm) {

            console.log(
                "✅ Azure B2C login form detected."
            );

            return;
        }


        console.log(
            "Waiting...",
            state.url.slice(0, 100)
        );

        await sleep(1000);
    }
}


function playAlertSound(times = 6) {

    try {

        spawn(
            "powershell",
            [
                "-NoProfile",
                "-Command",
                `1..${times} | ForEach-Object { [console]::beep(1400, 350); Start-Sleep -Milliseconds 150 }`
            ],
            { stdio: "ignore", windowsHide: true }
        ).on("error", () => {});

    } catch {
        // Sound is best-effort
    }
}


async function notifyUser(result) {

    playAlertSound();

    console.log("");
    console.log(
        "======================================="
    );

    console.log(
        "🎉 POSSIBLE APPOINTMENT AVAILABLE!"
    );

    console.log(
        "======================================="
    );

    console.log(
        "OFC:",
        result.post.name
    );

    console.log(
        "URL:",
        result.url
    );

    console.log(
        "Candidate dates:"
    );

    for (const date of result.dateCandidates) {

        console.log(
            "-",
            date.dataDate || date.text
        );
    }

    console.log(
        "======================================="
    );

    // Windows terminal beep
    process.stdout.write("\x07");
    process.stdout.write("\x07");
}


async function isAccessLimited(page) {

    const text = await page.evaluate(() =>
        document.body?.innerText || ""
    ).catch(() => "");

    return /access limitation|prohibited conduct/i.test(text);
}


async function logoutAndClose(page, context) {

    console.log("Logging out of this account and closing its tab...");

    try {

        const link = await page.$(
            "a[href*='LogOff' i], a[href*='signout' i], a[href*='logout' i]"
        );

        if (link) {

            await link.click();

        } else {

            await page.goto(
                "https://www.usvisascheduling.com/Account/Login/LogOff",
                { waitUntil: "domcontentloaded", timeout: 20_000 }
            );
        }

        await sleep(3000);

    } catch (error) {

        console.log("Logout page did not respond:", error.message);
    }

    // Closing the isolated context also discards this account's session cookies
    await context.close().catch(() => {});
}


async function runAccount(browser, { name, credentials }, state) {

    console.log("Starting...");

    // Isolated cookies/session per account
    const context =
        await browser.createBrowserContext();

    state.context = context;

    const page =
        await context.newPage();

    page.setDefaultTimeout(
        60_000
    );

    await page.goto(
        START_URL,
        { waitUntil: "domcontentloaded" }
    );

    console.log(
        "Opened:",
        page.url()
    );


    await page.locator(
        "div.usa-dialog__header button"
    ).click({
        timeout: 3000
    }).catch(() => {
        console.log("No popup to close.");
    });


    const loginButton =
        await page.$(
            "#acs-login > span"
        );

    if (loginButton) {

        console.log(
            "Clicking Visa Login..."
        );

        await loginButton.click();
    }


    // Wait for Cloudflare / the login form
    await waitForAzureLogin(page);

    await login(
        page,
        credentials,
        {
            alreadyOnLoginPage: true
        }
    );

    await openSchedule(page);

    const posts =
        await getOFCPosts(page);

    if (!posts.length) {

        throw new Error(
            "No OFC posts found."
        );
    }

    console.log("");
    console.log(
        `Found ${posts.length} OFC post(s).`
    );

    state.monitoring = true;

    settleAccount(name);

    console.log(
        "Ready. Waiting for the other account(s) so monitoring starts together..."
    );

    await Promise.race([
        monitoringGate,
        sleep(GATE_TIMEOUT)
    ]);

    if (!monitorBase) {
        monitorBase = Date.now();
    }

    // Slots that already failed ("no longer available") are never retried
    const failedSlots = new Set();


    while (true) {

        console.log("");
        console.log(
            "======================================="
        );

        console.log(
            "Checking appointment availability"
        );

        console.log(
            new Date().toLocaleString()
        );

        console.log(
            "======================================="
        );


        let blocked = false;

        if (await isAccessLimited(page)) {

            playAlertSound(3);

            console.log(
                "⚠ Access limitation page detected. Stopping this account."
            );

            await logoutAndClose(page, context);

            return;
        }

        for (const post of posts) {

            try {

                let result =
                    await checkPostAvailability(
                        page,
                        post
                    );

                for (let round = 1; result.available; round++) {

                    await notifyUser(
                        result
                    );

                    await page.bringToFront().catch(() => {});

                    let booking = null;

                    if (AUTO_SUBMIT) {

                        try {

                            booking = await bookBestSlot(
                                page,
                                failedSlots,
                                post.name
                            );

                            console.log(
                                "If a Cloudflare check or confirmation page is shown, finish it manually in this tab."
                            );

                        } catch (error) {

                            console.error(
                                "Auto-booking failed, book manually:",
                                error.message
                            );
                        }
                    }

                    if (
                        booking &&
                        ["gone", "gaveup"].includes(booking.outcome)
                    ) {

                        if (round >= 5) {

                            console.log(
                                `Not booked at ${post.name}. Moving on to the next location.`
                            );

                            break;
                        }

                        console.log(
                            `Slot not booked (${booking.outcome}). Re-checking ${post.name} for other dates/times...`
                        );

                        result =
                            await checkPostAvailability(
                                page,
                                post
                            );

                        continue;
                    }

                    await page.bringToFront().catch(() => {});

                    playAlertSound(10);

                    console.log(
                        "Tab will remain open."
                    );

                    return;
                }

            } catch (error) {

                console.error(
                    `Error checking ${post.name}:`,
                    error.message
                );

                if (await isAccessLimited(page)) {

                    playAlertSound(3);

                    console.log(
                        "⚠ Access limitation page detected. Stopping this account."
                    );

                    await logoutAndClose(page, context);

                    return;
                }

                if (/\b403\b/.test(error.message)) {
                    blocked = true;
                    break;
                }
            }
        }


        console.log(
            "No appointment detected."
        );

        if (blocked) {

            console.log(
                `Site returned 403. Backing off for ${BLOCK_BACKOFF / 60000} minutes.`
            );

            await sleep(BLOCK_BACKOFF);
        }

        // Next tick on the schedule shared by all accounts
        const now = Date.now();

        const next =
            monitorBase +
            (Math.floor((now - monitorBase) / CHECK_INTERVAL) + 1) *
            CHECK_INTERVAL;

        console.log(
            `Next check at ${new Date(next).toLocaleTimeString()} (in ${Math.round((next - now) / 1000)}s)...`
        );

        await sleep(
            next - now
        );
    }
}


async function main() {

    console.log(
        "Starting visa automation..."
    );

    const accounts =
        loadAccounts();

    console.log(
        `Accounts: ${accounts.map(a => a.name).join(", ")}`
    );

    console.log(
        "Connecting to Chrome on port 9222..."
    );

    let browser;

    try {

        browser =
            await puppeteer.connect({
                browserURL:
                    "http://127.0.0.1:9222",
                defaultViewport:
                    null
            });

    } catch (error) {

        console.error("");
        console.error(
            "❌ Could not connect to Chrome."
        );

        console.error("");
        console.error(
            "Make sure Chrome was started with:"
        );

        console.error("");

        console.error(
            '--remote-debugging-port=9222'
        );

        console.error("");

        throw error;
    }

    console.log(
        "✅ Connected to Chrome."
    );


    totalAccounts = accounts.length;

    const runs = accounts.map((account, index) =>
        accountContext.run(account.name, async () => {

            await sleep(index * START_STAGGER);

            const MAX_ATTEMPTS = 3;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {

                const state = {
                    context: null,
                    monitoring: false
                };

                try {

                    await runAccount(
                        browser,
                        account,
                        state
                    );

                    return;

                } catch (error) {

                    console.error(
                        `\n❌ ERROR (attempt ${attempt}/${MAX_ATTEMPTS}):`,
                        error.message
                    );

                    // Only retry failures during setup, not once monitoring has started
                    if (state.monitoring || attempt === MAX_ATTEMPTS) {

                        settleAccount(account.name);

                        console.log(
                            "Tab remains open."
                        );

                        return;
                    }

                    await state.context?.close().catch(() => {});

                    console.log(
                        "Retrying in 30 seconds..."
                    );

                    await sleep(30_000);
                }
            }
        })
    );

    await Promise.all(runs);

    console.log(
        "\nAll accounts finished. Browser stays open; press Ctrl+C to exit."
    );

    await new Promise(() => {});
}


main();
