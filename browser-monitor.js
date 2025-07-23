// Enhanced injection guard with better logging
console.log('[SCRIPT_INJECTION]', 'JavaScript injection attempt at', new Date().toISOString());

// Check frame context
const isMainFrame = window.self === window.top;
const alreadyInjected = !!window.dataLayerMonitoringInjected;
const hasDataLayer = !!window.dataLayer;

console.log('[FRAME_CHECK]', 'Is main frame:', isMainFrame);
console.log('[FRAME_CHECK]', 'Already injected:', alreadyInjected);
console.log('[FRAME_CHECK]', 'Has dataLayer:', hasDataLayer);

// Enhanced guard conditions
if (!isMainFrame) {
    console.log('[FRAME_CHECK]', 'Skipping injection - not main frame (iframe detected)');
    return;
}

if (alreadyInjected) {
    console.log('[FRAME_CHECK]', 'Skipping injection - already injected (window guard active)');
    return;
}

// Additional check for session storage guard (only for cross-page navigation)
try {
    if (sessionStorage.getItem('dataLayerMonitoringInjected') && window.dataLayerMonitoringInjected) {
        console.log('[FRAME_CHECK]', 'Skipping injection - both session storage and window guard active');
        return;
    }
} catch (e) {
    // Session storage not available, continue with window guard only
}

// Set injection flag immediately to prevent race conditions
window.dataLayerMonitoringInjected = true;

// Also use sessionStorage as a more persistent guard across page navigations
try {
    if (sessionStorage.getItem('dataLayerMonitoringInjected')) {
        console.log('[FRAME_CHECK]', 'Session storage guard active - skipping injection');
        return;
    }
    sessionStorage.setItem('dataLayerMonitoringInjected', 'true');
    console.log('[SCRIPT_INJECTION]', 'Session storage guard set');
} catch (e) {
    console.log('[FRAME_CHECK]', 'Session storage not available, using window guard only');
}

console.log('[SCRIPT_INJECTION]', 'Injection guard set, proceeding with initialization');

// Store injection timestamp for debugging
const injectionTimestamp = new Date().toISOString();
console.log('[SCRIPT_INJECTION]', 'Initialization timestamp:', injectionTimestamp);

// Unified DataLayer monitoring with consent tracking
console.log('[DATALAYER_MONITOR]', 'DataLayer monitoring script loaded at', injectionTimestamp);

window.dataLayer = window.dataLayer || [];
let consentGranted = {marketing: false, analytics: false, storage: false};

// Check if DataLayer push is already overridden
const currentPush = window.dataLayer.push;
if (currentPush.toString().includes('DATALAYER_MONITOR')) {
    console.log('[DATALAYER_MONITOR]', 'DataLayer push already overridden - skipping re-initialization');
    return;
}

// Mark that monitoring functions are being set up (after the check)
window.dataLayerMonitoringFunctions = true;

// Debug: Log initial dataLayer state
console.log('[DATALAYER_MONITOR]', 'Initial dataLayer length:', window.dataLayer.length);

const originalPush = currentPush;
window.dataLayer.push = function(...args) {
    console.log('[DATALAYER_MONITOR]', 'DataLayer push called with', args.length, 'arguments');
    
    args.forEach((data, index) => {
        console.log('[DATALAYER_MONITOR]', 'Processing argument', index, ':', typeof data);
        
        if (typeof data === 'object' && data !== null) {
            // Log DataLayer events
            console.log('[DATALAYER_EVENT]', JSON.stringify({
                timestamp: new Date().toLocaleTimeString(),
                event: data.event || 'unknown',
                data: data
            }));
            
            // Track consent changes
            if (data.ad_storage === 'granted') {
                consentGranted.storage = true;
                console.log('[DATALAYER_MONITOR]', 'Consent granted: ad_storage');
            }
            if (data.analytics_storage === 'granted') {
                consentGranted.analytics = true;
                console.log('[DATALAYER_MONITOR]', 'Consent granted: analytics_storage');
            }
            if (data.marketing === 'granted' || data.advertising === 'granted') {
                consentGranted.marketing = true;
                console.log('[DATALAYER_MONITOR]', 'Consent granted: marketing/advertising');
            }
        }
    });
    
    const result = originalPush.apply(window.dataLayer, args);
    console.log('[DATALAYER_MONITOR]', 'DataLayer push completed, new length:', window.dataLayer.length);
    return result;
};

// ===== COOKIE MONITORING SYSTEM =====
console.log('[COOKIE_MONITOR]', 'Cookie monitoring script loaded');

// Global state
let lastCookieSnapshot = {};
let cookieObserverActive = true;
let cookieBannerDetected = false;
let cookieBannerCurrentlyVisible = false;
let cookieBannerObserver = null;
let cookieBannerElement = null;

// ===== COOKIE UTILITY FUNCTIONS =====

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

function getCookieSnapshot() {
    return parseCookieString(document.cookie);
}

function truncateValue(value, maxLength = 50) {
    return value && value.length > maxLength ? value.substring(0, maxLength) + '...' : value;
}

function isMarketingCookie(name, value) {
    name = name.toLowerCase();
    value = (value || '').toLowerCase();
    
    // Consolidated regex for marketing cookies
    return /^(_ga|_gid|_gat|_gcl|_gac|__utm|_fb|fbp|fbc|_tt|_pin|_li|_hj|_clc|amplitude|mp_|ajs_|_mkto|__hs|_vwo|optly|gtm|adnxs|anj|criteo|cto|obuid|t_gid|ads|doubleclick|gads|facebook|tiktok|pinterest|linkedin|twitter|personalization_id|clarity|mixpanel|segment|pardot|visitor_id|marketo|hubspot|salesforce|sfdc|uuid2|outbrain|taboola|vwo|optimizely)/.test(name) ||
           /(track|analytic|marketing|ads|pixel|beacon|conversion|affiliate|partner|retarget|audience|segment|cohort|campaign|advertisement)/.test(name + value);
}

function checkMarketingConsent() {
    // Check tracked consent or scan current state
    if (consentGranted.marketing || consentGranted.analytics || consentGranted.storage) return true;
    
    // Quick DataLayer check for Google Consent Mode
    if (window.dataLayer?.length) {
        for (let i = window.dataLayer.length - 1; i >= 0; i--) {
            const item = window.dataLayer[i];
            if (item?.ad_storage === 'granted' || item?.ad_user_data === 'granted' || 
                item?.analytics_storage === 'granted') return true;
        }
    }
    
    // Quick cookie scan for common consent indicators
    const cookies = getCookieSnapshot();
    return Object.values(cookies).some(v => 
        v && (v.includes('granted') || v.includes('"marketing":true') || 
              v.includes('"advertising":true') || v.includes('ads=granted'))
    );
}

function getAllCookiesWithClassification() {
    const allCookies = document.cookie.split(';').map(cookie => {
        const [name, value] = cookie.trim().split('=').map(s => s.trim());
        if (name) {
            return {
                name: name,
                value: truncateValue(value),
                is_marketing: isMarketingCookie(name, value)
            };
        }
        return null;
    }).filter(c => c !== null);
    
    return {
        all_cookies: allCookies,
        marketing_cookies: allCookies.filter(c => c.is_marketing),
        non_marketing_cookies: allCookies.filter(c => !c.is_marketing),
        total_cookies: allCookies.length,
        marketing_cookies_count: allCookies.filter(c => c.is_marketing).length,
        non_marketing_cookies_count: allCookies.filter(c => !c.is_marketing).length
    };
}

function createGDPRAuditLog(auditType, context = {}) {
    const cookieInventory = getAllCookiesWithClassification();
    const marketingCookies = cookieInventory.marketing_cookies;
    
    return {
        timestamp: new Date().toISOString(),
        audit_type: auditType,
        domain: window.location.hostname,
        url: window.location.href,
        ...context,
        complete_cookie_inventory: cookieInventory,
        gdpr_compliance_analysis: {
            risk_level: marketingCookies.length > 0 ? 'MEDIUM' : 'LOW',
            violation_type: marketingCookies.length > 0 ? 'marketing_cookies_before_consent' : 'no_violation',
            recommendation: marketingCookies.length > 0 ? 
                'Marketing cookies detected before consent - review cookie loading order' : 
                'No marketing cookies detected - good practice',
            affected_cookies: marketingCookies.map(c => c.name)
        }
    };
}

// ===== COOKIE CHANGE DETECTION =====

function detectCookieChanges() {
    if (!cookieObserverActive) return;
    
    try {
        const currentCookies = getCookieSnapshot();
        const previousCookies = lastCookieSnapshot;
        
        // Detect new or modified cookies
        for (const [name, value] of Object.entries(currentCookies)) {
            if (!(name in previousCookies)) {
                addCookieEvent('created', name, value, null);
            } else if (previousCookies[name] !== value) {
                addCookieEvent('modified', name, value, previousCookies[name]);
            }
        }
        
        // Detect deleted cookies
        for (const [name, value] of Object.entries(previousCookies)) {
            if (!(name in currentCookies)) {
                addCookieEvent('deleted', name, null, value);
            }
        }
        
        lastCookieSnapshot = currentCookies;
    } catch (error) {
        console.error('Cookie detection error:', error);
    }
}

function addCookieEvent(action, name, newValue, oldValue) {
    const timestamp = new Date().toLocaleTimeString();
    const domain = window.location.hostname;
    const isBannerVisible = isBannerStillVisible();
    const isMarketing = isMarketingCookie(name, newValue);
    const hasMarketingConsent = checkMarketingConsent();
    
    // Check for GDPR violation
    if ((action === 'created' || action === 'modified') && isBannerVisible && isMarketing && !hasMarketingConsent) {
        const cookieInventory = getAllCookiesWithClassification();
        const allMarketingCookies = cookieInventory.marketing_cookies.map(c => ({
            ...c,
            is_violating_cookie: c.name === name
        }));
        
        // Log violation
        console.log('[MARKETING_COOKIE_VIOLATION]', JSON.stringify({
            timestamp: new Date().toISOString(),
            violation_type: 'marketing_cookie_while_banner_visible',
            violating_cookie_name: name,
            violating_cookie_value: truncateValue(newValue),
            action: action,
            domain: domain,
            url: window.location.href,
            banner_visible: isBannerVisible,
            marketing_consent: hasMarketingConsent,
            severity: 'HIGH',
            compliance_risk: 'GDPR_VIOLATION_RISK',
            message: `Marketing cookie '${name}' was ${action} while cookie banner is visible and no marketing consent granted - potential GDPR violation`,
            all_marketing_cookies: allMarketingCookies,
            all_other_cookies: cookieInventory.non_marketing_cookies,
            total_marketing_cookies: allMarketingCookies.length,
            total_other_cookies: cookieInventory.non_marketing_cookies.length,
            complete_cookie_audit: {
                all_cookies: [...allMarketingCookies, ...cookieInventory.non_marketing_cookies],
                total_cookies: cookieInventory.total_cookies,
                marketing_cookies_count: allMarketingCookies.length,
                non_marketing_cookies_count: cookieInventory.non_marketing_cookies.length,
                violation_context: `Marketing cookie '${name}' was ${action} while banner visible and no consent granted`
            }
        }));
        
        // Log comprehensive audit
        console.log('[GDPR_COOKIE_AUDIT]', JSON.stringify(createGDPRAuditLog('violation_audit', {
            violation_details: {
                violating_cookie: name,
                action: action,
                banner_visible: isBannerVisible,
                consent_granted: hasMarketingConsent
            }
        })));
    }
    
    // Log all cookie events
    console.log('[COOKIE_EVENT]', JSON.stringify({
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
        is_marketing_cookie: isMarketing,
        banner_visible: isBannerVisible
    }));
}

// ===== COOKIE BANNER DETECTION =====

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

function isBannerStillVisible() {
    if (!cookieBannerElement) return false;
    
    try {
        // Check if element is still in DOM
        if (!document.contains(cookieBannerElement)) {
            cookieBannerCurrentlyVisible = false;
            return false;
        }
        
        // Use enhanced visibility check
        const isVisible = isElementTrulyVisible(cookieBannerElement);
        
        if (!isVisible && cookieBannerCurrentlyVisible) {
            cookieBannerCurrentlyVisible = false;
            console.log('[COOKIE_BANNER_HIDDEN]', JSON.stringify({
                timestamp: new Date().toISOString(),
                url: window.location.href,
                reason: 'element_not_truly_visible'
            }));
        }
        
        return isVisible;
    } catch (e) {
        cookieBannerCurrentlyVisible = false;
        return false;
    }
}

function detectCookieBanner() {
    if (cookieBannerDetected) return;

    // Optimized banner detection with better organization
    const bannerSelectors = [
        // Major CMP providers (high priority)
        '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#usercentrics-cmp', '#BorlabsCookieBox',
        '#truste-consent-track', '.qc-cmp-ui', '#cmpbox', '#iubenda-cs-banner', '#cookiescript_injected', 
        '#didomi-notice', '.cc-window', '#cookieConsent',
        
        // Generic patterns (medium priority)
        '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
        '[id*="privacy" i]', '[class*="privacy" i]', '[id*="gdpr" i]', '[class*="gdpr" i]',
        '[role="dialog"][aria-label*="cookie" i]'
    ];

    const cookieTextPattern = /(cookies?|privacy|consent|gdpr|accept.*cookie|we use cookie|personalized ads|manage.*cookie)/i;

    let foundBanner = null;
    let detectionMethod = '';

    // Method 1: Check for elements with cookie-related selectors
    for (const selector of bannerSelectors) {
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
            if (isValidBannerElement(element) && cookieTextPattern.test(element.textContent || '')) {
                foundBanner = element;
                detectionMethod = 'text pattern';
                break;
            }
        }
    }

    if (foundBanner && isElementTrulyVisible(foundBanner)) {
        registerBannerDetection(foundBanner, detectionMethod);
    }
}

// Helper function to validate banner elements
function isValidBannerElement(element) {
    if (!element || element.offsetWidth === 0 || element.offsetHeight === 0) return false;
    
    const rect = element.getBoundingClientRect();
    const text = element.textContent || '';
    
    // Size validation
    if (rect.width < 200 || rect.height < 50) return false;
    
    // Text length validation (avoid main content)
    if (text.length < 10 || text.length > 2000) return false;
    
    // Position validation (banners are typically positioned)
    const styles = getComputedStyle(element);
    const isPositioned = styles.position === 'fixed' || styles.position === 'absolute' ||
                        rect.top < 100 || rect.bottom > window.innerHeight - 100;
    
    return isPositioned;
}

// CMP vendor detection configuration
const CMP_VENDORS = {
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
        selectors: ['#usercentrics-cmp', '.uc-banner', '[data-testid*="usercentrics"]'],
        patterns: ['usercentrics'],
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
        selectors: ['#cookiescript_injected', '.cookiescript'],
        patterns: ['cookiescript'],
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
};

// Generic banner patterns
const GENERIC_PATTERNS = {
    'Generic Cookie Banner': ['[id*="cookie" i]', '[class*="cookie" i]'],
    'Generic Consent Banner': ['[id*="consent" i]', '[class*="consent" i]'],
    'Generic Privacy Banner': ['[id*="privacy" i]', '[class*="privacy" i]'],
    'Generic GDPR Banner': ['[id*="gdpr" i]', '[class*="gdpr" i]']
};

// Helper function to detect CMP vendor
function detectCMPVendor(banner, method) {
    // Method 1: Check specific vendor selectors
    const vendorBySelector = checkVendorSelectors(banner);
    if (vendorBySelector) return vendorBySelector;
    
    // Method 2: Check banner attributes and text
    const vendorByAttributes = checkVendorAttributes(banner);
    if (vendorByAttributes) return vendorByAttributes;
    
    // Method 3: Check global variables
    const vendorByGlobal = checkGlobalVariables();
    if (vendorByGlobal) return vendorByGlobal;
    
    // Method 4: Check generic patterns
    const vendorByGeneric = checkGenericPatterns(banner);
    if (vendorByGeneric) return vendorByGeneric;
    
    return 'Unknown CMP';
}

// Check vendor-specific selectors
function checkVendorSelectors(banner) {
    for (const [vendor, config] of Object.entries(CMP_VENDORS)) {
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
}

// Check banner attributes and text content
function checkVendorAttributes(banner) {
    const bannerClasses = Array.from(banner.classList);
    const bannerId = banner.id || '';
    const bannerText = (banner.textContent || '').toLowerCase();
    
    for (const [vendor, config] of Object.entries(CMP_VENDORS)) {
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
}

// Check global variables
function checkGlobalVariables() {
    for (const [vendor, config] of Object.entries(CMP_VENDORS)) {
        if (config.globalVar && window[config.globalVar]) {
            return vendor;
        }
    }
    return null;
}

// Check generic patterns
function checkGenericPatterns(banner) {
    for (const [vendor, selectors] of Object.entries(GENERIC_PATTERNS)) {
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
}

// Helper function to register banner detection
function registerBannerDetection(banner, method) {
    cookieBannerDetected = true;
    cookieBannerElement = banner;
    cookieBannerCurrentlyVisible = true;
    
    // Detect CMP vendor
    const cmpVendor = detectCMPVendor(banner, method);
    
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

    console.log('[COOKIE_BANNER_DETECTED]', JSON.stringify(bannerInfo));
    
    // Log banner buttons with vendor info
    logBannerButtons(banner, cmpVendor);
    
    // Perform cookie analysis when banner is detected
    performCookieAnalysisOnBannerDetection(cmpVendor);
}

// Helper function to log banner buttons
function logBannerButtons(banner, cmpVendor) {
    const buttons = banner.querySelectorAll('button, a, [role="button"]');
    if (buttons.length > 0) {
        const buttonInfo = Array.from(buttons).map(btn => ({
            tag: btn.tagName.toLowerCase(),
            text: (btn.textContent || '').trim(),
            id: btn.id || '',
            classes: Array.from(btn.classList).join(' '),
            onclick: btn.onclick ? 'has_onclick' : 'no_onclick'
        }));
        
        console.log('[COOKIE_BANNER_BUTTONS]', JSON.stringify({
            url: window.location.href,
            timestamp: new Date().toISOString(),
            cmp_vendor: cmpVendor,
            buttons: buttonInfo
        }));
    }
}

// Helper function to perform cookie analysis when banner is detected
function performCookieAnalysisOnBannerDetection(cmpVendor) {
    setTimeout(() => {
        const cookieInventory = getAllCookiesWithClassification();
        const marketingCookies = cookieInventory.marketing_cookies;
        
        if (marketingCookies.length > 0) {
            console.log('[MARKETING_COOKIES_ALREADY_SET]', JSON.stringify({
                timestamp: new Date().toISOString(),
                url: window.location.href,
                domain: window.location.hostname,
                cmp_vendor: cmpVendor,
                marketing_cookies: marketingCookies,
                cookie_count: marketingCookies.length,
                banner_just_detected: true,
                severity: 'MEDIUM',
                compliance_risk: 'GDPR_PRELOAD_VIOLATION',
                message: `${marketingCookies.length} marketing cookie(s) were already set before ${cmpVendor} banner appeared - potential GDPR violation`
            }));
        }
        
        // Log complete cookie audit
        console.log('[GDPR_COOKIE_AUDIT]', JSON.stringify(createGDPRAuditLog('banner_detection_audit', {
            banner_detection: {
                banner_found: true,
                detection_method: 'banner_detected',
                cmp_vendor: cmpVendor,
                banner_element: {
                    tag: cookieBannerElement.tagName.toLowerCase(),
                    id: cookieBannerElement.id || '',
                    classes: Array.from(cookieBannerElement.classList).join(' ')
                }
            }
        })));
    }, 100);
}

// ===== SETUP FUNCTIONS =====

function setupCookieObserver() {
    // Method 1: Override document.cookie setter
    try {
        let originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') || 
                                      Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
        
        if (originalCookieDescriptor && originalCookieDescriptor.configurable) {
            Object.defineProperty(document, 'cookie', {
                get: originalCookieDescriptor.get,
                set: function(value) {
                    // Call the original setter first
                    originalCookieDescriptor.set.call(this, value);
                    
                    // Trigger change detection
                    setTimeout(detectCookieChanges, 5);
                },
                configurable: true
            });
            console.log('[COOKIE_MONITOR]', 'Cookie setter override successful');
        }
    } catch (error) {
        console.error('[COOKIE_MONITOR]', 'Cookie setter override failed:', error);
    }

    // Method 2: Periodic monitoring (backup)
    setInterval(detectCookieChanges, 2000);

    // Method 3: DOM mutation observer
    if (window.MutationObserver) {
        const observer = new MutationObserver(function(mutations) {
            let shouldCheck = false;
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeName === 'SCRIPT') {
                            shouldCheck = true;
                        }
                    });
                }
            });
            if (shouldCheck) {
                setTimeout(detectCookieChanges, 100);
            }
        });
        
        observer.observe(document, {
            childList: true,
            subtree: true
        });
    }
}

function setupCookieBannerObserver() {
    // Initial detection
    setTimeout(detectCookieBanner, 500);
    setTimeout(detectCookieBanner, 2000);
    setTimeout(detectCookieBanner, 5000);

    // Periodic visibility check
    setInterval(function() {
        if (cookieBannerDetected && cookieBannerCurrentlyVisible) {
            isBannerStillVisible(); // This will update the visibility status
        }
    }, 2000);

    // MutationObserver for dynamically added banners
    if (window.MutationObserver) {
        cookieBannerObserver = new MutationObserver(function(mutations) {
            let shouldCheck = false;
            mutations.forEach(function(mutation) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            shouldCheck = true;
                        }
                    });
                }
                // Also check for removed nodes (banner might be hidden)
                if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
                    mutation.removedNodes.forEach(function(node) {
                        if (node === cookieBannerElement) {
                            cookieBannerCurrentlyVisible = false;
                            console.log('[COOKIE_BANNER_HIDDEN]', JSON.stringify({
                                timestamp: new Date().toISOString(),
                                url: window.location.href,
                                reason: 'element_removed_from_dom'
                            }));
                        }
                    });
                }
            });
            if (shouldCheck && !cookieBannerDetected) {
                setTimeout(detectCookieBanner, 100);
            }
        });
        
        cookieBannerObserver.observe(document, {
            childList: true,
            subtree: true
        });
        
        console.log('[COOKIE_BANNER_MONITOR]', 'Cookie banner observer initialized.');
    }
}

// ===== INITIALIZATION =====

// Initialize cookie monitoring
lastCookieSnapshot = getCookieSnapshot();
setupCookieObserver();

// Initialize cookie banner detection
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupCookieBannerObserver);
} else {
    setupCookieBannerObserver();
}

console.log('[DATALAYER_MONITOR]', 'DataLayer monitoring injected.'); 