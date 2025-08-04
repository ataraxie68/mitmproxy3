from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=False)
    ctx = browser.new_context(
        record_har_path="bechtle-tagging.har",
        record_har_url_filter="https://tagging.bechtle.com/**"
    )
    page = ctx.new_page()
    page.goto("https://www.bechtle.com")
    # ... perhaps wait for analytics call ...
    ctx.close()
    browser.close()