import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";

import { login } from "./login.js";
import { installNetworkLogger } from "./network.js";

import {
    openSchedule,
    getOFCPosts
} from "./ofc.js";

import {
    checkPostAvailability
} from "./availability.js";


function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}


function loadCredentials() {

    const filePath = path.resolve(
        "creds",
        "account1.json"
    );

    if (!fs.existsSync(filePath)) {
        throw new Error(
            `Credentials file not found: ${filePath}`
        );
    }

    return JSON.parse(
        fs.readFileSync(filePath, "utf8")
    );
}


async function getPage(browser) {

    const pages = await browser.pages();

    console.log(
        `Connected to Chrome. Open pages: ${pages.length}`
    );

    // Prefer USTravelDocs/usvisascheduling page
    for (const page of pages) {

        const url = page.url();

        if (
            url.includes("ustraveldocs.com") ||
            url.includes("usvisascheduling.com")
        ) {
            return page;
        }
    }

    return pages[0] ||
        await browser.newPage();
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
            });


        if (state.loginForm) {

            console.log(
                "✅ Azure B2C login form detected."
            );

            return;
        }


        console.log(
            "Waiting...",
            state.url
        );

        await sleep(2000);
    }
}


async function notifyUser(result) {

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


async function main() {

    console.log(
        "Starting visa automation..."
    );


    const credentials =
        loadCredentials();


    // --------------------------------------------------
    // CONNECT TO EXISTING CHROME
    // --------------------------------------------------

    console.log(
        "Connecting to Chrome on port 9222..."
    );


    let browser;

    try {

        browser =
            await puppeteer.connect({
                browserURL:
                    "http://127.0.0.1:9222"
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


    const page =
        await getPage(browser);


    page.setDefaultTimeout(
        60_000
    );


    console.log(
        "Current page:",
        page.url()
    );


    installNetworkLogger(page);


    try {

        // --------------------------------------------------
        // If we're still on USTravelDocs, click Visa Login
        // --------------------------------------------------

        if (
            page.url().includes(
                "ustraveldocs.com"
            )
        ) {

            console.log(
                "Checking USTravelDocs..."
            );


            try {

                await page.locator(
                    "div.usa-dialog__header button"
                ).click({
                    timeout: 3000
                });

                console.log(
                    "Popup closed."
                );

            } catch {

                console.log(
                    "No popup to close."
                );
            }


            const loginButton =
                await page.$(
                    "#acs-login > span"
                );


            if (loginButton) {

                console.log(
                    "Clicking Visa Login..."
                );


                await loginButton.click();


                console.log(
                    "Visa Login clicked."
                );
            }
        }


        // --------------------------------------------------
        // Wait for Cloudflare to finish
        // --------------------------------------------------

        await waitForAzureLogin(page);


        // --------------------------------------------------
        // AUTOMATED LOGIN
        // --------------------------------------------------

        await login(
            page,
            credentials,
            {
                alreadyOnLoginPage: true
            }
        );


        // --------------------------------------------------
        // APPOINTMENT PAGE
        // --------------------------------------------------

        await openSchedule(page);


        // --------------------------------------------------
        // OFC POSTS
        // --------------------------------------------------

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


        // --------------------------------------------------
        // MONITOR
        // --------------------------------------------------

        const CHECK_INTERVAL =
            5 * 60 * 1000;


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
                "=======================================");


            for (const post of posts) {

                try {

                    const result =
                        await checkPostAvailability(
                            page,
                            post
                        );


                    if (result.available) {

                        await notifyUser(
                            result
                        );

                        console.log(
                            "Browser will remain open."
                        );

                        return;
                    }

                } catch (error) {

                    console.error(
                        `Error checking ${post.name}:`,
                        error.message
                    );
                }
            }


            console.log(
                "No appointment detected."
            );


            console.log(
                "Waiting 5 minutes..."
            );


            await sleep(
                CHECK_INTERVAL
            );
        }


    } catch (error) {

        console.error(
            "\n❌ ERROR:",
            error
        );

        console.log(
            "\nBrowser remains open."
        );
    }
}


main();