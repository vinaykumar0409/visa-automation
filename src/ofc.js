function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function openSchedule(page) {
    console.log("Opening appointment scheduling...");

    await page.waitForSelector(
        "#continue_application",
        {
            visible: true,
            timeout: 60_000
        }
    );

    await page.click("#continue_application");

    await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 60_000
    }).catch(() => {});

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