// ===== GLOBAL STATE =====
let ws, reconnectAttempts = 0, allExpanded = false;
let currentFontSize = 14; // Default font size in pixels
let currentHeaderFontSize = 13; // Default header font size in pixels
let currentButtonFontSize = 9; // Default button font size in pixels
let userInteracting = false;
let interactionTimeout = null;
let consentStatus = {
    status: 'unknown', // 'unknown', 'accepted', 'declined'
    timestamp: null,
    categories: {},
    buttonText: null
};
let settings = {
    showServerCookies: false,
    showClientCookies: false,
    showDataLayer: true,
    showInfo: false,
    showJavaScriptEndpoints: false,
    platformVisibility: {}
};

// ===== DOM ELEMENTS =====
const DOM = {
    content: document.getElementById('content'),
    status: document.getElementById('status'),
    toggleDetailsBtn: document.getElementById('toggleDetailsBtn'),
    showServerCookiesToggle: document.getElementById('showServerCookiesToggle'),
    showClientCookiesToggle: document.getElementById('showClientCookiesToggle'),
    showDataLayerToggle: document.getElementById('showDataLayerToggle'),
    showInfoToggle: document.getElementById('showInfoToggle'),
    showJavaScriptEndpointsToggle: document.getElementById('showJavaScriptEndpointsToggle'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    increaseFontBtn: document.getElementById('increaseFontBtn'),
    decreaseFontBtn: document.getElementById('decreaseFontBtn'),
    settingsToggle: document.getElementById('settingsToggle'),
    settingsDropdown: document.getElementById('settingsDropdown'),
    panelClose: document.getElementById('panelClose'),
    themeToggle: document.getElementById('themeToggle')
};

// ===== CONFIGURATION =====
// Debug flag - set to true to see event type debugging info
window.DEBUG_EVENT_TYPES = false;

let CONFIG = {
    // Default configuration - will be loaded from config.json
    ga4Icon: '📊',
    typeIconMap: {
        'consent': '🛡️', 'error': '❌', 'warning': '⚠️', 'info': '💡', 'success': '✅',
        'datalayer': '📋', 'url_change': '🌐', 'cookie': '🍪', 'request_status_update': '📡'
    },
    statusColors: {
        info: '#64B5F6', success: '#66BB6A', warning: '#FFB74D', error: '#F06292'
    },
    platforms: [
        'GA4', 'Facebook', 'TikTok', 'Snapchat', 'Pinterest', 'LinkedIn', 'Twitter/X',
        'Microsoft/Bing', 'Google Ads', 'DoubleClick', 'Amazon', 'Criteo', 'Reddit',
        'Quora', 'Outbrain', 'Taboola', 'sGTM', 'Server-side GTM', 'Adobe Analytics',
        'Segment', 'Mixpanel', 'Privacy Sandbox', 'Custom Tracking'
    ],
    ga4Limits: {
        'event_name': 40, 'custom_parameter': 100, 'item_name': 100, 'item_id': 100,
        'item_brand': 100, 'item_category': 100, 'item_variant': 100, 'promotion_name': 100,
        'creative_name': 100, 'location_id': 100, 'affiliation': 100, 'coupon': 100,
        'currency': 3, 'method': 100, 'number_of_terms': 100, 'payment_type': 100,
        'shipping_tier': 100, 'content_type': 100, 'custom_map': 100, 'description': 100
    },
    platformHighlightClasses: {},
    platformIconMap: {},
    platformColors: {},
    websocket: {
        port: 9999,
        host: 'localhost',
        maxReconnectAttempts: 5,
        reconnectDelay: 2000,
        connectionTimeout: 5000
    }
};

// ===== CONFIGURATION LOADER =====
async function loadConfig() {
    try {
        const response = await fetch('./config.json');
        if (!response.ok) {
            console.warn('Could not load config.json, using defaults');
            return;
        }
        const config = await response.json();

        // Merge UI configuration
        if (config.ui) {
            CONFIG = { ...CONFIG, ...config.ui };
        }

        // Generate platforms and UI mappings from platformConfigs
        if (config.platformConfigs) {
            CONFIG.platforms = Object.keys(config.platformConfigs);
            CONFIG.platformIconMap = {};
            CONFIG.platformHighlightClasses = {};
            CONFIG.platformColors = {};

            // Generate mappings from platformConfigs
            for (const [platform, platformConfig] of Object.entries(config.platformConfigs)) {
                if (platformConfig.ui) {
                    CONFIG.platformIconMap[platform] = platformConfig.ui.icon || '<i class="fa-solid fa-mobile brand-icon"></i>';
                    CONFIG.platformHighlightClasses[platform] = platformConfig.ui.highlightClass || 'universal-highlight-default';
                    CONFIG.platformColors[platform] = platformConfig.ui.color || '#6366F1';
                } else {
                    CONFIG.platformIconMap[platform] = '<i class="fa-solid fa-mobile brand-icon"></i>';
                    CONFIG.platformHighlightClasses[platform] = 'universal-highlight-default';
                    CONFIG.platformColors[platform] = '#6366F1';
                }
            }
        }

        // Update websocket configuration
        if (config.websocket) {
            CONFIG.websocket = { ...CONFIG.websocket, ...config.websocket };
        }

        console.log('Configuration loaded successfully');
        
        // Validate that ga4Limits were loaded correctly
        if (CONFIG.ga4Limits && CONFIG.ga4Limits.event_name) {
            console.log('✅ GA4 parameter validation ready');
        } else {
            console.warn('❌ GA4 limits not properly loaded from configuration');
        }
    } catch (error) {
        console.warn('Error loading configuration:', error);
    }
}


// ===== THEME MANAGEMENT =====
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (DOM.themeToggle) {
        DOM.themeToggle.textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    try {
        localStorage.setItem('theme', newTheme);
    } catch (e) {
        // localStorage not available, ignore
    }
    applyTheme(newTheme);
}

function initTheme() {
    let theme = 'dark'; // default theme
    try {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'light' || savedTheme === 'dark') {
            theme = savedTheme;
        }
    } catch (e) {
        // localStorage is not available, use default
    }
    applyTheme(theme);
}

// ===== FONT SIZE MANAGEMENT =====
function applyFontSize(size) {
    document.documentElement.style.setProperty('--base-font-size', `${size}px`);
    currentFontSize = size;
    try {
        localStorage.setItem('fontSize', size.toString());
    } catch (e) {
        // localStorage not available, ignore
    }
}

function applyHeaderFontSize(size) {
    document.documentElement.style.setProperty('--header-font-size', `${size}px`);
    currentHeaderFontSize = size;
    try {
        localStorage.setItem('headerFontSize', size.toString());
    } catch (e) {
        // localStorage not available, ignore
    }
}

function applyButtonFontSize(size) {
    document.documentElement.style.setProperty('--button-font-size', `${size}px`);
    try {
        localStorage.setItem('buttonFontSize', size.toString());
    } catch (e) {
        // localStorage not available, ignore
    }
}

function increaseFontSize() {
    const newSize = Math.min(currentFontSize + 2, 24); // Max 24px
    const newHeaderSize = Math.min(currentHeaderFontSize + 1, 20); // Max 20px for header
    const newButtonSize = Math.min(currentButtonFontSize + 1, 16); // Max 16px for buttons
    applyFontSize(newSize);
    applyHeaderFontSize(newHeaderSize);
    applyButtonFontSize(newButtonSize);
    currentButtonFontSize = newButtonSize;
}

function decreaseFontSize() {
    const newSize = Math.max(currentFontSize - 2, 10); // Min 10px
    const newHeaderSize = Math.max(currentHeaderFontSize - 1, 8); // Min 8px for header
    const newButtonSize = Math.max(currentButtonFontSize - 1, 6); // Min 6px for buttons
    applyFontSize(newSize);
    applyHeaderFontSize(newHeaderSize);
    applyButtonFontSize(newButtonSize);
    currentButtonFontSize = newButtonSize;
}

function initFontSize() {
    let fontSize = 14; // default font size
    let headerFontSize = 13; // default header font size
    let buttonFontSize = 9; // default button font size

    try {
        const savedFontSize = localStorage.getItem('fontSize');
        if (savedFontSize && !isNaN(parseInt(savedFontSize))) {
            fontSize = parseInt(savedFontSize);
            fontSize = Math.max(10, Math.min(24, fontSize)); // Clamp between 10-24px
        }

        const savedHeaderFontSize = localStorage.getItem('headerFontSize');
        if (savedHeaderFontSize && !isNaN(parseInt(savedHeaderFontSize))) {
            headerFontSize = parseInt(savedHeaderFontSize);
            headerFontSize = Math.max(8, Math.min(20, headerFontSize)); // Clamp between 8-20px
        }

        const savedButtonFontSize = localStorage.getItem('buttonFontSize');
        if (savedButtonFontSize && !isNaN(parseInt(savedButtonFontSize))) {
            buttonFontSize = parseInt(savedButtonFontSize);
            buttonFontSize = Math.max(6, Math.min(16, buttonFontSize)); // Clamp between 6-16px
        }
    } catch (e) {
        // localStorage is not available, use default
    }

    applyFontSize(fontSize);
    applyHeaderFontSize(headerFontSize);
    applyButtonFontSize(buttonFontSize);
    currentButtonFontSize = buttonFontSize;
}

// ===== UTILITY FUNCTIONS =====
function updateStatus(message, type = 'info') {
    DOM.status.textContent = message;
    DOM.status.style.color = CONFIG.statusColors[type];
}

// ===== CONSENT STATUS MANAGEMENT =====
function updateConsentStatusHeader() {
    console.log('🎨 Updating consent status dot, current status:', consentStatus.status);

    const consentDot = document.getElementById('consentIndicator');
    if (!consentDot) {
        console.log('❌ Consent indicator dot not found in DOM');
        return;
    }

    // Force visibility and ensure it's displayed
    consentDot.style.display = 'inline-block';
    consentDot.style.visibility = 'visible';

    // Remove existing classes
    consentDot.classList.remove('accepted', 'declined', 'unknown');

    switch (consentStatus.status) {
        case 'declined':
            console.log('🚫 Setting DECLINED dot styling');
            consentDot.classList.add('declined');
            consentDot.title = `Consent Status: DECLINED • ${consentStatus.timestamp || 'Unknown time'}`;
            break;
        case 'accepted':
            console.log('✅ Setting ACCEPTED dot styling');
            consentDot.classList.add('accepted');
            consentDot.title = `Consent Status: ACCEPTED • ${consentStatus.timestamp || 'Unknown time'}`;
            break;
        default:
            console.log('❓ Setting UNKNOWN status dot');
            consentDot.classList.add('unknown');
            consentDot.title = 'Consent Status: Unknown - No consent decision detected yet';
            break;
    }

    console.log('🎨 Dot update complete. Classes:', consentDot.className);
    console.log('🎨 Dot styles - display:', consentDot.style.display, 'visibility:', consentDot.style.visibility);
}

function checkConsentInDataLayer(data) {
    console.log('🔍 Checking consent in DataLayer:', data);

    // Look for consent_update events with all categories denied
    if (data && typeof data === 'object') {
        const consentCategories = [
            'ad_storage', 'analytics_storage', 'ad_personalization',
            'ad_user_data', 'functionality_storage', 'personalization_storage',
            'security_storage'
        ];

        let allDenied = false;
        let anyConsentFound = false;
        let deniedCount = 0;

        console.log('🔍 Checking categories:', consentCategories);

        // Check if this is a consent update with categories
        for (const category of consentCategories) {
            if (data[category]) {
                anyConsentFound = true;
                console.log(`📊 Found category ${category}: ${data[category]}`);
                if (data[category] === 'denied') {
                    deniedCount++;
                } else {
                    console.log(`✅ Category ${category} is not denied: ${data[category]}`);
                }
            }
        }

        allDenied = anyConsentFound && deniedCount === Object.keys(data).filter(key => consentCategories.includes(key)).length;

        console.log(`📈 Consent analysis: Found ${deniedCount} denied categories out of ${Object.keys(data).filter(key => consentCategories.includes(key)).length} total consent categories`);

        if (anyConsentFound && allDenied) {
            console.log('🚫 ALL CONSENT DECLINED - Updating header');
            consentStatus.status = 'declined';
            consentStatus.timestamp = new Date().toLocaleTimeString();
            consentStatus.categories = data;
            updateConsentStatusHeader();
            return true;
        } else if (anyConsentFound && !allDenied) {
            console.log('✅ SOME CONSENT GIVEN - Updating header');
            console.log('✅ Current consent status before update:', consentStatus.status);
            // Some consent was given
            consentStatus.status = 'accepted';
            consentStatus.timestamp = new Date().toLocaleTimeString();
            consentStatus.categories = data;
            console.log('✅ Updated consent status to:', consentStatus.status);
            updateConsentStatusHeader();
            return true;
        } else if (anyConsentFound) {
            console.log('❓ Consent categories found but status unclear');
        } else {
            console.log('❌ No consent categories found in data');
        }
    } else {
        console.log('❌ Invalid data structure for consent check');
    }
    return false;
}

// ===== UNIFIED PLATFORM CONFIGURATION =====
function getPlatformConfig(platform, configType) {
    const configMap = {
        'icon': CONFIG.platformIconMap,
        'highlight': CONFIG.platformHighlightClasses,
        'color': CONFIG.platformColors
    };
    const defaults = {
        'icon': '<i class="fa-solid fa-mobile brand-icon"></i>',
        'highlight': 'universal-highlight-default',
        'color': '#6366F1'
    };
    return configMap[configType]?.[platform] || defaults[configType];
}

function getPlatformIcon(platform) {
    return getPlatformConfig(platform, 'icon');
}

function getPlatformHighlightClass(platform) {
    return getPlatformConfig(platform, 'highlight');
}

// ===== PARAMETER VALIDATION =====
function checkGA4ParameterLength(paramName, paramValue, platform) {
    // Check if this is a GA4-compatible platform
    if (!platform || (platform !== 'GA4' && platform !== 'sGTM' && platform !== 'Server-side GTM')) {
        return null;
    }
    
    // Check if paramValue exists and has length
    if (!paramValue || typeof paramValue !== 'string') {
        return null;
    }

    // Ensure ga4Limits is available
    if (!CONFIG || !CONFIG.ga4Limits) {
        console.warn('GA4 parameter validation: CONFIG.ga4Limits not available');
        return null;
    }

    // Get the appropriate limit for this parameter
    const specificLimit = CONFIG.ga4Limits[paramName];
    const defaultLimit = CONFIG.ga4Limits.custom_parameter;
    const limit = specificLimit || defaultLimit;
    
    if (!limit) {
        console.warn(`GA4 parameter validation: No limit found for parameter '${paramName}' and no default limit available`);
        return null;
    }

    const current = paramValue.length;

    // Check if the parameter exceeds the limit
    if (current > limit) {
        return {
            current,
            limit,
            excess: current - limit,
            severity: current > limit * 1.5 ? 'error' : 'warning'
        };
    }
    
    return null;
}

function highlightUniversalParameters(paramName, paramValue) {
    const importantParams = {
        'pixel_id': 'pixel-id-highlight',
        'tracking_id': 'tracking-id-highlight',
        'event_name': 'event-name-highlight',
        'event_id': 'event-id-highlight',
        'conversion_id': 'conversion-id-highlight',
        'campaign_id': 'campaign-id-highlight',
        'user_id': 'user-id-highlight',
        'client_id': 'client-id-highlight'
    };

    const lowerParamName = paramName.toLowerCase();

    for (const [key, cssClass] of Object.entries(importantParams)) {
        if (lowerParamName.includes(key.replace('_', '')) || lowerParamName.includes(key)) {
            return `<span class="${cssClass}">${paramValue}</span>`;
        }
    }

    if (paramValue.length > 50) {
        return `<span class="long-param-value">${paramValue}</span>`;
    }

    return paramValue;
}

function highlightLongParameters(detailsText, platform) {
    const lines = detailsText.split('\n');
    const processedLines = lines.map(line => {
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (match) {
            const paramName = match[1].trim();
            const paramValue = match[2].trim();

            if (platform === 'GA4' || platform === 'sGTM' || platform === 'Server-side GTM') {
                const lengthCheck = checkGA4ParameterLength(paramName, paramValue, platform);
                if (lengthCheck) {
                    const cssClass = lengthCheck.severity === 'error' ? 'param-error' : 'param-warning';
                    const warningText = ` <span class="${cssClass}">${lengthCheck.current}/${lengthCheck.limit} chars (+${lengthCheck.excess})</span>`;
                    return `${paramName}: ${paramValue}${warningText}`;
                }
            }

            const highlightedValue = highlightUniversalParameters(paramName, paramValue);
            if (highlightedValue !== paramValue) {
                return `${paramName}: ${highlightedValue}`;
            }
        }
        return line;
    });

    return processedLines.join('\n');
}

// ===== FORMATTING FUNCTIONS =====
function prettyPrintNestedJson(obj, indent = 2) {
    if (typeof obj !== 'object' || obj === null) {
        return String(obj);
    }

    // Parse nested JSON strings for better display
    const parseNestedJson = (value) => {
        if (typeof value === 'string') {
            // Try to parse as JSON if it looks like JSON
            if ((value.startsWith('{') && value.endsWith('}')) ||
                (value.startsWith('[') && value.endsWith(']'))) {
                try {
                    return JSON.parse(value);
                } catch (e) {
                    // If parsing fails, return original string
                    return value;
                }
            }
        } else if (typeof value === 'object' && value !== null) {
            // Recursively process objects and arrays
            if (Array.isArray(value)) {
                return value.map(parseNestedJson);
            } else {
                const parsed = {};
                for (const [key, val] of Object.entries(value)) {
                    parsed[key] = parseNestedJson(val);
                }
                return parsed;
            }
        }
        return value;
    };

    const processedObj = parseNestedJson(obj);
    return JSON.stringify(processedObj, null, indent);
}

function formatMetadataSection(metadata) {
    let out = '';
    if (!metadata) return out;

    // Show request URL prominently at the top
    if (metadata.request_url) {
        out += `Request URL:\n${metadata.request_url}\n\n`;
    }

    if (metadata.response_headers) {
        out += `Response Headers:\n${JSON.stringify(metadata.response_headers, null, 2)}\n`;
    }

    if (metadata.raw_data) {
        const rawDataForDisplay = { ...metadata.raw_data };
        delete rawDataForDisplay._request_path; // Remove redundant key
        delete rawDataForDisplay._request_host;
        out += `Raw Data:\n${prettyPrintNestedJson(rawDataForDisplay, 1)}\n`;
    }

    return out;
}

function prettyPrintDetailsRaw(metadata, data = null) {
    let out = formatMetadataSection(metadata);
    if (data) {
        out += `Data:\n${prettyPrintNestedJson(data, 1)}`;
    }
    return out;
}

function prettyPrintDetailsFlat(data, metadata = null, isDataLayer = false) {
    let out = '';
    const relevantFields = ['page_url', 'referrer_url', 'client_id', 'user_id', 'session_id', 'timestamp', 'request_hash'];

    if (isDataLayer) {
        out += formatDataLayerDetails(data);
    } else {
        // Add relevant data fields
        for (const field of relevantFields) {
            if (data[field]) {
                out += `${field}: ${data[field]}\n`;
            }
        }

        if (data.event_type) {
            out += `Event Type: ${data.event_type}\n`;
        }

        // Debug: Log all data keys to console to see what's available
        if (window.DEBUG_EVENT_TYPES) {
            console.log('Event data keys:', Object.keys(data));
            console.log('Event type value:', data.event_type);
        }

        // Add extra info (re-enabled for sGTM details)
        if (data.extra_info && Array.isArray(data.extra_info)) {
            out += `\nExtra Info:\n${data.extra_info.map(info => `  • ${info}`).join('\n')}\n`;
        }

        // Add mapped data (re-enabled for parameter mappings)
        if (data.mapped_data && Object.keys(data.mapped_data).length > 0) {
            out += `\nMapped Data:\n`;
            for (const [key, value] of Object.entries(data.mapped_data)) {
                out += `  ${key}: ${value}\n`;
            }
        }

        if (data.debug_info) {
            out += `\nDebug Info:\n${formatDebugInfo(data.debug_info)}`;
        }

        // Add JavaScript endpoint information
        if (data.js_info) {
            out += `\nJavaScript Info:\n`;
            out += `  Type: ${data.js_info.type}\n`;
            out += `  Description: ${data.js_info.description}\n`;
            if (data.js_info.pattern) {
                out += `  Pattern: ${data.js_info.pattern}\n`;
            }
        }
    }

    // Use shared metadata formatting to eliminate duplication
    const metadataContent = formatMetadataSection(metadata);
    if (metadataContent) {
        out += `\n${metadataContent}`;
    }

    return out;
}

function formatDebugInfo(debugInfo) {
    let out = '';
    for (const [key, value] of Object.entries(debugInfo)) {
        if (typeof value === 'object' && value !== null) {
            out += `  ${key}:\n${prettyPrintNestedJson(value, 2)}`;
        } else {
            out += `  ${key}: ${value}\n`;
        }
    }
    return out;
}

function formatDataLayerDetails(data) {
    let out = '';
    if (data.event_name) out += `Event: ${data.event_name}\n`;
    if (data.data_layer_data) {
        out += `DataLayer Data:\n`;
        for (const [key, value] of Object.entries(data.data_layer_data)) {
            out += `  ${formatDataLayerValue(key, value)}\n`;
        }
    }
    return out;
}

function formatDataLayerValue(key, value) {
    if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
            return `${key}: [${value.length} items]`;
        }
        return `${key}: ${JSON.stringify(value)}`;
    }
    return `${key}: ${value}`;
}

function formatDataLayerAsJSON(data) {
    let out = '';
    if (data.event_name) out += `Event: ${data.event_name}\n\n`;

    // Print the entire data object as formatted JSON
    out += `DataLayer Data:\n${JSON.stringify(data, null, 2)}`;

    return out;
}

function formatCookieDetails(data, metadata) {
    let out = '';

    // Display the full request URL from metadata if available, as it provides context
    if (metadata && metadata.request_url) {
        out += `Request URL: ${metadata.request_url}\n`;
    }

    // Common fields for all cookie types
    if (data.action) out += `Action: ${data.action}\n`;
    if (data.path) out += `Path: ${data.path}\n`;
    if (data.cookie_type) out += `Type: ${data.cookie_type}\n`;
    if (data.cookie_count) out += `Count: ${data.cookie_count}\n`;
    if (data.domain || data.host) out += `Domain: ${data.domain || data.host}\n`;

    // Show cookie values for client-side cookies
    if (data.cookie_type === 'client_side') {
        if (data.new_value !== undefined) {
            out += `New Value: ${data.new_value || '(empty)'}\n`;
        }
        if (data.old_value !== undefined) {
            out += `Old Value: ${data.old_value || '(empty)'}\n`;
        }
    }

    // Show cookie list for both server-side and client-side (now standardized)
    if (data.cookies && Array.isArray(data.cookies) && data.cookies.length > 0) {
        out += `\nCookies:\n`;
        data.cookies.forEach((cookie, index) => {
            out += `  ${index + 1}. ${cookie}\n`;
        });
    }

    // Show full cookie headers (mainly for server-side)
    if (data.full_cookies && Array.isArray(data.full_cookies)) {
        out += `\nFull Cookie Headers:\n`;
        data.full_cookies.forEach((cookie, index) => {
            out += `  ${index + 1}. ${cookie}\n`;
        });
    }

    return out;
}

function formatUrlChangeDetails(data) {
    let out = '';
    const keyLabelMap = {
        from_url: 'From',
        previous_url: 'From',
        to_url: 'To',
        url: 'To',
        title: 'Title',
        description: 'Description',
        navigation_type: 'Navigation Type',
        referrer: 'Referrer',
        user_agent: 'User Agent',
        timestamp: 'Timestamp',
        source: 'Source',
        frame_id: 'Frame ID',
        page_load_id: 'Page Load ID'
    };

    const printedLabels = new Set();

    // Print details directly present in the data object
    for (const [key, label] of Object.entries(keyLabelMap)) {
        if (data[key] && !printedLabels.has(label)) {
            out += `${label}: ${data[key]}\n`;
            printedLabels.add(label); // Avoid printing 'From' or 'To' twice
        }
    }

    // Parse and display query parameters from the URL, as they are critical for debugging
    const currentUrl = data.to_url || data.url;
    if (currentUrl) {
        try {
            const urlObj = new URL(currentUrl);
            const params = Array.from(urlObj.searchParams.entries());
            if (params.length > 0) {
                out += `\nQuery Parameters:\n`;
                params.forEach(([key, value]) => {
                    const displayValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
                    out += `  ${key}: ${displayValue}\n`;
                });
            }
        } catch (e) {
            // Invalid URL, skip parameter parsing
        }
    }

    return out;
}

function getMarketingPixelSummary(data, event) {
    const platform = data.platform || 'Unknown';

    // // Check if we have highlighting info with pre-formatted text
    // if (data.highlight_info && data.highlight_info.should_highlight && data.highlight_info.highlight_text) {
    //     const platformClass = getPlatformHighlightClass(data.platform);
    //     // Use the pre-formatted highlight text from Python (which already includes platform, event, and pixel_id)
    //     /return `<span class="universal-highlight ${platformClass}">${data.highlight_info.highlight_text}</span>`;
    // }

    // Fallback to manual formatting
    let pixelId = '';
    if (data.pixel_id) {
        const platformClass = getPlatformHighlightClass(data.platform);
        pixelId = ` <span class="pixel-id universal-highlight ${platformClass}">${data.pixel_id}</span>`;
    }

    const gcs = data.gcs ? ` <span class="gcs-param">GCS: ${data.gcs}</span>` : '';
    
    // Add Extra Info if available
    let extraInfo = '';
    if (data.extra_info && Array.isArray(data.extra_info) && data.extra_info.length > 0) {
        const extraInfoText = data.extra_info.join(', ');
        extraInfo = ` <span class="extra-info">(${extraInfoText})</span>`;
    }
    
    // Add platform-specific tracking parameters
    let clickIds = '';
    const platformTrackingParamMap = {
        'GA4': ['gclid', 'dclid', 'wbraid', 'gbraid'],
        'Google Ads': ['gclid', 'dclid', 'wbraid', 'gbraid'],
        'DoubleClick': ['gclid', 'dclid', 'wbraid', 'gbraid'],
        'Facebook': ['fbc', 'fbp', '_fbc', '_fbp'],
        'TikTok': ['ttclid', 'ttp'],
        'Microsoft/Bing': ['msclkid'],
        'Pinterest': ['pinclid'],
        'LinkedIn': ['liclid'],
        'Twitter/X': ['twclid'],
        'Snapchat': ['scclid']
    };
    
    const platformClickIds = platformTrackingParamMap[platform];
    if (platformClickIds) {
        const foundClickIds = [];
        for (const paramName of platformClickIds) {
            const value = data[paramName] || data.mapped_data?.[paramName] || data.metadata?.raw_data?.[paramName];
            if (value && value.toString().trim() !== '') {
                foundClickIds.push(`<span class="click-id">${paramName}: ${value.substring(0, 12)}${value.length > 12 ? '...' : ''}</span>`);
            } else {
                foundClickIds.push(`<span class="click-id-missing"><s>${paramName}</s></span>`);
            }
        }
        
        if (foundClickIds.length > 0) {
            clickIds = ` ${foundClickIds.join(' ')}`;
        }
    }
    
    return `<span class="platform-name">${platform}</span> <b class="event-name">${event}</b>${pixelId}${gcs}${extraInfo}${clickIds}`;
}

// ===== SHARED HELPER FUNCTIONS =====
function getConfidenceColor(confidence) {
    if (confidence >= 80) return '#22c55e'; // green
    else if (confidence >= 60) return '#f59e0b'; // yellow
    else if (confidence >= 40) return '#ef4444'; // red
    return '#6b7280'; // gray
}

// ===== MESSAGE HANDLING =====
const messageHandlers = {
    'custom_tracking': (logEntry) => {
        const { event, data } = logEntry;
        const icon = getPlatformIcon(data.platform);
        const requestHost = logEntry.metadata?.request_url ? new URL(logEntry.metadata.request_url).host : 'Unknown Host';
        const requestPath = logEntry.metadata?.request_path || '/';
        const event_name = logEntry.metadata?.raw_data?.event || event || 'Custom Event';
        const action = logEntry.metadata?.raw_data?.action || data.action;

        const actionText = action ? ` - <span class="action">${action}</span>` : '';
        const summary = `<span class="platform-name">Custom Platform</span> <b class="event-name">${event_name}</b>${actionText} (${requestHost}) <code>${requestPath}</code>`;
        const details = prettyPrintDetailsFlat(data, logEntry.metadata, false);
        
        // Debug: Check if metadata contains request_url
        if (window.DEBUG_CUSTOM_TRACKING && logEntry.metadata) {
            console.log('Custom tracking metadata:', logEntry.metadata);
            console.log('Request URL in metadata:', logEntry.metadata.request_url);
        }
        
        renderMessage(summary, data.platform, icon, true, false, details);
    },



    'cookie_banner_detected': (logEntry) => {
        const { data } = logEntry;
        const icon = '🍪';
        const confidence = data.confidence || 0;
        const reasons = data.reasons || [];
        const confidenceColor = getConfidenceColor(confidence);

        const summary = `<b>Cookie Banner Detected</b> - <span style="color: ${confidenceColor}; font-weight: bold;">${confidence}% confidence</span>`;

        const elementInfo = data.element_info || {};
        const position = data.position || {};
        const styling = data.styling || {};

        const details = [
            'Cookie Banner Analysis:',
            `Confidence: ${confidence}% (${reasons.join(', ')})`,
            `Element: ${elementInfo.tagName || 'Unknown'} ${elementInfo.id ? `#${elementInfo.id}` : ''} ${elementInfo.className ? `.${elementInfo.className}` : ''}`,
            `Position: ${Math.round(position.left || 0)}, ${Math.round(position.top || 0)} (${Math.round(position.width || 0)}×${Math.round(position.height || 0)})`,
            `Styling: ${styling.position || 'static'}, z-index: ${styling.zIndex || 'auto'}`,
            `Text Length: ${elementInfo.textLength || 0} characters`,
            `Text Snippet: "${data.text_snippet || 'No text'}"`,
            `Page URL: ${data.page_url || 'Unknown'}`,
            `Viewport: ${data.viewport?.width || 0}×${data.viewport?.height || 0}`
        ].join('\n');

        renderMessage(summary, 'cookie_banner', icon, true, false, details);
    },

    'spa_pageview': (logEntry) => {
        const { event, data } = logEntry;
        const icon = '🌐';
        
        const navigationTypes = {
            'pushState': '➡️ Push State',
            'replaceState': '🔄 Replace State', 
            'popstate': '⬅️ Back/Forward',
            'hashchange': '#️⃣ Hash Change',
            'path_change': '📍 Path Change',
            'url_change': '🔗 URL Change'
        };
        
        const navigationIcon = data.navigation_type === 'popstate' ? '⬅️' : 
                             data.navigation_type === 'hashchange' ? '#️⃣' : '➡️';
        
        const navTypeDisplay = navigationTypes[data.navigation_type] || data.navigation_type;
        
        // Extract meaningful URL parts for display
        const fromUrl = data.from_url || data.previous_page || 'Unknown';
        const toUrl = data.to_url || data.page_location || data.url || 'Unknown';
        
        // Create shortened URLs for display (show path + hash)
        const getDisplayUrl = (url) => {
            if (!url || url === 'Unknown' || url === 'None') return url;
            try {
                const urlObj = new URL(url);
                return urlObj.pathname + urlObj.search + urlObj.hash;
            } catch {
                return url.length > 50 ? url.substring(0, 47) + '...' : url;
            }
        };
        
        const fromDisplay = getDisplayUrl(fromUrl);
        const toDisplay = getDisplayUrl(toUrl);
        
        const summary = `${navigationIcon} <b>SPA Navigation</b> - ${navTypeDisplay}: <code>${fromDisplay}</code> → <code>${toDisplay}</code>`;
        
        const details = [
            'SPA Page View:',
            `Navigation Type: ${data.navigation_type}`,
            `Page Location: ${data.page_location}`,
            `Page Path: ${data.page_path}`,
            `Page Title: ${data.page_title || 'No title'}`,
            `Previous Page: ${data.previous_page || 'None'}`,
            `Hash: ${data.hash || 'None'}`,
            `Search: ${data.search || 'None'}`,
            `Host: ${data.host}`,
            `Referrer: ${data.referrer || 'None'}`,
            `User Agent: ${data.user_agent}`,
            `Detection Method: ${logEntry.metadata?.detection_method || 'unknown'}`,
            `Timestamp: ${new Date(data.timestamp).toLocaleString()}`
        ].join('\n');

        // Add URL change separator style for better visibility
        renderMessage(summary, 'spa_navigation', icon, true, true, details, 'url-change-separator');
    },

    'cookie_banner_summary': (logEntry) => {
        const { data } = logEntry;
        const icon = '📊';
        const totalBanners = data.total_banners || 0;
        const maxConfidence = data.max_confidence || 0;
        const summaryColor = getConfidenceColor(maxConfidence);

        const summary = `<b>Banner Detection Summary</b> - <span style="color: ${summaryColor};">${totalBanners} banner(s) found</span>`;
        const details = [
            'Detection Summary:',
            `Total Banners Found: ${totalBanners}`,
            `Highest Confidence: ${maxConfidence}%`,
            `Page URL: ${data.page_url || 'Unknown'}`
        ].join('\n');

        renderMessage(summary, 'banner_summary', icon, true, false, details);
    },

    'banner_detector_status': (logEntry) => {
        const { data } = logEntry;
        const icon = '🔧';
        const summary = `<b>Banner Detector</b> - ${data.message || 'Status update'}`;
        renderMessage(summary, 'detector_status', icon, false, false, '');
    },

    'marketing_pixel_event': (logEntry) => {
        const { event, data } = logEntry;
        const icon = getPlatformIcon(data.platform);
        const summary = getMarketingPixelSummary(data, event);
        const details = prettyPrintDetailsFlat(data, logEntry.metadata, false, data.debug_info);
        renderMessage(summary, data.platform, icon, true, false, details);
    },

    'error': (logEntry) => {
        const { event, data, metadata } = logEntry;
        const icon = CONFIG.typeIconMap.error;
        const summary = `Error: ${data.message || event}`;

        let details = '';
        // Always show the request URL if available
        if (metadata && metadata.request_url) {
            details += `Request URL:\n${metadata.request_url}\n\n`;
        }

        // Display the main data object, which includes the message and debug_info
        // details += `Error Details (JSON):\n${prettyPrintNestedJson(data)}\n\n`;

        // Explicitly display the raw request payload from metadata
        if (metadata && metadata.raw_data) {
            details += `Request Payload (raw_data):\n${prettyPrintNestedJson(metadata.raw_data)}\n`;
        }

        renderMessage(summary, 'error', icon, false, false, details);
    },

    'datalayer': (logEntry) => {
        const { event, data } = logEntry;

        console.log('📋 Processing DataLayer event:', event, 'with data:', data);

        // Check for consent updates in DataLayer events
        if (event === 'consent_update') {
            // Try multiple data structure possibilities
            let consentData = data.data_layer_data || data || null;
            console.log('📋 Checking consent data structure:', consentData);

            if (consentData) {
                checkConsentInDataLayer(consentData);
            }
        }

        // Also check any data with consent-related keys regardless of event name
        const dataToCheck = data.data_layer_data || data;
        if (dataToCheck && typeof dataToCheck === 'object') {
            const hasConsentKeys = Object.keys(dataToCheck).some(key =>
                key.includes('storage') || key.includes('consent') || key.includes('ad_') || key.includes('analytics_')
            );
            if (hasConsentKeys) {
                console.log('📋 Found consent-related keys in any DataLayer event, checking:', dataToCheck);
                checkConsentInDataLayer(dataToCheck);
            }
        }

        const icon = CONFIG.typeIconMap.datalayer;
        const summary = `DataLayer <b>${event}</b>`;
        const details = formatDataLayerAsJSON(data) + (logEntry.metadata ? `\n\nMetadata:\n${prettyPrintDetailsRaw(logEntry.metadata)}` : '');
        renderMessage(summary, 'DataLayer', icon, false, false, details);
    },

    'consent': (logEntry) => {
        const { event, data } = logEntry;
        const icon = CONFIG.typeIconMap.consent || '🛡️';

        if (event === 'user_consent_declined') {
            consentStatus.status = 'declined';
            consentStatus.timestamp = new Date().toLocaleTimeString();
            consentStatus.categories = data.categories || {};
            updateConsentStatusHeader();

            const summary = `<span style="color: #dc2626; font-weight: bold;">🚫 USER CONSENT DECLINED</span>`;
            const details = [
                'Consent Status: DECLINED',
                `All Categories Denied: ${data.all_categories_denied ? 'Yes' : 'No'}`,
                `Categories: ${Object.keys(data.categories || {}).join(', ')}`,
                `Timestamp: ${consentStatus.timestamp}`,
                '',
                'Full Data:',
                JSON.stringify(data, null, 2)
            ].join('\n');
            renderMessage(summary, 'consent', icon, true, false, details);

        } else if (event === 'user_consent_given' || event === 'user_consent_accepted') {
            consentStatus.status = 'accepted';
            consentStatus.timestamp = new Date().toLocaleTimeString();
            consentStatus.buttonText = data.button_text || null;
            updateConsentStatusHeader();

            const summary = `<span style="color: #15803d; font-weight: bold;">✅ USER CONSENT ${event === 'user_consent_given' ? 'GIVEN' : 'ACCEPTED'}</span>`;
            const details = [
                'Consent Status: ACCEPTED',
                `Consent Type: ${data.consent_type || 'Unknown'}`,
                `Button Text: "${data.button_text || 'Unknown'}"`,
                `Granted Categories: ${(data.granted_categories || []).join(', ') || 'None specified'}`,
                `Denied Categories: ${(data.denied_categories || []).join(', ') || 'None specified'}`,
                `Timestamp: ${consentStatus.timestamp}`,
                '',
                'Full Data:',
                JSON.stringify(data, null, 2)
            ].join('\n');
            renderMessage(summary, 'consent', icon, true, false, details);

        } else {
            // Handle other consent events
            const summary = `Consent <b>${event}</b>`;
            const details = JSON.stringify(data, null, 2);
            renderMessage(summary, 'consent', icon, false, false, details);
        }
    },

    'cookie': (logEntry) => {
        const { event, data } = logEntry;
        const icon = CONFIG.typeIconMap.cookie;

        // Determine cookie source and message type
        let cookieSource, messageType;
        if (data.cookie_type === 'client_side') {
            cookieSource = 'Client-side';
            messageType = 'ClientCookie';
        } else if (data.cookie_type === 'tracking') {
            cookieSource = 'Server-side (Tracking)';
            messageType = 'ServerCookie';
        } else if (data.cookie_type === 'target_domain') {
            cookieSource = 'Server-side (Target)';
            messageType = 'ServerCookie';
        } else {
            cookieSource = 'Server-side';
            messageType = 'ServerCookie';
        }

        // Use standardized action field, with fallback to event
        const cookieAction = data.action || event || 'set';
        
        // Create action-aware summary
        let actionText = cookieAction.replace(/^cookie_/i, '').replace(/_/g, ' ');
        actionText = actionText.charAt(0).toUpperCase() + actionText.slice(1);
        
        // Use standardized cookie name handling
        let cookieNames;
        if (data.cookies && Array.isArray(data.cookies) && data.cookies.length > 0) {
            cookieNames = data.cookies.join(', ');
        } else if (data.cookie_name) {
            cookieNames = data.cookie_name;
        } else {
            cookieNames = 'Unknown';
        }
        
        const summary = `Cookie <b>${actionText}</b> (${cookieSource}): ${cookieNames}`;
        
        const details = formatCookieDetails(data, logEntry.metadata);
        renderMessage(summary, messageType, icon, false, false, details);
    },

    'url_change': (logEntry) => {
        const { event, data } = logEntry;
        const icon = '🌐';  // Use larger, more prominent icon

        // Create prominent summary with enhanced formatting
        const newUrl = data.to_url || data.url || 'Unknown URL';
        const domain = new URL(newUrl).hostname;
        const path = new URL(newUrl).pathname + new URL(newUrl).search;

        // Enhanced formatting with domain highlighting
        const summary = `<span style="font-size: 1.1em; font-weight: 800;">🚀 PAGE NAVIGATION</span><br>
                        <span style="color: #3b82f6; font-weight: 600;">${domain}</span><span style="color: #6b7280;">${path}</span>`;

        const details = formatUrlChangeDetails(data) + (logEntry.metadata ? `\n\nMetadata:\n${prettyPrintDetailsRaw(logEntry.metadata)}` : '');

        // URL changes appear in chronological order but with special separator styling
        renderMessage(summary, 'url_change', icon, true, true, details, 'url-change-separator');
    },

    'request_status_update': (logEntry) => {
        updateRequestStatus(logEntry.data);
    },

    'violation': (logEntry) => {
        const { event, data } = logEntry;
        const icon = '⚠️';
        
        if (event === 'marketing_cookies_preloaded') {
            const cookieCount = data.cookie_count || 0;
            const severity = data.severity || 'MEDIUM';
            const severityColor = severity === 'HIGH' ? '#F44336' : severity === 'MEDIUM' ? '#FF9800' : '#FFC107';
            
            const summary = `<b style="color: ${severityColor};">GDPR Violation Risk</b> - ${cookieCount} marketing cookie(s) already set before banner`;
            
            const cookieList = data.marketing_cookies ? 
                data.marketing_cookies.map(cookie => `• ${cookie.name}${cookie.value ? ` = ${cookie.value}` : ''}`).join('\n') : 
                'No cookie details available';
            
            const details = [
                `Violation Type: ${data.violation_type || 'marketing_cookies_before_banner'}`,
                `Severity: ${severity}`,
                `Compliance Risk: ${data.compliance_risk || 'GDPR_PRELOAD_VIOLATION'}`,
                `Domain: ${data.domain || 'Unknown'}`,
                `Cookie Count: ${cookieCount}`,
                '',
                'Marketing Cookies Found:',
                cookieList,
                '',
                `Message: ${data.message || 'Marketing cookies detected before consent banner appeared'}`,
                `URL: ${data.url || 'Unknown'}`
            ].join('\n');
            
            renderMessage(summary, 'violation', icon, true, false, details);
        } else if (event === 'marketing_cookie_while_banner_visible') {
            const severity = data.severity || 'HIGH';
            const severityColor = severity === 'HIGH' ? '#F44336' : '#FF9800';
            const violatingCookie = data.violating_cookie_name || data.cookie_name || 'Unknown Cookie';
            const action = data.action || 'set';
            const totalMarketing = data.total_marketing_cookies || 0;
            const totalOther = data.total_other_cookies || 0;
            
            const summary = `<b style="color: ${severityColor};">GDPR Violation</b> - Marketing cookie '${violatingCookie}' ${action} while banner visible (${totalMarketing} total marketing cookies)`;
            
            // Build comprehensive cookie lists
            let marketingCookiesList = 'No marketing cookies data available';
            if (data.all_marketing_cookies && data.all_marketing_cookies.length > 0) {
                marketingCookiesList = data.all_marketing_cookies.map(cookie => {
                    const violatingMarker = cookie.is_violating_cookie ? ' ⚠️ [VIOLATING]' : '';
                    return `• ${cookie.name}${cookie.value ? ` = ${cookie.value}` : ''}${violatingMarker}`;
                }).join('\n');
            }
            
            let otherCookiesList = 'No other cookies';
            if (data.all_other_cookies && data.all_other_cookies.length > 0) {
                otherCookiesList = data.all_other_cookies.slice(0, 10).map(cookie => 
                    `• ${cookie.name}${cookie.value ? ` = ${cookie.value}` : ''}`
                ).join('\n');
                if (data.all_other_cookies.length > 10) {
                    otherCookiesList += `\n... and ${data.all_other_cookies.length - 10} more`;
                }
            }
            
            const details = [
                `Violation Type: ${data.violation_type || 'marketing_cookie_while_banner_visible'}`,
                `Violating Cookie: ${violatingCookie}`,
                `Violating Cookie Value: ${data.violating_cookie_value || data.cookie_value || 'N/A'}`,
                `Action: ${action}`,
                `Severity: ${severity}`,
                `Compliance Risk: ${data.compliance_risk || 'GDPR_VIOLATION_RISK'}`,
                `Domain: ${data.domain || 'Unknown'}`,
                '',
                `Cookie Context:`,
                `Total Marketing Cookies: ${totalMarketing}`,
                `Total Other Cookies: ${totalOther}`,
                '',
                'All Marketing Cookies:',
                marketingCookiesList,
                '',
                'Other Cookies (sample):',
                otherCookiesList,
                '',
                `Message: ${data.message || 'Marketing cookie set while consent banner visible without proper consent'}`,
                `URL: ${data.url || 'Unknown'}`
            ].join('\n');
            
            renderMessage(summary, 'violation', icon, true, false, details);
        } else {
            // Generic violation handler
            const summary = `<b style="color: #F44336;">Compliance Violation</b> - ${event}`;
            const details = prettyPrintDetailsFlat(data, logEntry.metadata, false);
            renderMessage(summary, 'violation', icon, true, false, details);
        }
    }
};

function handleStructuredLog(logEntry) {
    const { type, event, data } = logEntry;

    const handler = messageHandlers[type];
    if (handler) {
        try {
            handler(logEntry);
        } catch (error) {
            console.error(`Error handling message type '${type}':`, error);
            // Fallback to generic handler
            const icon = '❌';
            const summary = `Error processing ${type}`;
            const details = `Error: ${error.message}\n\nOriginal data:\n${JSON.stringify(logEntry, null, 2)}`;
            renderMessage(summary, 'error', icon, false, false, details);
        }
    } else {
        // Generic handler for unknown types
        const icon = CONFIG.typeIconMap[type] || CONFIG.typeIconMap.info;
        const summary = `${type}: ${event}`;
        const details = prettyPrintDetailsRaw(logEntry.metadata, data);
        renderMessage(summary, type, icon, false, false, details);
    }
}

// ===== RESPONSE STATUS HELPERS =====
function hasResponseInfo(data) {
    return !!(data.response_type || data.response_size || data.content_type || data.response_time || data.status_code);
}

function hasStatusIcon(messageText) {
    return messageText.includes('✅') || messageText.includes('❌');
}

function formatResponseInfo(data, isError = false) {
    const responseFields = [
        { key: 'response_type', label: 'Response Type' },
        { key: 'response_size', label: 'Response Size' },
        { key: 'content_type', label: 'Content Type' },
        { key: 'response_time', label: 'Response Time' },
        { key: 'cache_control', label: 'Cache Control' },
        { key: 'etag', label: 'ETag' }
    ];

    let info = '';
    for (const field of responseFields) {
        if (data[field.key]) {
            info += `\n${field.label}: ${data[field.key]}`;
        }
    }
    return info;
}

function findMessageByHash(messages, hash) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const detailsEl = msg.querySelector('.message-details');
        if (!detailsEl) continue;

        const messageHash = detailsEl.textContent.match(/request_hash[":]\s*([a-f0-9]{12})/i)?.[1];
        const isNotStatusMessage = !hasStatusIcon(msg.querySelector('.message-text')?.textContent || '');

        if (messageHash === hash && isNotStatusMessage) {
            return msg;
        }
    }
    return null;
}

function findMessageByPlatform(messages, platform) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const messageType = msg.getAttribute('data-type');
        const messageText = msg.querySelector('.message-text')?.textContent || '';

        const isExactPlatformMatch = messageType.toLowerCase() === platform.toLowerCase();
        const isErrorFromPlatform = messageType.toLowerCase() === 'error' &&
            messageText.toLowerCase().includes(platform.toLowerCase());
        const isNotStatusMessage = !messageText.includes('Request') && !hasStatusIcon(messageText);

        if ((isExactPlatformMatch || isErrorFromPlatform) && isNotStatusMessage) {
            return msg;
        }
    }
    return null;
}

function findTargetMessage(messages, data) {
    // Try hash-based matching first
    if (data.request_hash) {
        const hashMatch = findMessageByHash(messages, data.request_hash);
        if (hashMatch) return hashMatch;
    }
    
    // Fallback to platform-based matching
    return findMessageByPlatform(messages, data.platform);
}

function updateRequestStatus(data) {
    const messages = DOM.content.querySelectorAll('.message');
    const targetMessage = findTargetMessage(messages, data);

    if (!targetMessage) return;

    const messageTextEl = targetMessage.querySelector('.message-text');
    const detailsEl = targetMessage.querySelector('.message-details');

    if (!data.success) {
        // Handle failed requests
        if (messageTextEl && !hasStatusIcon(messageTextEl.textContent)) {
            messageTextEl.innerHTML += ` ❌`;

            if (detailsEl) {
                let statusInfo = `\n\n--- Request Failed ---\nStatus: ${data.status_code || 'Unknown'}`;
                if (data.method) statusInfo += `\nMethod: ${data.method}`;
                
                const requestUrl = data.request_url || data.url;
                if (requestUrl) statusInfo += `\nRequest URL:\n${requestUrl}`;
                
                if (data.error_details) statusInfo += `\nError: ${data.error_details}`;
                if (data.response_status) statusInfo += `\nResponse Status: ${data.response_status}`;
                
                statusInfo += formatResponseInfo(data, true);
                
                if (window.DEBUG_RESPONSE_STATUS) {
                    console.log('Request status data:', data);
                }
                
                detailsEl.textContent += statusInfo;
            }
        }
    } else if (hasResponseInfo(data)) {
        // Handle successful requests with response info
        if (detailsEl && !detailsEl.textContent.includes('--- Response Info ---')) {
            let responseInfo = `\n\n--- Response Info ---\nStatus: ${data.status_code} (Success)`;
            responseInfo += formatResponseInfo(data, false);
            detailsEl.textContent += responseInfo;
        }
    }
}

function handleLegacyMessage(message, type = 'info') {
    const icon = CONFIG.typeIconMap[type] || CONFIG.typeIconMap.info;
    const messageType = type.charAt(0).toUpperCase() + type.slice(1);

    if (message.includes('Connected to')) {
        renderMessage(message, messageType, icon, false, false, '');
        return;
    }

    let details = '';
    if (message.includes(' | ')) {
        const parts = message.split(' | ');
        message = parts[0];
        details = parts.slice(1).join('\n');
    }

    const detailsText = highlightLongParameters(details, messageType || 'Unknown');
    renderMessage(message, messageType, icon, false, false, detailsText);

}

function renderMessage(message, messageType, icon, isBold, isNewPage, details, extraClasses = '') {
    const msg = document.createElement('div');
    msg.className = `message ${extraClasses}`;
    msg.setAttribute('data-type', messageType);

    // Create timestamp with milliseconds
    const now = new Date();
    const timestampWithMillis = now.toLocaleTimeString() + '.' + now.getMilliseconds().toString().padStart(3, '0');

    const weightClass = isBold ? 'font-weight: 600;' : '';
    const pageClass = isNewPage ? 'page-separator' : '';

    // Add timestamp to details
    const detailsWithTimestamp = details ? `Timestamp: ${timestampWithMillis}\n\n${details}` : `Timestamp: ${timestampWithMillis}`;

    msg.innerHTML = `
        <div class="message-content">
            <div class="message-icon">${icon}</div>
            <div class="message-text" style="${weightClass}">${message}</div>
        </div>
        <div class="message-details" style="display: none;">${detailsWithTimestamp}</div>
    `;

    if (pageClass) msg.classList.add(pageClass);
    msg.classList.add('expandable');
    attachExpandHandler(msg);

    // Apply visibility based on current filter and settings
    const filterText = document.getElementById('filterInput')?.value.toLowerCase() || '';
    const messageText = (message + ' ' + details).toLowerCase(); // Use message and details for text matching

    const isUrlChange = messageType === 'url_change' || messageType === 'URLChange';
    const typeVisible = checkMessageVisibility(messageType);
    const textMatch = !filterText || messageText.includes(filterText);

    const shouldShow = isUrlChange || (typeVisible && textMatch);
    msg.style.display = shouldShow ? 'block' : 'none';

    DOM.content.appendChild(msg);
    if (shouldShow && !userInteracting) {
        msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function renderMessageWithPriority(message, messageType, icon, isBold, isNewPage, details, extraClasses = '', priority = 'normal') {
    const msg = document.createElement('div');
    msg.className = `message ${extraClasses}`;
    msg.setAttribute('data-type', messageType);

    // Create timestamp with milliseconds
    const now = new Date();
    const timestampWithMillis = now.toLocaleTimeString() + '.' + now.getMilliseconds().toString().padStart(3, '0');

    const weightClass = isBold ? 'font-weight: 600;' : '';
    const pageClass = isNewPage ? 'page-separator' : '';

    // Add timestamp to details
    const detailsWithTimestamp = details ? `Timestamp: ${timestampWithMillis}\n\n${details}` : `Timestamp: ${timestampWithMillis}`;

    msg.innerHTML = `
        <div class="message-content">
            <div class="message-icon">${icon}</div>
            <div class="message-text" style="${weightClass}">${message}</div>
        </div>
        <div class="message-details" style="display: none;">${detailsWithTimestamp}</div>
    `;

    if (pageClass) msg.classList.add(pageClass);
    msg.classList.add('expandable');
    attachExpandHandler(msg);

    // Apply visibility based on current filter and settings
    const filterText = document.getElementById('filterInput')?.value.toLowerCase() || '';
    const messageText = (message + ' ' + details).toLowerCase();

    const isUrlChange = messageType === 'url_change' || messageType === 'URLChange';
    const typeVisible = checkMessageVisibility(messageType);
    const textMatch = !filterText || messageText.includes(filterText);

    const shouldShow = isUrlChange || (typeVisible && textMatch);
    msg.style.display = shouldShow ? 'block' : 'none';

    // Priority-based insertion
    if (priority === 'top') {
        // For URL changes, we want chronological order but as section headers
        // Insert URL changes at the bottom, but they act as section separators
        DOM.content.appendChild(msg);
    } else {
        DOM.content.appendChild(msg);
    }

    if (shouldShow && !userInteracting) {
        msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function attachExpandHandler(msg) {
    msg.addEventListener('click', function () {
        const details = this.querySelector('.message-details');
        if (details) {
            const isHidden = details.style.display === 'none' || details.style.display === '';
            details.style.display = isHidden ? 'block' : 'none';
        }
    });
}

// ===== NAVIGATION & PAGINATION =====
function getVisiblePageSeparators() {
    return Array.from(DOM.content.querySelectorAll('.page-separator'));
}

function updateNavigationButtons() {
    const separators = getVisiblePageSeparators();
    DOM.prevPageBtn.disabled = separators.length <= 1;
    DOM.nextPageBtn.disabled = separators.length <= 1;
}

function scrollToPage(index) {
    const separators = getVisiblePageSeparators();
    if (separators[index]) {
        separators[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function findCurrentPage() {
    const separators = getVisiblePageSeparators();
    const containerTop = DOM.content.scrollTop;
    const containerHeight = DOM.content.clientHeight;
    const viewportCenter = containerTop + containerHeight / 2;

    for (let i = separators.length - 1; i >= 0; i--) {
        if (separators[i].offsetTop <= viewportCenter) {
            return i;
        }
    }
    return 0;
}

// ===== PLATFORM UTILITIES =====
function forEachPlatformCheckbox(operation) {
    CONFIG.platforms.forEach(platform => {
        const checkbox = document.getElementById(`toggle-${platform}`);
        if (checkbox) {
            operation(platform, checkbox);
        } else {
            // Handle missing checkboxes
            operation(platform, null);
        }
    });
}

// ===== SETTINGS MANAGEMENT =====
function initializeSettings() {
    // Initialize platform visibility settings
    forEachPlatformCheckbox((platform, checkbox) => {
        settings.platformVisibility[platform] = checkbox ? checkbox.checked : true;
        if (checkbox) {
            updatePlatformItemState(checkbox); // Apply initial visual state
        }
    });

    // Initialize general display toggle settings
    const toggleMappings = [
        { element: DOM.showServerCookiesToggle, setting: 'showServerCookies' },
        { element: DOM.showClientCookiesToggle, setting: 'showClientCookies' },
        { element: DOM.showDataLayerToggle, setting: 'showDataLayer' },
        { element: DOM.showInfoToggle, setting: 'showInfo' },
        { element: DOM.showJavaScriptEndpointsToggle, setting: 'showJavaScriptEndpoints' }
    ];

    toggleMappings.forEach(({ element, setting }) => {
        if (element) {
            settings[setting] = element.checked;
        }
    });
}

function updatePlatformItemState(checkbox) {
    const platformItem = checkbox.closest('.platform-item');
    if (platformItem) {
        platformItem.style.opacity = checkbox.checked ? '1' : '0.5';
    }
}

function openSettings() {
    DOM.settingsDropdown.classList.add('visible');
    DOM.settingsDropdown.style.display = 'block';
}

function closeSettings() {
    DOM.settingsDropdown.classList.remove('visible');
    DOM.settingsDropdown.style.display = 'none';
}

function toggleSettings() {
    DOM.settingsDropdown.classList.contains('visible') ? closeSettings() : openSettings();
}

// ===== FILTERING =====
function applyFilter() {
    const filterText = document.getElementById('filterInput')?.value.toLowerCase() || '';
    const messages = DOM.content.querySelectorAll('.message');

    messages.forEach(msg => {
        const messageType = msg.getAttribute('data-type');
        const messageText = msg.textContent.toLowerCase();

        const isUrlChange = messageType === 'url_change' || messageType === 'URLChange';
        const typeVisible = checkMessageVisibility(messageType);
        const textMatch = !filterText || messageText.includes(filterText);

        // Show if it's a URL change, OR if it's a visible type that matches the text filter.
        const shouldShow = isUrlChange || (typeVisible && textMatch);
        msg.style.display = shouldShow ? 'block' : 'none';
    });

    updateNavigationButtons();
}

// ===== UNIFIED VISIBILITY LOGIC =====
function checkMessageVisibility(messageType, messageText = '') {
    // URL changes are always visible as they're critical navigation info
    if (messageType === 'URLChange' || messageType === 'url_change') {
        return true;
    }

    // Handle general visibility toggles (Info, Cookies, etc.)
    const typeFilters = {
        'ServerCookie': settings.showServerCookies,
        'ClientCookie': settings.showClientCookies,
        'DataLayer': settings.showDataLayer,
        'Info': settings.showInfo,
        'javascript_endpoint': settings.showJavaScriptEndpoints
    };

    // Normalize 'info' to 'Info' for the lookup to fix case-sensitivity bug
    const normalizedType = messageType.toLowerCase() === 'info' ? 'Info' : messageType;

    if (typeFilters.hasOwnProperty(normalizedType) && !typeFilters[normalizedType]) {
        return false;
    }

    // For messages that are not special types, check platform visibility.
    if (settings.platformVisibility.hasOwnProperty(messageType)) {
        return settings.platformVisibility[messageType];
    }

    // If the message type is not a platform and passed the general filters, it should be visible.
    return true;
}

// ===== WEBSOCKET CONNECTION =====
function connect() {
    if (ws) return;

    const wsUrl = `ws://${CONFIG.websocket.host}:${CONFIG.websocket.port}`;
    ws = new WebSocket(wsUrl);

    const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            updateStatus('Connection timeout', 'error');
            ws.close();
        }
    }, CONFIG.websocket.connectionTimeout);

    ws.onopen = () => {
        clearTimeout(connectionTimeout);
        updateStatus('Connected', 'success');
        reconnectAttempts = 0;
        addMessage('Connected to RK Logger', 'success');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            const message = data.message || event.data;
            if (message.includes('Connection test') || message.includes('Connected to embedded')) return;
            addMessage(message, 'info');
        } catch (e) {
            addMessage(event.data, 'info');
        }
    };

    ws.onclose = () => {
        ws = null;
        updateStatus('Disconnected', 'error');

        if (reconnectAttempts < CONFIG.websocket.maxReconnectAttempts) {
            reconnectAttempts++;
            updateStatus(`Reconnecting... (${reconnectAttempts}/${CONFIG.websocket.maxReconnectAttempts})`, 'warning');
            setTimeout(connect, CONFIG.websocket.reconnectDelay);
        } else {
            updateStatus('Connection failed', 'error');
        }
    };

    ws.onerror = () => {
        updateStatus('Connection error', 'error');
    };
}

function addMessage(message, type = 'info') {
    const emptyState = DOM.content.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    // Debug: Log all incoming messages to see if we're missing consent events
    if (typeof message === 'string' && (message.includes('consent') || message.includes('storage'))) {
        console.log('🔍 Consent-related message detected:', message);
    }

    if (message.startsWith('[STRUCTURED] ')) {
        try {
            const logEntry = JSON.parse(message.substring(13));
            console.log('📨 Structured log entry:', logEntry);

            if (logEntry.type && logEntry.event && logEntry.data) {
                // Check for consent_update events specifically
                if (logEntry.type === 'datalayer' && logEntry.event === 'consent_update') {
                    console.log('🎯 Found consent_update event, processing...');
                    console.log('🎯 Raw data structure:', logEntry.data);
                    const consentData = logEntry.data.data_layer_data || logEntry.data;
                    console.log('🎯 Extracted consent data:', consentData);
                    checkConsentInDataLayer(consentData);
                }

                // Also check any consent-type events
                if (logEntry.type === 'consent') {
                    console.log('🎯 Found consent event type, processing...');
                }

                handleStructuredLog(logEntry);
                return;
            }
        } catch (e) {
            console.error('❌ Error parsing structured log:', e);
            // Fall through to legacy handling
        }
    }
    handleLegacyMessage(message, type);
}

// ===== EVENT LISTENERS =====
function initializeEventListeners() {
    // Theme toggle
    DOM.themeToggle?.addEventListener('click', toggleTheme);

    // Font size controls
    DOM.increaseFontBtn?.addEventListener('click', increaseFontSize);
    DOM.decreaseFontBtn?.addEventListener('click', decreaseFontSize);

    // Details toggle
    DOM.toggleDetailsBtn?.addEventListener('click', () => {
        allExpanded = !allExpanded;
        DOM.content.querySelectorAll('.message-details').forEach(details => {
            details.style.display = allExpanded ? 'block' : 'none';
        });
        DOM.toggleDetailsBtn.textContent = allExpanded ? 'Collapse All' : 'Expand All';
    });

    // Clear output
    document.getElementById('clearOutputBtn')?.addEventListener('click', () => {
        DOM.content.innerHTML = `<div class="empty-state">
            <div class="empty-icon">📊</div>
            <div>Waiting for GA4 and marketing pixel events...</div>
            <div class="empty-state-description">Events from GA4, Facebook, TikTok, Snapchat, Pinterest, LinkedIn, Twitter/X, Microsoft, Amazon, Criteo, Reddit, Quora, Outbrain, Taboola, sGTM, Adobe Analytics, Segment, Mixpanel, URL changes, and Custom Tracking will appear here</div>
        </div>`;
        // Recreate consent header after clearing
        updateConsentStatusHeader();
    });

    // Settings toggles with unified handlers
    const settingsToggles = [
        { element: DOM.showServerCookiesToggle, setting: 'showServerCookies' },
        { element: DOM.showClientCookiesToggle, setting: 'showClientCookies' },
        { element: DOM.showDataLayerToggle, setting: 'showDataLayer' },
        { element: DOM.showInfoToggle, setting: 'showInfo' },
        { element: DOM.showJavaScriptEndpointsToggle, setting: 'showJavaScriptEndpoints' }
    ];

    settingsToggles.forEach(({ element, setting }) => {
        element?.addEventListener('change', () => {
            settings[setting] = element.checked;
            applyFilter();
        });
    });

    // Platform visibility toggles
    forEachPlatformCheckbox((platform, checkbox) => {
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                settings.platformVisibility[platform] = checkbox.checked;
                updatePlatformItemState(checkbox);
                applyFilter();
            });
        }
    });

    // Navigation
    DOM.prevPageBtn?.addEventListener('click', () => {
        const currentPage = findCurrentPage();
        if (currentPage > 0) scrollToPage(currentPage - 1);
    });

    DOM.nextPageBtn?.addEventListener('click', () => {
        const currentPage = findCurrentPage();
        const separators = getVisiblePageSeparators();
        if (currentPage < separators.length - 1) scrollToPage(currentPage + 1);
    });

    DOM.content?.addEventListener('scroll', updateNavigationButtons);

    // Settings panel
    DOM.settingsToggle?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSettings();
    });

    DOM.panelClose?.addEventListener('click', closeSettings);

    DOM.settingsDropdown?.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Global click handler for closing settings
    document.addEventListener('click', (e) => {
        if (!DOM.settingsDropdown.contains(e.target) && !DOM.settingsToggle.contains(e.target)) {
            closeSettings();
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSettings();
    });

    // Settings buttons with unified platform operations
    document.getElementById('selectAllBtn')?.addEventListener('click', () => {
        forEachPlatformCheckbox((platform, checkbox) => {
            if (checkbox) {
                checkbox.checked = true;
                settings.platformVisibility[platform] = true;
                updatePlatformItemState(checkbox);
            }
        });
        applyFilter();
    });

    document.getElementById('selectNoneBtn')?.addEventListener('click', () => {
        forEachPlatformCheckbox((platform, checkbox) => {
            if (checkbox) {
                checkbox.checked = false;
                settings.platformVisibility[platform] = false;
                updatePlatformItemState(checkbox);
            }
        });
        applyFilter();
    });

    document.getElementById('applySettingsBtn')?.addEventListener('click', () => {
        applyFilter();
        closeSettings();
    });

    // Filter input
    document.getElementById('filterInput')?.addEventListener('input', applyFilter);
}

// ===== USER INTERACTION TRACKING =====
function setUserInteracting() {
    userInteracting = true;
    if (interactionTimeout) {
        clearTimeout(interactionTimeout);
    }
    // Resume auto-scrolling after 3 seconds of inactivity
    interactionTimeout = setTimeout(() => {
        userInteracting = false;
    }, 3000);
}

function setupInteractionTracking() {
    // Track clicks anywhere in the content area
    DOM.content?.addEventListener('click', setUserInteracting);

    // Track scrolling in the content area
    DOM.content?.addEventListener('scroll', setUserInteracting);

    // Track mouse movements over interactive elements
    document.addEventListener('click', (e) => {
        // Only track clicks on interactive elements
        if (e.target.closest('button, input, .message.expandable, .settings-dropdown')) {
            setUserInteracting();
        }
    });

    // Track keyboard interactions
    document.addEventListener('keydown', (e) => {
        // Track navigation keys and interactive keys
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Tab', 'Enter', 'Space'].includes(e.key)) {
            setUserInteracting();
        }
    });
}

// ===== INITIALIZATION =====
async function init() {
    await loadConfig();
    initTheme();
    initFontSize();
    initializeSettings();
    initializeEventListeners();
    setupInteractionTracking(); // Add interaction tracking
    updateNavigationButtons();
    applyFilter(); // Apply default filter settings
    updateConsentStatusHeader(); // Initialize consent status header
    connect();
}

// Start the application
init().catch(console.error);