function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function login(page, credentials, options = {}) {
    const { alreadyOnLoginPage = false } = options;

    console.log("\nStarting login process...");

    if (!alreadyOnLoginPage) {
        console.log("Waiting for login page to load...");
        await page.waitForFunction(() => {
            const username = document.querySelector("#signInName");
            const password = document.querySelector("#password");
            return !!username && !!password;
        }, { timeout: 60_000 });
    }

    console.log("Filling in credentials...");

    // Fill username
    await page.locator("#signInName").fill(credentials.username);
    console.log("Username filled.");

    // Fill password
    await page.locator("#password").fill(credentials.password);
    console.log("Password filled.");

    // Click sign in button
    await page.locator("#continue").click();
    console.log("Login form submitted.");

    // waitForFunction survives navigations, unlike page.evaluate
    const hasSecurityQuestions = await page.waitForFunction(
        () => document.querySelectorAll("p[id*='kbq'][aria-label]").length > 0,
        { timeout: 20_000 }
    ).then(() => true, () => false);

    if (hasSecurityQuestions) {
        console.log("Security questions detected.");
        await answerSecurityQuestions(page, credentials);
    } else {
        console.log("No security questions required.");
    }

    console.log("Login process completed.");
}

export async function answerSecurityQuestions(page, credentials) {

    console.log("\nWaiting for security questions...");

    await page.waitForFunction(() => {
        return document.querySelectorAll(
            "p[id*='kbq'][aria-label]"
        ).length > 0;
    }, {
        timeout: 60_000
    });

    await sleep(500);

    const questions = await page.$$eval(
        "p[id*='kbq'][aria-label]",
        elements =>
            elements.map(element => {

                const answerInput =
                    element
                        .closest("li")
                        ?.nextElementSibling
                        ?.querySelector("input");

                return {
                    question:
                        element
                            .getAttribute("aria-label")
                            ?.trim(),

                    answerInputId:
                        answerInput?.id
                };
            })
    );

    const validQuestions = questions.filter(
        item =>
            item.question &&
            item.answerInputId
    );

    console.log(
        `Found ${validQuestions.length} security questions.`
    );

    if (validQuestions.length !== 2) {
        throw new Error(
            `Expected 2 security questions, but found ${validQuestions.length}.`
        );
    }

    for (const item of validQuestions) {

        console.log(
            `\nQuestion: ${item.question}`
        );

        console.log(
            `Answer field: #${item.answerInputId}`
        );

        const credential =
            credentials.securityQuestions.find(
                q =>
                    q.question
                        .trim()
                        .toLowerCase() ===
                    item.question
                        .trim()
                        .toLowerCase()
            );

        if (!credential) {
            throw new Error(
                `No answer configured for: ${item.question}`
            );
        }

        console.log(
            "Answer found in credentials JSON."
        );

        await page.locator(
            `#${item.answerInputId}`
        ).fill(
            credential.answer
        );

        console.log(
            "Answer filled."
        );
    }

    console.log(
        "\nAll security questions answered."
    );

    await page.locator(
        "#continue"
    ).click();

    console.log(
        "Security questions submitted."
    );

    await sleep(1500);
}