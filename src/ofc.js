function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function openSchedule(page) {
    console.log("Opening appointment scheduling...");

    const button = await page.waitForSelector(
        "#continue_application",
        {
            visible: true,
            timeout: 60_000
        }
    ).catch(() => null);

    if (button) {

        await button.click();

        await page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 60_000
        }).catch(() => {});

    } else if (!page.url().includes("/ofc-schedule")) {

        console.log(
            "Continue button not found. Opening schedule page directly."
        );

        await page.goto(
            "https://www.usvisascheduling.com/en-US/ofc-schedule/",
            { waitUntil: "domcontentloaded" }
        );
    }

    console.log(
        "Current URL:",
        page.url()
    );

    await sleep(3000);
}

export async function getOFCPosts(page) {
    await page.waitForSelector(
        "#post_select",
        {
            visible: true,
            timeout: 60_000
        }
    );

    const posts = await page.$$eval(
        "#post_select option",
        options => {
            return options
                .map(option => ({
                    id: option.value,
                    name: option.textContent.trim()
                }))
                .filter(option => {
                    return (
                        option.id &&
                        option.name &&
                        !option.name.toLowerCase().includes("select")
                    );
                });
        }
    );

    console.log("\nAvailable OFC posts:");

    for (const post of posts) {
        console.log(
            `- ${post.name} (${post.id})`
        );
    }

    return posts;
}

export async function selectOFCPost(page, post) {
    console.log(
        `\nSelecting OFC post: ${post.name}`
    );

    await page.select(
        "#post_select",
        post.id
    );

    await sleep(3000);

    console.log(
        "Selected:",
        post.name
    );
}