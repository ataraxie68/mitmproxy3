/**
 * GA4 + Marketing Pixel Logger - Browser Monitoring Script
 * 
 * This script is injected into web pages to monitor:
 * - DataLayer events and consent changes
 * - Cookie creation, modification, and deletion
 * - Cookie banner detection and CMP vendor identification
 * - GDPR compliance violations
 * 
 * All logs are structured for consumption by start-logging.py
 */

// ===== CONFIGURATION =====
const CONFIG = {
    // Injection guards
    INJECTION_FLAG: 'dataLayerMonitoringInjected',
    SESSION_STORAGE_FLAG: 'dataLayerMonitoringInjected',

    // Monitoring intervals (ms)
    COOKIE_CHECK_INTERVAL: 2000,
    BANNER_VISIBILITY_CHECK_INTERVAL: 2000,

    // Cookie banner detection
    BANNER_DETECTION_DELAYS: [500, 2000, 5000],

    // Logging
    LOG_PREFIXES: {
        SCRIPT_INJECTION: '[SCRIPT_INJECTION]',
        FRAME_CHECK: '[FRAME_CHECK]',
        DATALAYER_MONITOR: '[DATALAYER_MONITOR]',
        DATALAYER_EVENT: '[DATALAYER_EVENT]',
        COOKIE_MONITOR: '[COOKIE_MONITOR]',
        COOKIE_EVENT: '[COOKIE_EVENT]',
        COOKIE_BANNER_DETECTED: '[COOKIE_BANNER_DETECTED]',
        COOKIE_BANNER_BUTTONS: '[COOKIE_BANNER_BUTTONS]',
        COOKIE_BANNER_HIDDEN: '[COOKIE_BANNER_HIDDEN]',
        COOKIE_BANNER_MONITOR: '[COOKIE_BANNER_MONITOR]',
    },

    // CMP Vendor configurations
    CMP_VENDORS: {
        OneTrust: {
            selectors: ['#onetrust-banner-sdk', '.onetrust-banner', '[data-testid*="onetrust"]'],
            patterns: ['onetrust', 'one trust'],
            globalVar: 'OneTrust'
        },
        Cookiebot: {
            selectors: ['#CybotCookiebotDialog', '.CookieConsent', '[data-cookiebot]'],
            patterns: ['cookiebot', 'cookie bot'],
            globalVar: 'Cookiebot'
        },
        Usercentrics: {
            selectors: [
                '#usercentrics-root',
                '#usercentrics-cmp',
                '.uc-banner',
                '[data-testid*="usercentrics"]',
                '#uc-banner',
                '.uc-banner-container',
                '[id*="uc-banner"]',
                '[class*="uc-banner"]',
                '[id*="usercentrics"]',
                '[class*="usercentrics"]',
                '[data-testid*="uc-"]',
                '.uc-cmp',
                '#uc-cmp',
                '[data-testid*="cmp"]',
                '.uc-privacy-banner',
                '#uc-privacy-banner'
            ],
            patterns: ['usercentrics', 'uc-', 'uc_cmp', 'uc_cmp_'],
            globalVar: 'Usercentrics'
        },
        'Borlabs Cookie': {
            selectors: ['#BorlabsCookieBox', '.borlabs-cookie'],
            patterns: ['borlabs'],
            globalVar: 'BorlabsCookie'
        },
        TrustArc: {
            selectors: ['#truste-consent-track', '.truste-banner'],
            patterns: ['trustarc', 'trust arc'],
            globalVar: 'TrustArc'
        },
        'Quantcast Choice': {
            selectors: ['.qc-cmp-ui', '#qc-cmp2-ui'],
            patterns: ['quantcast'],
            globalVar: 'QuantcastChoice'
        },
        'CMP Box': {
            selectors: ['#cmpbox'],
            patterns: ['cmpbox'],
            globalVar: null
        },
        Iubenda: {
            selectors: ['#iubenda-cs-banner', '.iubenda-cs'],
            patterns: ['iubenda'],
            globalVar: 'Iubenda'
        },
        CookieScript: {
            selectors: [
                '#cookiescript_injected', '.cookiescript', '[data-cookiescript]',
                '#cookie-script', '.cookie-script', '#cs-banner', '.cs-modal',
                '#cookiescript_banner', '.cookiescript-banner'
            ],
            patterns: ['cookiescript', 'cookie-script', 'cookie_script'],
            globalVar: 'CookieScript'
        },
        Didomi: {
            selectors: ['#didomi-notice', '.didomi-banner'],
            patterns: ['didomi'],
            globalVar: 'Didomi'
        },
        'Cookie Control': {
            selectors: ['.cc-window', '#cookieConsent'],
            patterns: ['cookiecontrol'],
            globalVar: null
        }
    },

    // Generic banner patterns
    GENERIC_PATTERNS: {
        'Generic Cookie Banner': ['[id*="cookie" i]', '[class*="cookie" i]'],
        'Generic Consent Banner': ['[id*="consent" i]', '[class*="consent" i]'],
        'Generic Privacy Banner': ['[id*="privacy" i]', '[class*="privacy" i]'],
        'Generic GDPR Banner': ['[id*="gdpr" i]', '[class*="gdpr" i]']
    },

    // Banner detection selectors (priority order)
    BANNER_SELECTORS: [
        // Major CMP providers (high priority)
        '#usercentrics-root', '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#usercentrics-cmp', '#uc-banner', '.uc-banner', '#BorlabsCookieBox',
        '#truste-consent-track', '.qc-cmp-ui', '#cmpbox', '#iubenda-cs-banner', '#cookiescript_injected',
        '#didomi-notice', '.cc-window', '#cookieConsent',

        // Generic patterns (medium priority)
        '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
        '[id*="privacy" i]', '[class*="privacy" i]', '[id*="gdpr" i]', '[class*="gdpr" i]',
        '[role="dialog"][aria-label*="cookie" i]'
    ],

    // Cookie text patterns for detection
    COOKIE_TEXT_PATTERN: /(cookies?|privacy|consent|gdpr|accept.*cookie|we use cookie|personalized ads|manage.*cookie)/i,

    // Utility settings
    TRUNCATE_LENGTH: 50,
    BANNER_MIN_WIDTH: 200,
    BANNER_MIN_HEIGHT: 50,
    BANNER_MIN_TEXT_LENGTH: 10,
    BANNER_MAX_TEXT_LENGTH: 2000
};

// ===== UTILITY FUNCTIONS =====

/**
 * Structured logging utility
 * @param {string} prefix - Log prefix from CONFIG.LOG_PREFIXES
 * @param {any} data - Data to log
 */
function log(prefix, data) {
    if (typeof data === 'object') {
        console.log(prefix, JSON.stringify(data));
    } else {
        console.log(prefix, data);
    }
}

/**
 * Parse cookie string into object
 * @param {string} cookieStr - Cookie string from document.cookie
 * @returns {Object} Parsed cookies object
 */
function parseCookieString(cookieStr) {
    const cookies = {};
    if (!cookieStr) return cookies;

    cookieStr.split(';').forEach(cookie => {
        const [name, ...rest] = cookie.trim().split('=');
        if (name) {
            cookies[name] = rest.join('=') || '';
        }
    });
    return cookies;
}

/**
 * Get current cookie snapshot
 * @returns {Object} Current cookies object
 */
function getCookieSnapshot() {
    return parseCookieString(document.cookie);
}

/**
 * Truncate value to specified length
 * @param {string} value - Value to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated value
 */
function truncateValue(value, maxLength = CONFIG.TRUNCATE_LENGTH) {
    return value && value.length > maxLength ? value.substring(0, maxLength) + '...' : value;
}

/**
 * Check if element is truly visible
 * @param {Element} element - Element to check
 * @returns {boolean} True if element is visible
 */
function isElementTrulyVisible(element) {
    if (!element) return false;

    // Check basic dimensions
    if (element.offsetWidth === 0 || element.offsetHeight === 0) return false;

    // Check computed styles
    const styles = getComputedStyle(element);
    if (styles.display === 'none' || styles.visibility === 'hidden' || styles.opacity === '0') {
        return false;
    }

    // Check if element is in viewport
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    // Element must have visible area in viewport
    if (rect.bottom < 0 || rect.top > windowHeight || rect.right < 0 || rect.left > windowWidth) {
        return false;
    }

    // Element must have actual visible dimensions in viewport
    if (rect.width === 0 || rect.height === 0) return false;

    // Check for negative z-index that might hide it
    if (parseInt(styles.zIndex) < 0) return false;

    return true;
}

/**
 * Validate banner element
 * @param {Element} element - Element to validate
 * @returns {boolean} True if element is a valid banner
 */
function isValidBannerElement(element) {
    if (!element || element.offsetWidth === 0 || element.offsetHeight === 0) return false;

    const rect = element.getBoundingClientRect();
    const text = element.textContent || '';

    // Standard validation for other banners
    const styles = getComputedStyle(element);

    // Size validation
    if (rect.width < CONFIG.BANNER_MIN_WIDTH || rect.height < CONFIG.BANNER_MIN_HEIGHT) return false;

    // Text length validation (avoid main content)
    if (text.length < CONFIG.BANNER_MIN_TEXT_LENGTH || text.length > CONFIG.BANNER_MAX_TEXT_LENGTH) return false;

    // Position validation (banners are typically positioned)
    const isPositioned = styles.position === 'fixed' || styles.position === 'absolute' ||
        rect.top < 100 || rect.bottom > window.innerHeight - 100;

    return isPositioned;
}

// ===== INJECTION GUARD =====

/**
 * Check and set injection guards to prevent duplicate script injection
 * @returns {boolean} True if injection should proceed
 */
function checkInjectionGuard() {
    // Check frame context
    const isMainFrame = window.self === window.top;
    const alreadyInjected = !!window[CONFIG.INJECTION_FLAG];
    const hasDataLayer = !!window.dataLayer;

    log(CONFIG.LOG_PREFIXES.FRAME_CHECK, 'Is main frame: ' + isMainFrame);
    log(CONFIG.LOG_PREFIXES.FRAME_CHECK, 'Already injected: ' + alreadyInjected);
    log(CONFIG.LOG_PREFIXES.FRAME_CHECK, 'Has dataLayer: ' + hasDataLayer);

    // Enhanced guard conditions
    if (!isMainFrame) {
        log(CONFIG.LOG_PREFIXES.FRAME_CHECK, 'Skipping injection - not main frame (iframe detected)');
        return false;
    }

    if (alreadyInjected) {
        log(CONFIG.LOG_PREFIXES.FRAME_CHECK, 'Skipping injection - already injected (window guard active)');
        return false;
    }

    // Set injection flag immediately to prevent race conditions
    window[CONFIG.INJECTION_FLAG] = true;

    // Additional check for session storage guard (only for cross-page navigation)
    try {
        if (sessionStorage.getItem(CONFIG.SESSION_STORAGE_FLAG)) {
            log(CONFIG.LOG_PREFIXES.FRAME_CHECK, 'Session storage guard active - skipping injection');
            return false;
        }
        sessionStorage.setItem(CONFIG.SESSION_STORAGE_FLAG, 'true');
        log(CONFIG.LOG_PREFIXES.SCRIPT_INJECTION, 'Session storage guard set');
    } catch (e) {
        log(CONFIG.LOG_PREFIXES.FRAME_CHECK, 'Session storage not available, using window guard only');
    }

    log(CONFIG.LOG_PREFIXES.SCRIPT_INJECTION, 'Injection guard set, proceeding with initialization');
    return true;
}

// ===== DATALAYER MONITORING =====

/**
 * DataLayer monitoring module
 */
const DataLayerMonitor = {
    consentGranted: { marketing: false, analytics: false, storage: false },

    /**
     * Initialize DataLayer monitoring
     */
    init() {
        const injectionTimestamp = new Date().toISOString();
        log(CONFIG.LOG_PREFIXES.DATALAYER_MONITOR, 'DataLayer monitoring script loaded at ' + injectionTimestamp);

        window.dataLayer = window.dataLayer || [];

        // Check if DataLayer push is already overridden
        const currentPush = window.dataLayer.push;
        if (currentPush.toString().includes('DATALAYER_MONITOR')) {
            log(CONFIG.LOG_PREFIXES.DATALAYER_MONITOR, 'DataLayer push already overridden - skipping re-initialization');
            return;
        }

        // Mark that monitoring functions are being set up
        window.dataLayerMonitoringFunctions = true;

        // Debug: Log initial dataLayer state
        log(CONFIG.LOG_PREFIXES.DATALAYER_MONITOR, 'Initial dataLayer length: ' + window.dataLayer.length);

        this.overrideDataLayerPush(currentPush);
    },

    /**
     * Override DataLayer push method
     * @param {Function} originalPush - Original push method
     */
    overrideDataLayerPush(originalPush) {
        window.dataLayer.push = (...args) => {
            args.forEach((data, index) => {
                if (typeof data === 'object' && data !== null) {
                    // Log DataLayer events
                    log(CONFIG.LOG_PREFIXES.DATALAYER_EVENT, {
                        timestamp: new Date().toLocaleTimeString(),
                        event: data.event || 'unknown',
                        data: data
                    });

                }
            });

            const result = originalPush.apply(window.dataLayer, args);

            return result;
        };
    },


};

// ===== COOKIE MONITORING =====

/**
 * Cookie monitoring module
 */
const CookieMonitor = {
    lastCookieSnapshot: {},
    observerActive: true,

    /**
     * Initialize cookie monitoring
     */
    init() {
        log(CONFIG.LOG_PREFIXES.COOKIE_MONITOR, 'Cookie monitoring script loaded');
        this.lastCookieSnapshot = getCookieSnapshot();
        this.setupCookieObserver();
    },

    /**
     * Setup cookie change detection
     */
    setupCookieObserver() {
        // Method 1: Override document.cookie setter
        try {
            let originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

            if (originalCookieDescriptor && originalCookieDescriptor.configurable) {
                Object.defineProperty(document, 'cookie', {
                    get: originalCookieDescriptor.get,
                    set: function (value) {
                        // Call the original setter first
                        originalCookieDescriptor.set.call(document, value);

                        // Trigger change detection
                        setTimeout(() => CookieMonitor.detectCookieChanges(), 5);
                    },
                    configurable: true
                });
                log(CONFIG.LOG_PREFIXES.COOKIE_MONITOR, 'Cookie setter override successful');
            }
        } catch (error) {
            console.error(CONFIG.LOG_PREFIXES.COOKIE_MONITOR + ' Cookie setter override failed:', error);
        }

        // Method 2: Periodic monitoring (backup)
        setInterval(() => this.detectCookieChanges(), CONFIG.COOKIE_CHECK_INTERVAL);

        // Method 3: DOM mutation observer
        if (window.MutationObserver) {
            const observer = new MutationObserver((mutations) => {
                let shouldCheck = false;
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeName === 'SCRIPT') {
                                shouldCheck = true;
                            }
                        });
                    }
                });
                if (shouldCheck) {
                    setTimeout(() => this.detectCookieChanges(), 100);
                }
            });

            observer.observe(document, {
                childList: true,
                subtree: true
            });
        }
    },

    /**
     * Detect cookie changes and log them
     */
    detectCookieChanges() {
        if (!this.observerActive) return;

        try {
            const currentCookies = getCookieSnapshot();
            const previousCookies = this.lastCookieSnapshot;

            // Detect new or modified cookies
            for (const [name, value] of Object.entries(currentCookies)) {
                if (!(name in previousCookies)) {
                    this.addCookieEvent('created', name, value, null);
                } else if (previousCookies[name] !== value) {
                    this.addCookieEvent('modified', name, value, previousCookies[name]);
                }
            }

            // Detect deleted cookies
            for (const [name, value] of Object.entries(previousCookies)) {
                if (!(name in currentCookies)) {
                    this.addCookieEvent('deleted', name, null, value);
                }
            }

            this.lastCookieSnapshot = currentCookies;
        } catch (error) {
            console.error('Cookie detection error:', error);
        }
    },

    /**
     * Add cookie event log
     * @param {string} action - Cookie action (created, modified, deleted)
     * @param {string} name - Cookie name
     * @param {string} newValue - New cookie value
     * @param {string} oldValue - Old cookie value
     */
    addCookieEvent(action, name, newValue, oldValue) {
        const timestamp = new Date().toLocaleTimeString();
        const domain = window.location.hostname;
        const isBannerVisible = CookieBannerMonitor.isBannerVisible();

        // Log all cookie events with enhanced metadata
        log(CONFIG.LOG_PREFIXES.COOKIE_EVENT, {
            timestamp: timestamp,
            action: action,
            cookie_name: name,
            new_value: newValue,
            old_value: oldValue,
            domain: domain,
            path: window.location.pathname,
            host: window.location.hostname,
            cookie_type: 'client_side',
            url: window.location.href,
            banner_visible: isBannerVisible,
            // Enhanced metadata
            cookie_metadata: {
                name: name,
                value: truncateValue(newValue),
                domain: domain,
                path: window.location.pathname,
                host: window.location.hostname,
                accessible: true,
                source: 'client_side',
                type: 'client_side',
                http_only: false, // Client-side cookies are always accessible
                secure: window.location.protocol === 'https:',
                same_site: 'None', // Default for client-side
                expires: null, // Not available for client-side
                max_age: null, // Not available for client-side
                user_agent: navigator.userAgent,
                referrer: document.referrer,
                page_title: document.title,
                consent_status: {
                    banner_visible: isBannerVisible,
                    consent_checked: true
                }
            }
        });
    },

};

// ===== COOKIE BANNER MONITORING =====

/**
 * Cookie banner monitoring module
 */
const CookieBannerMonitor = {
    bannerDetected: false,
    bannerCurrentlyVisible: false,
    bannerElement: null,
    bannerObserver: null,

    /**
     * Initialize cookie banner monitoring
     */
    init() {
        // Initial detection with staggered delays
        CONFIG.BANNER_DETECTION_DELAYS.forEach(delay => {
            setTimeout(() => this.detectCookieBanner(), delay);
        });

        // Periodic visibility check for detected banners
        setInterval(() => {
            if (this.bannerDetected && this.bannerCurrentlyVisible) {
                this.isBannerStillVisible();
            }
        }, CONFIG.BANNER_VISIBILITY_CHECK_INTERVAL);

        // Setup mutation observer for dynamically added banners
        this.setupBannerObserver();
    },

    /**
     * Setup mutation observer for banner detection
     */
    setupBannerObserver() {
        if (window.MutationObserver) {
            this.bannerObserver = new MutationObserver((mutations) => {
                let shouldCheck = false;
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                shouldCheck = true;
                            }
                        });
                    }
                    // Also check for removed nodes (banner might be hidden)
                    if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
                        mutation.removedNodes.forEach((node) => {
                            if (node === this.bannerElement) {
                                this.bannerCurrentlyVisible = false;
                                log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_HIDDEN, {
                                    timestamp: new Date().toISOString(),
                                    url: window.location.href,
                                    reason: 'element_removed_from_dom'
                                });
                            }
                        });
                    }
                });
                if (shouldCheck && !this.bannerDetected) {
                    setTimeout(() => this.detectCookieBanner(), 100);
                }
            });

            this.bannerObserver.observe(document, {
                childList: true,
                subtree: true
            });

            log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_MONITOR, 'Cookie banner observer initialized.');
        }
    },

    /**
     * Detect cookie banner on the page
     */
    detectCookieBanner() {
        if (this.bannerDetected) return;

        let foundBanner = null;
        let detectionMethod = '';

        // Method 1: Check for elements with cookie-related selectors
        for (const selector of CONFIG.BANNER_SELECTORS) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    if (isValidBannerElement(element)) {
                        foundBanner = element;
                        detectionMethod = `selector: ${selector}`;
                        break;
                    }
                }
                if (foundBanner) break;
            } catch (e) {
                // Skip invalid selectors silently
            }
        }



        // Method 2: Text-based detection (fallback)
        if (!foundBanner) {
            const potentialElements = document.querySelectorAll('div, section, aside, header, footer, nav, main');
            for (const element of potentialElements) {
                if (isValidBannerElement(element) && CONFIG.COOKIE_TEXT_PATTERN.test(element.textContent || '')) {
                    foundBanner = element;
                    detectionMethod = 'text pattern';
                    break;
                }
            }
        }

        if (foundBanner && isElementTrulyVisible(foundBanner)) {
            this.registerBannerDetection(foundBanner, detectionMethod);
        }
    },

    /**
     * Register banner detection
     * @param {Element} banner - Detected banner element
     * @param {string} method - Detection method used
     */
    registerBannerDetection(banner, method) {
        this.bannerDetected = true;
        this.bannerElement = banner;
        this.bannerCurrentlyVisible = true;

        // Detect CMP vendor
        const cmpVendor = this.detectCMPVendor(banner, method);

        const bannerInfo = {
            tag: banner.tagName.toLowerCase(),
            id: banner.id || '',
            classes: Array.from(banner.classList).join(' '),
            text_preview: (banner.textContent || '').substring(0, 200),
            position: getComputedStyle(banner).position,
            z_index: getComputedStyle(banner).zIndex,
            detection_method: method,
            cmp_vendor: cmpVendor,
            bounding_rect: {
                top: banner.getBoundingClientRect().top,
                left: banner.getBoundingClientRect().left,
                width: banner.getBoundingClientRect().width,
                height: banner.getBoundingClientRect().height
            },
            visible: true,
            url: window.location.href,
            timestamp: new Date().toISOString()
        };

        log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_DETECTED, bannerInfo);

        // Log banner buttons and perform cookie analysis
        this.logBannerButtons(banner, cmpVendor);
 
    },

    /**
     * Detect CMP vendor
     * @param {Element} banner - Banner element
     * @param {string} method - Detection method
     * @returns {string} CMP vendor name
     */
    detectCMPVendor(banner, method) {
        // Method 1: Check specific vendor selectors
        const vendorBySelector = this.checkVendorSelectors(banner);
        if (vendorBySelector) {
            log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_MONITOR, `CMP detected by selector: ${vendorBySelector}`);
            return vendorBySelector;
        }

        // Method 2: Check banner attributes and text
        const vendorByAttributes = this.checkVendorAttributes(banner);
        if (vendorByAttributes) {
            log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_MONITOR, `CMP detected by attributes: ${vendorByAttributes}`);
            return vendorByAttributes;
        }

        // Method 3: Check global variables
        const vendorByGlobal = this.checkGlobalVariables();
        if (vendorByGlobal) {
            log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_MONITOR, `CMP detected by global variable: ${vendorByGlobal}`);
            return vendorByGlobal;
        }

        // Method 4: Check generic patterns
        const vendorByGeneric = this.checkGenericPatterns(banner);
        if (vendorByGeneric) {
            log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_MONITOR, `CMP detected by generic pattern: ${vendorByGeneric}`);
            return vendorByGeneric;
        }

        // Debug: Log banner details for unknown CMPs
        log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_MONITOR, `Unknown CMP - Banner details: id="${banner.id}", classes="${banner.className}", text="${(banner.textContent || '').substring(0, 100)}..."`);

        return 'Unknown CMP';
    },

    /**
     * Check vendor-specific selectors
     * @param {Element} banner - Banner element
     * @returns {string|null} Vendor name or null
     */
    checkVendorSelectors(banner) {
        for (const [vendor, config] of Object.entries(CONFIG.CMP_VENDORS)) {
            for (const selector of config.selectors) {
                try {
                    if (banner.matches(selector) || banner.querySelector(selector)) {
                        return vendor;
                    }
                } catch (e) {
                    // Skip invalid selectors
                }
            }
        }
        return null;
    },

    /**
     * Check banner attributes and text content
     * @param {Element} banner - Banner element
     * @returns {string|null} Vendor name or null
     */
    checkVendorAttributes(banner) {
        const bannerClasses = Array.from(banner.classList);
        const bannerId = banner.id || '';
        const bannerText = (banner.textContent || '').toLowerCase();

        for (const [vendor, config] of Object.entries(CONFIG.CMP_VENDORS)) {
            // Check classes and ID
            const hasClassOrId = bannerClasses.some(cls =>
                config.patterns.some(pattern => cls.includes(pattern))
            ) || config.patterns.some(pattern => bannerId.includes(pattern));

            if (hasClassOrId) return vendor;

            // Check text content
            const hasText = config.patterns.some(pattern => bannerText.includes(pattern));
            if (hasText) return vendor;
        }

        return null;
    },

    /**
     * Check global variables
     * @returns {string|null} Vendor name or null
     */
    checkGlobalVariables() {
        for (const [vendor, config] of Object.entries(CONFIG.CMP_VENDORS)) {
            if (config.globalVar && window[config.globalVar]) {
                return vendor;
            }
        }

        // Additional Usercentrics global variables
        if (window.Usercentrics || window.UC_UI || window.uc_cmp || window.UC_CMP) {
            return 'Usercentrics';
        }

        return null;
    },

    /**
     * Check generic patterns
     * @param {Element} banner - Banner element
     * @returns {string|null} Vendor name or null
     */
    checkGenericPatterns(banner) {
        for (const [vendor, selectors] of Object.entries(CONFIG.GENERIC_PATTERNS)) {
            for (const selector of selectors) {
                try {
                    if (banner.matches(selector) || banner.querySelector(selector)) {
                        return vendor;
                    }
                } catch (e) {
                    // Skip invalid selectors
                }
            }
        }
        return null;
    },

    /**
     * Log banner buttons
     * @param {Element} banner - Banner element
     * @param {string} cmpVendor - CMP vendor name
     */
    logBannerButtons(banner, cmpVendor) {
        const buttons = banner.querySelectorAll('button, a, [role="button"]');
        if (buttons.length > 0) {
            const buttonInfo = Array.from(buttons).map(btn => ({
                tag: btn.tagName.toLowerCase(),
                text: (btn.textContent || '').trim(),
                id: btn.id || '',
                classes: Array.from(btn.classList).join(' '),
                onclick: btn.onclick ? 'has_onclick' : 'no_onclick'
            }));

            log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_BUTTONS, {
                url: window.location.href,
                timestamp: new Date().toISOString(),
                cmp_vendor: cmpVendor,
                buttons: buttonInfo
            });
        }
    },

   
    /**
     * Check if banner is still visible
     * @returns {boolean} True if banner is visible
     */
    isBannerStillVisible() {
        if (!this.bannerElement) return false;

        try {
            // Check if element is still in DOM
            if (!document.contains(this.bannerElement)) {
                this.bannerCurrentlyVisible = false;
                return false;
            }

            // Use enhanced visibility check
            const isVisible = isElementTrulyVisible(this.bannerElement);

            if (!isVisible && this.bannerCurrentlyVisible) {
                this.bannerCurrentlyVisible = false;
                log(CONFIG.LOG_PREFIXES.COOKIE_BANNER_HIDDEN, {
                    timestamp: new Date().toISOString(),
                    url: window.location.href,
                    reason: 'element_not_truly_visible'
                });
            }

            return isVisible;
        } catch (e) {
            this.bannerCurrentlyVisible = false;
            return false;
        }
    },

    /**
     * Get banner visibility status
     * @returns {boolean} True if banner is currently visible
     */
    isBannerVisible() {
        return this.bannerCurrentlyVisible;
    }
};

// ===== MAIN INITIALIZATION =====

/**
 * Main initialization function
 */
function initializeMonitoring() {
    // Store injection timestamp for debugging
    const injectionTimestamp = new Date().toISOString();
    log(CONFIG.LOG_PREFIXES.SCRIPT_INJECTION, 'Initialization timestamp: ' + injectionTimestamp);

    // Initialize all monitoring modules
    DataLayerMonitor.init();
    CookieMonitor.init();
    CookieBannerMonitor.init();

    log(CONFIG.LOG_PREFIXES.DATALAYER_MONITOR, 'DataLayer monitoring injected.');
}

// ===== ENTRY POINT =====

// Check injection guard first
if (checkInjectionGuard()) {
    // Initialize monitoring if injection should proceed
    initializeMonitoring();
}