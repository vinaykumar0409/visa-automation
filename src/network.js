function isVisaSchedulingUrl(url) {
    return url.includes("usvisascheduling.com");
}

function interestingUrl(url) {
    const lower = url.toLowerCase();

    return (
        lower.includes("schedule") ||
        lower.includes("appointment") ||
        lower.includes("availability") ||
        lower.includes("calendar") ||
        lower.includes("slot") ||
        lower.includes("post") ||
        lower.includes("ofc") ||
        lower.includes("appointmentmanager")
    );
}

export function installNetworkLogger(page) {
    console.log("Installing network logger...");

    page.on("request", request => {
        const url = request.url();

        // Ignore Cloudflare, Azure, USTravelDocs etc.
        if (!isVisaSchedulingUrl(url)) {
            return;
        }

        if (!interestingUrl(url)) {
            return;
        }

        console.log("\n================ REQUEST ================");
        console.log("METHOD:", request.method());
        console.log("URL:", url);

        try {
            const postData = request.postData();

            if (postData) {
                console.log(
                    "POST DATA:",
                    postData.substring(0, 2000)
                );
            }
        } catch {
            // Ignore
        }
    });

    page.on("response", async response => {
        const url = response.url();

        if (!isVisaSchedulingUrl(url)) {
            return;
        }

        if (!interestingUrl(url)) {
            return;
        }

        console.log("\n================ RESPONSE ================");
        console.log("STATUS:", response.status());
        console.log("URL:", url);

        const contentType =
            response.headers()["content-type"] || "";

        if (
            contentType.includes("json") ||
            contentType.includes("text")
        ) {
            try {
                const body = await response.text();

                console.log(
                    "BODY:",
                    body.substring(0, 5000)
                );
            } catch {
                // Some responses cannot be read
            }
        }
    });
}