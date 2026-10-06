import fs from "fs";

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function bookBestSlot(page, skip = new Set(), postName = "") {

    console.log("\nAuto-booking: looking for a slot not tried before...");

    const dateCount = (await page.$$("#datepicker td a")).length;

    if (!dateCount) {
        throw new Error("No enabled date link found in the calendar.");
    }

    let rows = [];
    let best = null;

    // Walk the available dates in order until one has an untried slot
    for (let d = 0; d < dateCount && !best; d++) {

        const links = await page.$$("#datepicker td a");

        if (!links[d]) {
            break;
        }

        await links[d].click();

        const ready = await page.waitForSelector(
            "#time_select tbody tr input[type='radio']",
            { timeout: 15_000 }
        ).catch(() => null);

        if (!ready) {
            continue;
        }

        await sleep(500);

        rows = await page.$$("#time_select tbody tr");

        const slots = [];

        for (const [index, row] of rows.entries()) {

            const slot = await row.evaluate(element => {

                const cells = element.querySelectorAll("td");

                return {
                    date: cells[0]?.innerText.trim() || "",
                    time: cells[1]?.innerText.trim() || "",
                    availability:
                        parseInt(
                            cells[2]?.innerText.replace(/\D/g, ""),
                            10
                        ) || 0,
                    hasRadio: !!element.querySelector("input[type='radio']")
                };
            });

            if (slot.hasRadio) {
                slots.push({
                    ...slot,
                    index,
                    key: `${postName}|${slot.date}|${slot.time}`
                });
            }
        }

        console.log("Time slots:");

        for (const slot of slots) {
            console.log(
                `- ${slot.date} ${slot.time} (availability: ${slot.availability})${skip.has(slot.key) ? " [already failed, skipping]" : ""}`
            );
        }

        const usable = slots.filter(slot => !skip.has(slot.key));

        if (usable.length) {
            // Highest availability wins; ties go to the earliest row
            best = usable.reduce((a, b) =>
                b.availability > a.availability ? b : a
            );
        }
    }

    if (!best) {
        console.log("No untried slots left at this location.");
        return { outcome: "gaveup" };
    }

    console.log(
        `Selecting: ${best.date} ${best.time} (availability: ${best.availability})`
    );

    const row = rows[best.index];

    await row.$("label").then(label => label?.click());

    const checked = await row.$eval(
        "input[type='radio']",
        input => input.checked
    );

    if (!checked) {
        await row.$("input[type='radio']").then(input => input.click());
    }

    await sleep(500);

    console.log("Clicking Submit...");

    const seen = [];

    const onResponse = response => {

        if (
            response.request().method() === "POST" &&
            response.url().includes("usvisascheduling.com")
        ) {
            const url = new URL(response.url());

            seen.push(
                `${response.status()} ${url.pathname} ${url.searchParams.get("route") || ""}`.trim()
            );
        }
    };

    page.on("response", onResponse);

    await Promise.all([
        page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 30_000
        }).catch(() => {}),
        page.click("#submitbtn")
    ]);

    await sleep(2000);

    page.off("response", onResponse);

    console.log("Submitted. Current URL:", page.url());
    console.log("Requests after Submit:", seen.length ? seen : "none");

    const messages = await page.$$eval(
        ".alert, .validation-summary-errors, [role='alert'], .field-validation-error, .text-danger",
        elements =>
            elements
                .map(element => element.innerText.trim())
                .filter(Boolean)
                .slice(0, 5)
    ).catch(() => []);

    console.log("Page messages:", messages.length ? messages : "none");

    fs.mkdirSync("screenshots", { recursive: true });

    const shot = `screenshots/submit-${Date.now()}.png`;

    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

    console.log("Screenshot saved:", shot);

    const MAX_TRIES = 8;

    let outcome = "unknown";

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {

        await sleep(2000);

        await waitForHumanCheck(page);

        const text = await page.evaluate(() =>
            document.body?.innerText || ""
        ).catch(() => "");

        if (
            /(appointment|schedul\w*)\s+(has been\s+)?(confirmed|scheduled|successful)|successfully\s+schedul/i
                .test(text)
        ) {
            console.log("Confirmation page detected.");
            outcome = "confirmed";
            break;
        }

        if (/no longer available/i.test(text)) {
            console.log("Slot was taken by someone else. It will not be tried again.");
            outcome = "gone";
            skip.add(best.key);
            break;
        }

        const next = await page.$("#submitbtn");

        if (!next || !(await next.boundingBox())) {
            console.log("No further Submit button. Done.");
            break;
        }

        if (attempt === MAX_TRIES) {
            console.log(
                `Gave up after ${MAX_TRIES} tries.`
            );
            outcome = "gaveup";
            break;
        }

        if (/too many requests|try again/i.test(text)) {

            const stillSelected = await page.$(
                "#time_select input[type='radio']:checked"
            );

            if (!stillSelected) {
                console.log("Slot selection lost or slot gone. Stopping.");
                break;
            }

            const wait = 20_000 + Math.random() * 20_000;

            console.log(
                `Site is busy. Retrying Submit in ${Math.round(wait / 1000)}s (try ${attempt}/${MAX_TRIES - 1})...`
            );

            await sleep(wait);

        } else {

            console.log(`Follow-up step ${attempt}: clicking Submit/Confirm...`);
        }

        await Promise.all([
            page.waitForNavigation({
                waitUntil: "domcontentloaded",
                timeout: 30_000
            }).catch(() => {}),
            next.click()
        ]);

        await sleep(2000);

        console.log("Current URL:", page.url());

        const messages = await page.$$eval(
            ".alert, .validation-summary-errors, [role='alert'], .field-validation-error, .text-danger",
            elements =>
                elements
                    .map(element => element.innerText.trim())
                    .filter(Boolean)
                    .slice(0, 3)
        ).catch(() => []);

        console.log("Page messages:", messages.length ? messages : "none");
    }

    return { ...best, outcome };
}

async function isHumanCheckPage(page) {

    if (page.url().includes("__cf_chl")) {
        return true;
    }

    return page.evaluate(() =>
        /verify you are human|just a moment/i
            .test(document.body?.innerText || "")
    ).catch(() => false);
}

async function waitForHumanCheck(page) {

    if (!(await isHumanCheckPage(page))) {
        return;
    }

    console.log(
        "⚠ Cloudflare check detected. Complete it manually in this bot tab; the bot continues afterwards."
    );

    console.log(
        "Page URL:",
        page.url()
    );

    process.stdout.write("\x07\x07");

    const deadline = Date.now() + 10 * 60 * 1000;

    while (Date.now() < deadline) {

        await sleep(2000);

        if (!(await isHumanCheckPage(page))) {
            console.log("Check completed. Continuing...");
            return;
        }
    }

    throw new Error("Timed out waiting for the Cloudflare check.");
}

export async function inspectAvailability(page) {
    console.log("Inspecting appointment calendar...");

    const result = await page.evaluate(() => {
        const visible = element => {
            const style = window.getComputedStyle(element);

            return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                element.offsetParent !== null
            );
        };

        const disabled = element => {
            return (
                element.disabled ||
                element.getAttribute("aria-disabled") === "true" ||
                element.classList.contains("disabled") ||
                element.classList.contains("unavailable")
            );
        };

        const candidates = [];

        // Common date/calendar elements
        const selectors = [
            "button",
            "[role='button']",
            "[data-date]",
            ".calendar-day",
            ".datepicker-day",
            ".ui-datepicker-calendar td",
            ".ui-datepicker-calendar button",
            "td"
        ];

        for (const selector of selectors) {
            for (const element of document.querySelectorAll(selector)) {
                if (!visible(element)) {
                    continue;
                }

                const text =
                    element.innerText?.trim() || "";

                const dataDate =
                    element.getAttribute("data-date") || "";

                if (!text && !dataDate) {
                    continue;
                }

                candidates.push({
                    text,
                    dataDate,
                    disabled: disabled(element),
                    className:
                        typeof element.className === "string"
                            ? element.className
                            : ""
                });
            }
        }

        return {
            url: window.location.href,
            title: document.title,
            candidates: candidates.slice(0, 500),
            bodyText: document.body.innerText.substring(0, 10000)
        };
    });

    /*
     * IMPORTANT:
     *
     * At this stage we deliberately don't assume that every
     * enabled button is an appointment date.
     *
     * We look for strong indications of actual availability.
     */

    const availabilityWords = [
        "available",
        "appointment available",
        "slots available",
        "select date"
    ];

    const bodyLower =
        result.bodyText.toLowerCase();

    const positiveText =
        availabilityWords.some(word =>
            bodyLower.includes(word)
        );

    // Enabled days in the jQuery UI datepicker are <a> links;
    // unavailable days are plain cells without a link.
    const dateCandidates = await page.$$eval(
        "#datepicker td a",
        links =>
            links.map(link => {
                const cell = link.closest("td");
                const month = Number(cell?.getAttribute("data-month"));
                const year = cell?.getAttribute("data-year");
                const day = link.textContent.trim();

                return {
                    text: day,
                    dataDate:
                        year && !Number.isNaN(month)
                            ? `${month + 1}/${day}/${year}`
                            : ""
                };
            })
    );

    return {
        available:
            dateCandidates.length > 0,

        positiveText,

        dateCandidates,

        url: result.url
    };
}

export async function checkPostAvailability(page, post) {
    console.log(
        `Checking availability for: ${post.name}`
    );

    const apiResponse = page.waitForResponse(
        response =>
            response.url().includes("get-family-ofc-schedule-days") &&
            response.request().method() === "POST",
        { timeout: 15_000 }
    ).catch(() => null);

    await page.select(
        "#post_select",
        post.id
    );

    // Continue as soon as the site has answered; fall back to a fixed wait if it never does
    const apiResult = await apiResponse;

    if (apiResult?.status() === 403) {
        throw new Error("Blocked by the site (HTTP 403)");
    }

    await sleep(apiResult ? 1000 : 3000);

    const scheduleDays = await Promise.resolve(apiResult?.text())
        .then(text => JSON.parse(text.trim()).ScheduleDays ?? [])
        .catch(() => []);

    const result =
        await inspectAvailability(page);

    console.log(
        `API ScheduleDays: ${scheduleDays.length} | calendar day links: ${result.dateCandidates.length}`
    );

    if (scheduleDays.length) {
        console.log(
            `API ScheduleDays (${scheduleDays.length}):`,
            JSON.stringify(scheduleDays.slice(0, 3))
        );

        if (!result.dateCandidates.length) {
            result.dateCandidates = scheduleDays.map(entry => ({
                text: JSON.stringify(entry).slice(0, 200),
                dataDate: ""
            }));
        }

        result.available = true;
    }

    console.log(
        `Candidate dates found: ${result.dateCandidates.length}`
    );

    if (result.available) {
        console.log(
            `🎉 POSSIBLE APPOINTMENT AVAILABLE at ${post.name}`
        );
    } else {
        console.log(
            `No confirmed appointment detected at ${post.name}`
        );
    }

    return {
        ...result,
        post
    };
}