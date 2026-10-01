function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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