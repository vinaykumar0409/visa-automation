import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
    headless: false
});

const page = await browser.newPage();

await page.goto('https://example.com');

console.log('Puppeteer is working!');

await new Promise(() => {});