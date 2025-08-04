import asyncio
import re
import time
from playwright.async_api import Playwright, async_playwright, expect, TimeoutError


async def wait_for_page_load(page, timeout=30000):
    """Wait for page to be fully loaded with multiple strategies"""
    try:
        # Check if page is still valid
        if page.is_closed():
            print("❌ Page has been closed")
            return False
            
        # Wait for network to be idle (no requests for 500ms)
        await page.wait_for_load_state("networkidle", timeout=timeout)
        print("✅ Network idle state reached")
    except TimeoutError:
        print("⚠️  Network idle timeout, continuing...")
    except Exception as e:
        print(f"⚠️  Network idle error: {e}")
    
    try:
        # Check if page is still valid
        if page.is_closed():
            print("❌ Page has been closed")
            return False
            
        # Wait for DOM content to be loaded
        await page.wait_for_load_state("domcontentloaded", timeout=timeout)
        print("✅ DOM content loaded")
    except TimeoutError:
        print("⚠️  DOM content timeout, continuing...")
    except Exception as e:
        print(f"⚠️  DOM content error: {e}")
    
    # Additional wait for dynamic content
    try:
        if not page.is_closed():
            await page.wait_for_timeout(2000)
            print("⏱️  Additional 2s wait for dynamic content")
    except Exception as e:
        print(f"⚠️  Additional wait error: {e}")
    
    return not page.is_closed()


async def wait_for_element(page, selector, timeout=10000, description=""):
    """Wait for element to be visible and clickable"""
    try:
        await page.wait_for_selector(selector, state="visible", timeout=timeout)
        print(f"✅ Element ready: {description or selector}")
        return True
    except TimeoutError:
        print(f"❌ Element not found: {description or selector}")
        return False


async def safe_click(page, selector, description="", timeout=10000):
    """Safely click an element with proper waiting"""
    try:
        # Wait for element to be visible
        element = await page.wait_for_selector(selector, state="visible", timeout=timeout)
        if element:
            # Wait for element to be stable (not moving)
            await page.wait_for_timeout(500)
            await element.click()
            print(f"✅ Clicked: {description or selector}")
            return True
    except TimeoutError:
        print(f"❌ Failed to click: {description or selector}")
        return False


async def run(playwright: Playwright) -> None:
    browser = await playwright.chromium.launch(headless=False)
    context = await browser.new_context(service_workers="block")
    
    # Route HAR file for tagging.bechtle.com
    await context.route_from_har("/Users/ralphkeser/Documents/scripts/mitmproxy3/bechtle-tagging.har", url="**://tagging.bechtle.com/**")
    
    page = await context.new_page()
    
    # Navigate to main page with proper waiting
    print("🌐 Navigating to www.bechtle.com...")
    await page.goto("https://www.bechtle.com/", wait_until="domcontentloaded")
    await wait_for_page_load(page)
    
    # Wait for and click cookie consent button
    print("🍪 Looking for cookie consent button...")
    cookie_button_selector = '[data-testid="uc-accept-all-button"]'
    if await wait_for_element(page, cookie_button_selector, description="Cookie consent button"):
        await safe_click(page, cookie_button_selector, description="Cookie consent button")
        # Wait a bit for any redirects or page changes
        await page.wait_for_timeout(3000)
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after cookie consent, stopping execution")
            return
    
    # Wait for and click on LG Monitor
    print("🖥️  Looking for LG Monitor...")
    monitor_selector = '[data-testid="default"]:has-text("LG 24BA550-B Monitor")'
    if await wait_for_element(page, monitor_selector, description="LG Monitor"):
        await safe_click(page, monitor_selector, description="LG Monitor")
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after clicking LG Monitor, stopping execution")
            return
    
    # Wait for and click add to cart button
    print("🛒 Looking for add to cart button...")
    cart_button_selector = '[data-testid="area-addtocart"] [data-testid="addtocart_button"]'
    if await wait_for_element(page, cart_button_selector, description="Add to cart button"):
        await safe_click(page, cart_button_selector, description="Add to cart button")
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after clicking add to cart, stopping execution")
            return
    
    # Wait for and click on ARTICONA LED Aluminium
    print("💡 Looking for ARTICONA LED Aluminium...")
    articona_selector = 'a:has-text("ARTICONA LED Aluminium")'
    if await wait_for_element(page, articona_selector, description="ARTICONA LED Aluminium"):
        await safe_click(page, articona_selector, description="ARTICONA LED Aluminium")
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after clicking ARTICONA LED, stopping execution")
            return
    
    # Wait for and click add to cart button again
    print("🛒 Looking for second add to cart button...")
    if await wait_for_element(page, cart_button_selector, description="Second add to cart button"):
        await safe_click(page, cart_button_selector, description="Second add to cart button")
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after clicking second add to cart, stopping execution")
            return
    
    # Wait for and click backdrop to close modal
    print("❌ Looking for backdrop to close modal...")
    backdrop_selector = ".oARhaa-sheet-backdrop"
    if await wait_for_element(page, backdrop_selector, description="Modal backdrop"):
        await safe_click(page, backdrop_selector, description="Modal backdrop")
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after clicking backdrop, stopping execution")
            return
    
    # Wait for and click IT-Lösungen button
    print("💻 Looking for IT-Lösungen button...")
    it_button_selector = 'button:has-text("IT-Lösungen")'
    if await wait_for_element(page, it_button_selector, description="IT-Lösungen button"):
        await safe_click(page, it_button_selector, description="IT-Lösungen button")
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after clicking IT-Lösungen, stopping execution")
            return
    
    # Wait for and click main navigation
    print("🧭 Looking for main navigation...")
    nav_selector = '[data-testid="main-navigation-goto-98c22e49-b6f2-49d8-bf85-ae1f7f83b9ba-overview"]'
    if await wait_for_element(page, nav_selector, description="Main navigation"):
        await safe_click(page, nav_selector, description="Main navigation")
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after clicking main navigation, stopping execution")
            return
    
    # Wait for and click ARTICONA LED Aluminium again
    print("💡 Looking for ARTICONA LED Aluminium again...")
    if await wait_for_element(page, articona_selector, description="ARTICONA LED Aluminium (second time)"):
        await safe_click(page, articona_selector, description="ARTICONA LED Aluminium (second time)")
        if not page.is_closed():
            await wait_for_page_load(page)
        else:
            print("❌ Page was closed after clicking ARTICONA LED (second time), stopping execution")
            return
    
    print("✅ All actions completed successfully!")
    
    # Wait a bit before closing
    await page.wait_for_timeout(3000)
    
    # ---------------------
    await context.close()
    await browser.close()


async def main() -> None:
    async with async_playwright() as playwright:
        await run(playwright)


asyncio.run(main())
