function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

    await page.select(
        "#post_select",
        post.id
    );

    await sleep(3000);

    const result =
        await inspectAvailability(page);

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