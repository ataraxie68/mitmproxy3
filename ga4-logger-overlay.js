// ===== GLOBAL STATE =====
let ws, reconnectAttempts = 0, allExpanded;
let currentFontSize, currentHeaderFontSize, currentButtonFontSize;
let userInteracting = false;
let interactionTimeout = null;
let consentStatus = {
    status: 'unknown', // 'unknown', 'accepted', 'declined'
    timestamp: null,
    categories: {},
    buttonText: null
};
let settings = {
    platformVisibility: {}
};

// ===== SEARCH NAVIGATION STATE =====
let searchResults = [];
let currentSearchIndex = -1;
let lastSearchText = '';
let lastPlatformSearchText = '';

// ===== CURRENT PAGE STATE =====
// Removed URL display logic

// Debug function - can be called from console
window.debugSearchNavigation = function() {
    console.log('=== Search Navigation Debug ===');
    console.log('searchResults:', searchResults);
    console.log('currentSearchIndex:', currentSearchIndex);
    console.log('lastSearchText:', lastSearchText);
    console.log('lastPlatformSearchText:', lastPlatformSearchText);
    console.log('DOM.content:', DOM.content);
    console.log('Search buttons:', {
        prev: DOM.prevSearchBtn,
        next: DOM.nextSearchBtn
    });
    
    if (searchResults.length > 0 && currentSearchIndex >= 0) {
        const currentElement = searchResults[currentSearchIndex].element;
        const detailsElement = currentElement.querySelector('.message-details');
        console.log('Current search element:', currentElement);
        console.log('Element rect:', currentElement.getBoundingClientRect());
        console.log('Container rect:', DOM.content.getBoundingClientRect());
        console.log('Has details:', !!detailsElement);
        if (detailsElement) {
            console.log('Details display:', detailsElement.style.display);
            console.log('Details visible:', detailsElement.style.display === 'block');
        }
    }
};

// Debug function for page tracking - removed

// ===== DOM ELEMENTS =====
const DOM = {
    content: document.getElementById('content'),
    contentMessages: document.getElementById('contentMessages'),
    status: document.getElementById('status'),
    toggleDetailsBtn: document.getElementById('toggleDetailsBtn'),
    showServerCookiesToggle: document.getElementById('showServerCookiesToggle'),
    showClientCookiesToggle: document.getElementById('showClientCookiesToggle'),
    showDataLayerToggle: document.getElementById('showDataLayerToggle'),
    showInfoToggle: document.getElementById('showInfoToggle'),
    showJavaScriptEndpointsToggle: document.getElementById('showJavaScriptEndpointsToggle'),
    searchAllContentToggle: document.getElementById('searchAllContentToggle'),
    prevPageBtn: document.getElementById('prevPageBtn'),
    nextPageBtn: document.getElementById('nextPageBtn'),
    prevSearchBtn: document.getElementById('prevSearchBtn'),
    nextSearchBtn: document.getElementById('nextSearchBtn'),
    increaseFontBtn: document.getElementById('increaseFontBtn'),
    decreaseFontBtn: document.getElementById('decreaseFontBtn'),
    settingsToggle: document.getElementById('settingsToggle'),
    settingsDropdown: document.getElementById('settingsDropdown'),
    panelClose: document.getElementById('panelClose'),
    themeToggle: document.getElementById('themeToggle'),

    filterInput: document.getElementById('filterInput'),
    platformFilterInput: document.getElementById('platformFilterInput'),
    clearFilterBtn: document.getElementById('clearFilterBtn'),
    clearPlatformFilterBtn: document.getElementById('clearPlatformFilterBtn')
};

// ===== CONFIGURATION =====

let CONFIG = {};

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

        // Initialize global variables from config defaults
        const defaults = CONFIG.defaults || {};
        currentFontSize = defaults.fontSize || 14;
        currentHeaderFontSize = defaults.headerFontSize || 15;
        currentButtonFontSize = defaults.buttonFontSize || 9;
        allExpanded = defaults.allExpanded || false;

        // Initialize settings from config defaults
        settings.showServerCookies = defaults.showServerCookies || false;
        settings.showClientCookies = defaults.showClientCookies || false;
        settings.showDataLayer = defaults.showDataLayer !== undefined ? defaults.showDataLayer : true;
        settings.showInfo = defaults.showInfo || false;
        settings.showJavaScriptEndpoints = defaults.showJavaScriptEndpoints || false;
        settings.searchAllContent = defaults.searchAllContent !== undefined ? defaults.searchAllContent : true;

        // Validate that ga4Limits were loaded correctly
        if (CONFIG.ga4Limits && CONFIG.ga4Limits.event_name) {
            console.log('✅ GA4 parameter validation ready');
            console.log('GA4 limits loaded:', CONFIG.ga4Limits);
        } else {
            console.warn('❌ GA4 limits not properly loaded from configuration');
            console.log('CONFIG.ga4Limits:', CONFIG.ga4Limits);
        }
    } catch (error) {
        console.warn('Error loading configuration:', error);
        // Initialize with fallback defaults if config loading fails
        currentFontSize = 14;
        currentHeaderFontSize = 15;
        currentButtonFontSize = 9;
        allExpanded = false;
        settings.showServerCookies = false;
        settings.showClientCookies = false;
        settings.showDataLayer = true;
        settings.showInfo = false;
        settings.showJavaScriptEndpoints = false;
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
    let headerFontSize = 15; // default header font size
    let buttonFontSize = 12; // default button font size

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
    const consentDot = document.getElementById('consentIndicator');
    if (!consentDot) {
        return;
    }

    // Force visibility and ensure it's displayed
    consentDot.style.display = 'inline-block';
    consentDot.style.visibility = 'visible';

    // Remove existing classes
    consentDot.classList.remove('accepted', 'declined', 'unknown');

    switch (consentStatus.status) {
        case 'declined':
            consentDot.classList.add('declined');
            consentDot.title = `Consent Status: DECLINED • ${consentStatus.timestamp || 'Unknown time'}`;
            break;
        case 'accepted':
            consentDot.classList.add('accepted');
            consentDot.title = `Consent Status: ACCEPTED • ${consentStatus.timestamp || 'Unknown time'}`;
            break;
        default:
            consentDot.classList.add('unknown');
            consentDot.title = 'Consent Status: Unknown - No consent decision detected yet';
            break;
    }

    // Force a repaint to ensure the changes are visible
    consentDot.offsetHeight;
}

function checkConsentInDataLayer(data) {
    if (data && typeof data === 'object') {
        const consentCategories = [
            'ad_storage', 'analytics_storage', 'ad_personalization',
            'ad_user_data', 'functionality_storage', 'personalization_storage',
            'security_storage'
        ];

        let allDenied = true; // Start assuming all denied
        let anyConsentFound = false;
        let deniedCount = 0;
        let grantedCount = 0;
        const foundCategories = [];

        // Check if this is a consent update with categories
        for (const category of consentCategories) {
            if (data[category] !== undefined && data[category] !== null) {
                anyConsentFound = true;
                foundCategories.push(category);

                if (data[category] === 'denied') {
                    deniedCount++;
                } else if (data[category] === 'granted') {
                    grantedCount++;
                    allDenied = false; // If any category is granted, not all denied
                }
            }
        }

        if (anyConsentFound) {
            if (allDenied && deniedCount > 0) {
                consentStatus.status = 'declined';
                consentStatus.timestamp = new Date().toLocaleTimeString();
                consentStatus.categories = data;
                updateConsentStatusHeader();
                return true;
            } else if (grantedCount > 0) {
                consentStatus.status = 'accepted';
                consentStatus.timestamp = new Date().toLocaleTimeString();
                consentStatus.categories = data;
                updateConsentStatusHeader();
                return true;
            } else {
                // Check if any category has a truthy value that might indicate consent
                const hasAnyGranted = Object.values(data).some(value =>
                    value === true || value === 'true' || value === 'granted' || value === 'accepted'
                );
                if (hasAnyGranted) {
                    consentStatus.status = 'accepted';
                    consentStatus.timestamp = new Date().toLocaleTimeString();
                    consentStatus.categories = data;
                    updateConsentStatusHeader();
                    return true;
                }
            }
        }
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
        console.log(`GA4 parameter limit exceeded: ${paramName} = ${current}/${limit} chars`);
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
    console.log('highlightLongParameters called with platform:', platform);
    console.log('Input text lines:', detailsText.split('\n').length);

    const lines = detailsText.split('\n');
    const processedLines = lines.map(line => {
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (match) {
            const paramName = match[1].trim();
            const paramValue = match[2].trim();

            if (platform === 'GA4' || platform === 'sGTM' || platform === 'Server-side GTM') {
                console.log(`Checking parameter: ${paramName} = ${paramValue.substring(0, 30)}...`);
                const lengthCheck = checkGA4ParameterLength(paramName, paramValue, platform);
                if (lengthCheck) {
                    console.log(`Length violation found for ${paramName}: ${lengthCheck.current}/${lengthCheck.limit}`);
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
class EventFormatter {
    // Core data formatting with JSON parsing
    static formatObject(obj, indent = 2) {
        if (typeof obj !== 'object' || obj === null) {
            return String(obj);
        }

        const parseNestedJson = (value) => {
            if (typeof value === 'string' &&
                ((value.startsWith('{') && value.endsWith('}')) ||
                    (value.startsWith('[') && value.endsWith(']')))) {
                try {
                    return JSON.parse(value);
                } catch (e) {
                    return value;
                }
            }
            if (typeof value === 'object' && value !== null) {
                if (Array.isArray(value)) {
                    return value.map(parseNestedJson);
                }
                const parsed = {};
                for (const [key, val] of Object.entries(value)) {
                    parsed[key] = parseNestedJson(val);
                }
                return parsed;
            }
            return value;
        };

        return JSON.stringify(parseNestedJson(obj), null, indent);
    }

    // Standardized event detail formatting with consistent sections
    static format(eventType, data, metadata, options = {}) {
        const {
            showUrl = true,
            showRawData = true,
            showResponse = true,
            showEventData = true,
            platform = null
        } = options;

        const sections = [];


        // 📋 RAW DATA SECTION
        if (showRawData && metadata?.raw_data) {
            const cleanedData = this.cleanRawData(metadata.raw_data);
            let rawSection = `📋 Raw Data:\n${this.formatObject(cleanedData, 2)}`;

            // Apply GA4 parameter highlighting if needed
            if (platform && this.isGA4Platform(platform)) {
                rawSection = this.applyParameterHighlighting(rawSection, platform);
            }

            sections.push(rawSection);
        }

        // 📍 REQUEST URL SECTION
        if (showUrl && metadata?.request_url) {
            sections.push(`📍 Request URL:\n${metadata.request_url}`);
        }

        // 📊 EVENT DATA SECTION (for non-raw events)
        if (showEventData && data && eventType !== 'raw') {
            const eventData = this.formatEventData(data, eventType);
            if (eventData) {
                sections.push(`📊 Event Data:\n${eventData}`);
            }
        }

        // 📡 RESPONSE INFO SECTION
        if (showResponse && metadata?.response_headers) {
            sections.push(`📡 Response Info:\n${this.formatObject(metadata.response_headers, 2)}`);
        }

        return sections.join('\n\n');
    }

    // Clean raw data by removing internal fields and detecting binary content
    static cleanRawData(rawData) {
        if (!rawData || typeof rawData !== 'object') return rawData;

        // Check if raw data contains binary/encoded content
        const rawDataStr = JSON.stringify(rawData);
        const hasBinaryContent = /[\u0000-\u001F\u007F-\u009F]/.test(rawDataStr) ||
            /[^\x20-\x7E]/.test(rawDataStr) ||
            // rawDataStr.includes('\\u') ||
            rawDataStr.length > 5000; // Very long data likely encoded

        if (hasBinaryContent && false) {
            return { "[Binary/Encoded data hidden]": "Content contains non-printable characters or is encoded" };
        }

        const cleaned = { ...rawData };
        delete cleaned._request_path;
        delete cleaned._request_host;
        return cleaned;
    }

    // Check if platform needs GA4 parameter highlighting
    static isGA4Platform(platform) {
        return platform === 'GA4' || platform === 'sGTM' || platform === 'Server-side GTM';
    }

    // Apply parameter highlighting for GA4 platforms
    static applyParameterHighlighting(text, platform) {
        if (!this.isGA4Platform(platform)) return text;

        const lines = text.split('\n');
        const processedLines = lines.map(line => {
            // Handle JSON-formatted lines with quotes and commas
            const jsonMatch = line.match(/^\s*"([^"]+)":\s*"([^"]*)"(,?)$/);
            const jsonMatch2 = line.match(/^\s*"([^"]+)":\s*"([^"]+)"(,?)$/);
            console.log(`Line: "${line}"`);
            console.log(`JSON match (empty):`, jsonMatch);
            console.log(`JSON match (non-empty):`, jsonMatch2);

            // Try both patterns
            const match = jsonMatch || jsonMatch2;
            if (match) {
                const paramName = match[1].trim();
                const paramValue = match[2].trim();
                const hasComma = match[3] === ',';

                console.log(`Processing JSON parameter: ${paramName} = "${paramValue}"`);

                // Check GA4 parameter length limits
                const lengthCheck = checkGA4ParameterLength(paramName, paramValue, platform);
                if (lengthCheck) {
                    console.log(`Length violation found for ${paramName}: ${lengthCheck.current}/${lengthCheck.limit}`);
                    const cssClass = lengthCheck.severity === 'error' ? 'param-error' : 'param-warning';
                    const warningText = ` <span class="${cssClass}">${lengthCheck.current}/${lengthCheck.limit} chars (+${lengthCheck.excess})</span>`;
                    return `  "${paramName}": "${paramValue}"${hasComma ? ',' : ''}${warningText}`;
                }

                // Apply universal parameter highlighting
                const highlighted = this.highlightImportantParams(paramName, paramValue);
                if (highlighted !== paramValue) {
                    return `  "${paramName}": ${highlighted}${hasComma ? ',' : ''}`;
                }
            }

            // Handle simple key-value format (fallback)
            const simpleMatch = line.match(/^([^:]+):\s*(.+)$/);
            if (simpleMatch) {
                const paramName = simpleMatch[1].trim();
                const paramValue = simpleMatch[2].trim();

                // Check GA4 parameter length limits
                const lengthCheck = checkGA4ParameterLength(paramName, paramValue, platform);
                if (lengthCheck) {
                    const cssClass = lengthCheck.severity === 'error' ? 'param-error' : 'param-warning';
                    const warningText = ` <span class="${cssClass}">${lengthCheck.current}/${lengthCheck.limit} chars (+${lengthCheck.excess})</span>`;
                    return `${paramName}: ${paramValue}${warningText}`;
                }

                // Apply universal parameter highlighting
                const highlighted = this.highlightImportantParams(paramName, paramValue);
                if (highlighted !== paramValue) {
                    return `${paramName}: ${highlighted}`;
                }
            }
            return line;
        });

        return processedLines.join('\n');
    }

    // Highlight important parameters
    static highlightImportantParams(paramName, paramValue) {
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

        // Highlight long parameters
        if (paramValue.length > 50) {
            return `<span class="long-param-value">${paramValue}</span>`;
        }

        return paramValue;
    }

    // Format event-specific data based on event type
    static formatEventData(data, eventType) {
        if (!data) return '';

        switch (eventType) {
            case 'datalayer':
                return this.formatDataLayerEvent(data);
            case 'cookie':
                return this.formatCookieEvent(data);
            case 'url_change':
                return this.formatUrlChangeEvent(data);
            case 'marketing_pixel_event':
                return this.formatMarketingPixelEvent(data);
            default:
                return this.formatGenericEvent(data);
        }
    }

    // Format generic event data
    static formatGenericEvent(data) {
        const lines = [];
        const relevantFields = ['page_url', 'referrer_url', 'client_id', 'user_id', 'session_id', 'timestamp', 'request_hash', 'event_type'];

        // Add relevant fields
        for (const field of relevantFields) {
            if (data[field]) {
                lines.push(`${field}: ${data[field]}`);
            }
        }

        // Add debug info
        if (data.debug_info) {
            lines.push('\nDebug Info:');
            lines.push(this.formatObject(data.debug_info, 2));
        }

        // Add extra info
        if (data.extra_info && Array.isArray(data.extra_info)) {
            lines.push('\nExtra Info:');
            data.extra_info.forEach(info => lines.push(`  • ${info}`));
        }

        // Add mapped data
        if (data.mapped_data && Object.keys(data.mapped_data).length > 0) {
            lines.push('\nMapped Data:');
            for (const [key, value] of Object.entries(data.mapped_data)) {
                lines.push(`  ${key}: ${value}`);
            }
        }

        // Add JavaScript endpoint info
        if (data.js_info) {
            lines.push('\nJavaScript Info:');
            lines.push(`  Type: ${data.js_info.type}`);
            lines.push(`  Description: ${data.js_info.description}`);
            if (data.js_info.pattern) {
                lines.push(`  Pattern: ${data.js_info.pattern}`);
            }
        }

        return lines.join('\n');
    }

    // Format DataLayer events
    static formatDataLayerEvent(data) {
        const lines = [];

        if (data.event_name) {
            lines.push(`Event: ${data.event_name}`);
        }

        if (data.data_layer_data) {
            lines.push('\nDataLayer Data:');
            lines.push(this.formatObject(data.data_layer_data, 2));
        } else {
            lines.push('\nDataLayer Data:');
            lines.push(this.formatObject(data, 2));
        }

        return lines.join('\n');
    }

    // Format Marketing Pixel events
    static formatMarketingPixelEvent(data) {
        const lines = [];

        if (data.platform) lines.push(`Platform: ${data.platform}`);
        if (data.pixel_id) lines.push(`Pixel ID: ${data.pixel_id}`);
        if (data.event_name) lines.push(`Event: ${data.event_name}`);
        if (data.request_method) lines.push(`Method: ${data.request_method}`);
        if (data.request_hash) lines.push(`Request Hash: ${data.request_hash}`);

        // Add platform-specific tracking parameters
        const trackingParams = this.getTrackingParams(data);
        if (trackingParams.length > 0) {
            lines.push('\nTracking Parameters:');
            trackingParams.forEach(param => lines.push(`  ${param}`));
        }

        return lines.join('\n');
    }

    // Get tracking parameters for marketing pixels
    static getTrackingParams(data) {
        const params = [];
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

        const platformParams = platformTrackingParamMap[data.platform];
        if (platformParams) {
            for (const paramName of platformParams) {
                const value = data[paramName] || data.mapped_data?.[paramName] || data.metadata?.raw_data?.[paramName];
                if (value && value.toString().trim() !== '') {
                    const displayValue = value.length > 12 ? value.substring(0, 12) + '...' : value;
                    params.push(`${paramName}: ${displayValue}`);
                } else {
                    params.push(`${paramName}: <missing>`);
                }
            }
        }

        return params;
    }

    // Format Cookie events
    static formatCookieEvent(data) {
        let html = '';

        // Basic cookie info summary in a clean header
        const summaryInfo = [];
        if (data.action) summaryInfo.push(`${data.action}`);
        if (data.cookie_type) summaryInfo.push(`${data.cookie_type}`);
        if (data.cookie_count) summaryInfo.push(`${data.cookie_count} cookies`);
        if (data.domain || data.host) summaryInfo.push(`${data.domain || data.host}`);
        if (data.path && data.path !== '/') summaryInfo.push(`${data.path}`);

        if (summaryInfo.length > 0) {
            html += `<div class="cookie-header">${summaryInfo.join(' • ')}</div>`;
        }

        // Security and tracking indicators
        const indicators = [];
        if (data.http_only_cookies_count > 0) indicators.push(`🔒 ${data.http_only_cookies_count} HttpOnly`);
        if (data.secure_cookies_count > 0) indicators.push(`🛡️ ${data.secure_cookies_count} Secure`);
        if (data.tracking_domain) indicators.push('📊 Tracking Domain');

        if (indicators.length > 0) {
            html += `<div class="cookie-indicators">${indicators.join(' • ')}</div>`;
        }

        // Client-side cookie changes
        if (data.cookie_type === 'client_side') {
            if (data.new_value !== undefined || data.old_value !== undefined) {
                html += '<div class="cookie-change">';
                if (data.old_value !== undefined && data.new_value !== undefined) {
                    html += `<div class="change-item">`;
                    html += `<span class="change-label">Changed:</span>`;
                    html += `<div class="change-values">`;
                    html += `<div class="old-value">📤 ${data.old_value || '(empty)'}</div>`;
                    html += `<div class="new-value">📥 ${data.new_value || '(empty)'}</div>`;
                    html += `</div></div>`;
                } else if (data.new_value !== undefined) {
                    html += `<div class="change-item"><span class="change-label">Set:</span> <code>${data.new_value || '(empty)'}</code></div>`;
                } else if (data.old_value !== undefined) {
                    html += `<div class="change-item"><span class="change-label">Was:</span> <code>${data.old_value || '(empty)'}</code></div>`;
                }
                html += '</div>';
            }
        }

        // Enhanced cookie details (server-side) - Card format
        if (data.detailed_cookies && Array.isArray(data.detailed_cookies) && data.detailed_cookies.length > 0) {
            html += '<div class="cookie-list">';

            data.detailed_cookies.forEach((cookie, index) => {
                html += '<div class="cookie-card">';

                // Cookie name and basic info
                html += '<div class="cookie-name-row">';
                html += `<span class="cookie-name">${cookie.name}</span>`;
                if (cookie.source) {
                    html += `<span class="cookie-source">(${cookie.source})</span>`;
                }
                html += '</div>';

                // Cookie value
                if (cookie.value) {
                    const displayValue = cookie.value.length > 50 ?
                        cookie.value.substring(0, 50) + '...' : cookie.value;
                    html += `<div class="cookie-value" title="${cookie.value}"><code>${displayValue}</code></div>`;
                } else {
                    html += `<div class="cookie-value empty">(no value)</div>`;
                }

                // Cookie properties in a clean layout
                const properties = [];
                if (cookie.domain) properties.push(`🌐 ${cookie.domain}`);
                if (cookie.path && cookie.path !== '/') properties.push(`📁 ${cookie.path}`);

                // Security attributes
                const security = [];
                if (cookie.http_only) security.push('🔒 HttpOnly');
                if (cookie.secure) security.push('🛡️ Secure');
                if (cookie.same_site && cookie.same_site !== 'None') security.push(`🔗 SameSite=${cookie.same_site}`);
                if (cookie.accessible === false) security.push('❌ Not Accessible');

                if (properties.length > 0) {
                    html += `<div class="cookie-properties">${properties.join(' • ')}</div>`;
                }

                if (security.length > 0) {
                    html += `<div class="cookie-security">${security.join(' • ')}</div>`;
                }

                // Expiration info
                if (cookie.expires) {
                    html += `<div class="cookie-expires">⏰ Expires: ${cookie.expires}</div>`;
                } else if (cookie.max_age) {
                    html += `<div class="cookie-expires">⏱️ Max-Age: ${cookie.max_age}s</div>`;
                } else {
                    html += `<div class="cookie-expires">🔄 Session cookie</div>`;
                }

                html += '</div>'; // End cookie-card
            });

            html += '</div>'; // End cookie-list
        }

        // Client-side cookie metadata - Card format
        if (data.cookie_metadata) {
            const meta = data.cookie_metadata;
            html += '<div class="cookie-metadata-card">';
            html += '<div class="metadata-header">📋 Cookie Metadata</div>';

            // Main cookie info
            html += '<div class="metadata-section">';
            html += `<div class="metadata-row"><span class="meta-label">Name:</span> <code>${meta.name}</code></div>`;
            if (meta.value) {
                const displayValue = meta.value.length > 40 ? meta.value.substring(0, 40) + '...' : meta.value;
                html += `<div class="metadata-row"><span class="meta-label">Value:</span> <code title="${meta.value}">${displayValue}</code></div>`;
            } else {
                html += `<div class="metadata-row"><span class="meta-label">Value:</span> <span class="empty-value">(empty)</span></div>`;
            }
            html += `<div class="metadata-row"><span class="meta-label">Domain:</span> ${meta.domain}</div>`;
            html += `<div class="metadata-row"><span class="meta-label">Path:</span> ${meta.path}</div>`;
            html += '</div>';

            // Security and accessibility
            const securityItems = [];
            if (meta.http_only) securityItems.push('🔒 HttpOnly');
            if (meta.secure) securityItems.push('🛡️ Secure');
            if (meta.same_site) securityItems.push(`🔗 SameSite=${meta.same_site}`);
            if (!meta.accessible) securityItems.push('❌ Not Accessible');

            if (securityItems.length > 0) {
                html += `<div class="metadata-security">${securityItems.join(' • ')}</div>`;
            }

            // Context information
            if (meta.source || meta.type || meta.user_agent || meta.referrer || meta.page_title) {
                html += '<div class="metadata-context">';
                if (meta.source) html += `<div class="context-item">📍 Source: ${meta.source}</div>`;
                if (meta.type) html += `<div class="context-item">🏷️ Type: ${meta.type}</div>`;
                if (meta.expires) html += `<div class="context-item">⏰ Expires: ${meta.expires}</div>`;
                if (meta.max_age) html += `<div class="context-item">⏱️ Max-Age: ${meta.max_age}s</div>`;
                if (meta.user_agent) html += `<div class="context-item">🌐 User-Agent: ${meta.user_agent.substring(0, 50)}...</div>`;
                if (meta.referrer) html += `<div class="context-item">🔗 Referrer: ${meta.referrer}</div>`;
                if (meta.page_title) html += `<div class="context-item">📄 Page: ${meta.page_title}</div>`;
                html += '</div>';
            }

            // Consent status
            if (meta.consent_status) {
                html += '<div class="consent-status">';
                html += '<div class="consent-header">🛡️ Consent Status</div>';
                const marketingStatus = meta.consent_status.marketing_consent ? '✅ Granted' : '❌ Not Granted';
                const bannerStatus = meta.consent_status.banner_visible ? '👁️ Visible' : '🙈 Hidden';
                const checkedStatus = meta.consent_status.consent_checked ? '✓ Checked' : '⏳ Pending';
                html += `<div class="consent-item">Marketing: ${marketingStatus}</div>`;
                html += `<div class="consent-item">Banner: ${bannerStatus}</div>`;
                html += `<div class="consent-item">Status: ${checkedStatus}</div>`;
                html += '</div>';
            }

            html += '</div>';
        }

        // Cookie list (fallback) - Clean list format
        if (data.cookies && Array.isArray(data.cookies) && data.cookies.length > 0) {
            html += '<div class="simple-cookie-list">';
            html += '<div class="list-header">🍪 Cookies</div>';
            html += '<div class="cookie-items">';

            data.cookies.forEach((cookie, index) => {
                html += `<div class="cookie-item"><span class="item-number">${index + 1}.</span> <code>${cookie}</code></div>`;
            });

            html += '</div></div>';
        }

        // Full cookie headers - Clean format
        if (data.full_cookies && Array.isArray(data.full_cookies)) {
            html += '<div class="cookie-headers-section">';
            html += '<div class="headers-title">📜 Full Cookie Headers</div>';
            html += '<div class="header-items">';

            data.full_cookies.forEach((cookie, index) => {
                html += `<div class="header-item">`;
                html += `<span class="header-number">${index + 1}.</span>`;
                html += `<code class="header-content">${cookie}</code>`;
                html += `</div>`;
            });

            html += '</div></div>';
        }

        return html || '<div class="cookie-empty">🍪 No cookie data available</div>';
    }

    // Format URL Change events
    static formatUrlChangeEvent(data) {
        const lines = [];
        
        // Basic navigation info
        const basicInfo = {
            from_url: 'From',
            previous_url: 'From',
            to_url: 'To',
            url: 'To',
            navigation_type: 'Navigation Type',
            referrer: 'Referrer',
            user_agent: 'User Agent',
            timestamp: 'Timestamp',
            source: 'Source',
            frame_id: 'Frame ID',
            page_load_id: 'Page Load ID'
        };

        const printedLabels = new Set();

        // Add basic navigation details
        for (const [key, label] of Object.entries(basicInfo)) {
            if (data[key] && !printedLabels.has(label)) {
                lines.push(`${label}: ${data[key]}`);
                printedLabels.add(label);
            }
        }

        // Add page metadata section
        const metadataFields = [];
        
        // Page title and description
        if (data.title) metadataFields.push(`📄 Title: ${data.title}`);
        if (data.description) metadataFields.push(`📝 Description: ${data.description}`);
        if (data.keywords) metadataFields.push(`🏷️ Keywords: ${data.keywords}`);
        
        // Open Graph tags
        if (data.og_title) metadataFields.push(`📱 OG Title: ${data.og_title}`);
        if (data.og_description) metadataFields.push(`📱 OG Description: ${data.og_description}`);
        if (data.og_image) metadataFields.push(`📱 OG Image: ${data.og_image}`);
        if (data.og_url) metadataFields.push(`📱 OG URL: ${data.og_url}`);
        
        // Twitter Card tags
        if (data.twitter_title) metadataFields.push(`🐦 Twitter Title: ${data.twitter_title}`);
        if (data.twitter_description) metadataFields.push(`🐦 Twitter Description: ${data.twitter_description}`);
        if (data.twitter_image) metadataFields.push(`🐦 Twitter Image: ${data.twitter_image}`);
        
        // SEO and technical metadata
        if (data.canonical_url) metadataFields.push(`🔗 Canonical URL: ${data.canonical_url}`);
        if (data.language) metadataFields.push(`🌐 Language: ${data.language}`);
        if (data.viewport) metadataFields.push(`📱 Viewport: ${data.viewport}`);
        if (data.robots) metadataFields.push(`🤖 Robots: ${data.robots}`);

        // Add metadata section if we have any
        if (metadataFields.length > 0) {
            lines.push('\n📊 Page Metadata:');
            lines.push(...metadataFields);
        }

        // Add query parameters
        const currentUrl = data.to_url || data.url;
        if (currentUrl) {
            try {
                const urlObj = new URL(currentUrl);
                const params = Array.from(urlObj.searchParams.entries());
                if (params.length > 0) {
                    lines.push('\n🔍 Query Parameters:');
                    params.forEach(([key, value]) => {
                        const displayValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
                        lines.push(`  ${key}: ${displayValue}`);
                    });
                }
            } catch (e) {
                // Invalid URL, skip parameter parsing
            }
        }

        return lines.join('\n');
    }

    // Format response information
    static formatResponseInfo(data, isError = false) {
        const lines = [];
        const responseFields = [
            { key: 'request_method', label: 'Request Method' },
            { key: 'response_type', label: 'Response Type' },
            { key: 'response_size', label: 'Response Size' },
            { key: 'content_type', label: 'Content Type' },
            { key: 'response_time', label: 'Response Time' },
            { key: 'cache_control', label: 'Cache Control' },
            { key: 'etag', label: 'ETag' }
        ];

        for (const field of responseFields) {
            if (data[field.key]) {
                lines.push(`${field.label}: ${data[field.key]}`);
            }
        }

        return lines.join('\n');
    }
}

// ===== BACKWARD COMPATIBILITY WRAPPER FUNCTIONS =====
// Note: Most wrapper functions have been removed as they were just calling EventFormatter methods
// Only keeping the ones that are actually used in the codebase

function prettyPrintNestedJson(obj, indent = 2) {
    return EventFormatter.formatObject(obj, indent);
}

function prettyPrintDetailsRaw(metadata, data = null, platform = null) {
    return EventFormatter.format('raw', data, metadata, { platform });
}

function prettyPrintDetailsFlat(data, metadata = null, isDataLayer = false, platform = null) {
    const eventType = isDataLayer ? 'datalayer' : 'generic';
    return EventFormatter.format(eventType, data, metadata, { platform });
}

function formatDataLayerAsJSON(data) {
    return EventFormatter.formatDataLayerEvent(data);
}

function formatCookieDetails(data, metadata) {
    return EventFormatter.format('cookie', data, metadata);
}

function formatUrlChangeDetails(data) {
    return EventFormatter.formatUrlChangeEvent(data);
}

function getMarketingPixelSummary(data, event) {
    const platform = data.platform || 'Unknown';
    const platformClass = getPlatformHighlightClass(data.platform);

    // Fallback to manual formatting
    let pixelId = '';
    if (data.pixel_id) {
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
    const platformClickIds = getPlatformConfig(platform, 'trackingParams') || [];
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

    const method = data.request_method ? ` <span class="method-badge">${data.request_method}</span>` : '';
    return `<span class="platform-name universal-highlight ${platformClass}">${platform}</span> <b class="event-name">event: ${event}</b>${pixelId}${gcs}${extraInfo}${clickIds}${method}`;
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
        const details = prettyPrintDetailsFlat(data, logEntry.metadata, false, data.platform);

        // Debug: Check if metadata contains request_url
        if (window.DEBUG_CUSTOM_TRACKING && logEntry.metadata) {
            console.log('Custom tracking metadata:', logEntry.metadata);
            console.log('Request URL in metadata:', logEntry.metadata.request_url);
        }

        renderMessage(summary, data.platform, icon, true, false, details);
    },

    'cookie_banner': (logEntry) => {
        const { event, data } = logEntry;
        const icon = '🍪';

        // Handle banner_detected event (includes cookie details from pre_banner_cookie_summary)
        if (event === 'banner_detected') {
            const cmpVendor = data.cmp_vendor || 'Unknown CMP';

            // Build summary with cookie info if available
            let summary = `<b>Cookie Banner Detected</b> - <span style="color: #007bff; font-weight: bold;">${cmpVendor}</span>`;

            const elementInfo = data.element_info || {};
            const position = data.position || {};
            const styling = data.styling || {};

            const details = [
                '🛡️ Cookie Banner Analysis:',
                `CMP Vendor: ${cmpVendor}`,

                `Detection Method: ${data.detection_method || 'Unknown'}`,
                `Element: ${elementInfo.tagName || data.tag || 'Unknown'} ${elementInfo.id || data.id ? `#${elementInfo.id || data.id}` : ''} ${elementInfo.className || data.classes ? `.${elementInfo.className || data.classes}` : ''}`,
                `Position: ${Math.round(position.left || data.bounding_rect?.left || 0)}, ${Math.round(position.top || data.bounding_rect?.top || 0)} (${Math.round(position.width || data.bounding_rect?.width || 0)}×${Math.round(position.height || data.bounding_rect?.height || 0)})`,
                `Styling: ${styling.position || data.position || 'static'}, z-index: ${styling.zIndex || data.z_index || 'auto'}`,
                `Text Length: ${elementInfo.textLength || (data.text_preview || '').length || 0} characters`,
                `Text Snippet: "${data.text_snippet || data.text_preview || 'No text'}"`,
                `Page URL: ${data.page_url || data.url || 'Unknown'}`,
                `Viewport: ${data.viewport?.width || 0}×${data.viewport?.height || 0}`
            ];

            // Add cookie analysis if available in the data
            const totalCookies = data.total_cookies || 0;
            const marketingCount = data.marketing_cookies_count || 0;
            const nonMarketingCount = data.non_marketing_cookies_count || 0;

            if (totalCookies > 0) {
                const marketingColor = marketingCount > 0 ? '#ef4444' : '#22c55e';
                summary += ` - <span style="color: ${marketingColor}; font-weight: bold;">${totalCookies} cookies</span> (<span style="color: #ef4444;">${marketingCount} marketing</span>)`;

                details.push(
                    '',
                    '🍪 Cookie Analysis:',
                    `Total Cookies Found: ${totalCookies}`,
                    `Marketing Cookies: ${marketingCount}`,
                    `Non-Marketing Cookies: ${nonMarketingCount}`
                );

                // Add marketing cookies section
                if (data.marketing_cookies && data.marketing_cookies.length > 0) {
                    details.push('', '🚨 Marketing Cookies (Potential GDPR Violation):');
                    data.marketing_cookies.forEach(cookie => {
                        const riskIndicator = cookie.banner_visible ? ' ⚠️ [BANNER VISIBLE]' : '';
                        const action = cookie.action || 'unknown';
                        details.push(`  • <span class="cookie-name">${cookie.name}</span> (${action})${riskIndicator}`);
                        if (cookie.domain) details.push(`    Domain: ${cookie.domain}`);
                        if (cookie.path) details.push(`    Path: ${cookie.path}`);
                    });
                }

                // Add non-marketing cookies section
                if (data.non_marketing_cookies && data.non_marketing_cookies.length > 0) {
                    details.push('', '✅ Non-Marketing Cookies:');
                    data.non_marketing_cookies.forEach(cookie => {
                        const action = cookie.action || 'unknown';
                        details.push(`  • <span class="cookie-name">${cookie.name}</span> (${action})`);
                        if (cookie.domain) details.push(`    Domain: ${cookie.domain}`);
                        if (cookie.path) details.push(`    Path: ${cookie.path}`);
                    });
                }

                // Add compliance warning if marketing cookies found
                if (marketingCount > 0) {
                    details.push('', '⚠️  COMPLIANCE WARNING:');
                    details.push('Marketing cookies were set before the consent banner appeared.');
                    details.push('This may constitute a GDPR violation if user consent was not obtained.');
                }

                // Add full cookie details if available
                if (data.all_cookies && data.all_cookies.length > 0) {
                    details.push('', '📋 Complete Cookie Details:');
                    data.all_cookies.forEach((cookie, index) => {
                        details.push(`${index + 1}. ${cookie.name}`);
                        details.push(`   Action: ${cookie.action || 'unknown'}`);
                        details.push(`   Type: ${cookie.type || 'unknown'}`);
                        details.push(`   Source: ${cookie.source || 'unknown'}`);
                        if (cookie.domain) details.push(`   Domain: ${cookie.domain}`);
                        if (cookie.path) details.push(`   Path: ${cookie.path}`);
                        if (cookie.is_marketing !== undefined) details.push(`   Marketing: ${cookie.is_marketing ? 'Yes' : 'No'}`);
                        if (cookie.banner_visible !== undefined) details.push(`   Banner Visible: ${cookie.banner_visible ? 'Yes' : 'No'}`);
                        if (cookie.timestamp) details.push(`   Timestamp: ${new Date(cookie.timestamp * 1000).toLocaleString()}`);
                        details.push('');
                    });
                }
            }

            renderMessage(summary, 'cookie_banner', icon, true, false, details.join('\n'));

        } else {
            // Generic cookie banner event handler
            const summary = `Cookie Banner: ${event}`;
            const details = prettyPrintDetailsFlat(data, logEntry.metadata, false);
            renderMessage(summary, 'cookie_banner', icon, false, false, details);
        }
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
        
        // URL display logic removed

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

    'marketing_pixel_event': (logEntry) => {
        const { event, data } = logEntry;
        const icon = getPlatformIcon(data.platform);
        const summary = getMarketingPixelSummary(data, event);

        // Debug logging for sGTM events
        if (data.platform === 'sGTM' || data.platform === 'Server-side GTM') {
            console.log('sGTM event detected:', {
                platform: data.platform,
                event: event,
                metadata: logEntry.metadata,
                hasRawData: !!(logEntry.metadata && logEntry.metadata.raw_data)
            });
        }

        // URL display logic removed

        const details = prettyPrintDetailsFlat(data, logEntry.metadata, false, data.platform);
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
        const icon = CONFIG.typeIconMap.datalayer;
        // event unknown
        const summary = event === 'unknown' ? 'DataLayer Object - expand for details' : `DataLayer Event: <b>${event}</b>`;;

        const details = formatDataLayerAsJSON(data) + (logEntry.metadata ? `\n\nMetadata:\n${prettyPrintDetailsRaw(logEntry.metadata)}` : '');
        renderMessage(summary, 'DataLayer', icon, false, false, details);
    },

    'consent': (logEntry) => {
        const { event, data } = logEntry;
        const icon = CONFIG.typeIconMap.consent || '🛡️';

        // Handle other consent events
        const summary = `Consent <b>${event}</b>`;
        const details = JSON.stringify(data, null, 2);
        renderMessage(summary, 'consent', icon, false, false, details);

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
        
        // URL display logic removed

        const details = formatUrlChangeDetails(data) + (logEntry.metadata ? `\n\nMetadata:\n${prettyPrintDetailsRaw(logEntry.metadata)}` : '');

        // URL changes appear in chronological order but with special separator styling
        renderMessage(summary, 'url_change', icon, true, true, details, 'url-change-separator');
    },

    'request_status_update': (logEntry) => {
        updateRequestStatus(logEntry.data);
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
    const messages = DOM.contentMessages.querySelectorAll('.message');
    const targetMessage = findTargetMessage(messages, data);

    if (!targetMessage) return;

    const messageTextEl = targetMessage.querySelector('.message-text');
    const detailsEl = targetMessage.querySelector('.message-details');

    // Handle JavaScript endpoint platform correction
    if (data.javascript_endpoint && data.platform) {
        targetMessage.setAttribute('data-type', 'javascript_endpoint');

        // Update the platform in the message
        const platformElement = targetMessage.querySelector('.platform-name');

        if (platformElement) {
            platformElement.textContent = "Javascript Library"
            platformElement.className = `platform-name universal-highlight universal-highlight-${data.platform.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        }

        // Update the event name if it's a generic one
        const eventElement = targetMessage.querySelector('.event-name');
        if (eventElement && (eventElement.textContent.includes('not defined') || eventElement.textContent.includes('Custom Platform'))) {
            const description = data.js_description || 'JavaScript Endpoint';
            eventElement.textContent = `event: ${description}`;
        }
    }

    if (!data.success) {
        // Handle failed requests
        if (messageTextEl && !hasStatusIcon(messageTextEl.textContent)) {
            messageTextEl.innerHTML += ` ❌`;

            if (detailsEl) {
                let statusInfo = `\n\n--- Request Failed ---\nStatus: ${data.status_code || 'Unknown'}`;
                if (data.method) statusInfo += `\nMethod: ${data.method}`;
                if (data.request_method) statusInfo += `\nRequest Method: ${data.request_method}`;

                const requestUrl = data.request_url || data.url;
                if (requestUrl) statusInfo += `\nRequest URL:\n${requestUrl}`;

                if (data.error_details) statusInfo += `\nError: ${data.error_details}`;
                if (data.response_status) statusInfo += `\nResponse Status: ${data.response_status}`;

                statusInfo += EventFormatter.formatResponseInfo(data, true);

                if (window.DEBUG_RESPONSE_STATUS) {
                    console.log('Request status data:', data);
                }

                detailsEl.textContent += statusInfo;
            }
        }
    } else if (hasResponseInfo(data)) {
        // Handle successful requests with response info
        if (detailsEl && !detailsEl.textContent.includes('--- Response Info')) {
            let responseInfo = `\n\n--- Response Info   ---\nStatus: ${data.status_code} (Success)`;
            
            // Check if we already have response info for this specific status code and content type
            const statusPattern = `Status: ${data.status_code} \\(Success\\)`;
            const contentTypePattern = data.content_type ? `Content Type: ${data.content_type}` : '';
            
            // Count existing response info entries
            const existingResponseInfoCount = (detailsEl.textContent.match(/--- Response Info/g) || []).length;
            
            // If we already have 3 or more response info entries, don't add more
            if (existingResponseInfoCount >= 3) {
                return; // Skip adding more response info to prevent spam
            }
            
            // Check for exact duplicate (same status and content type)
            if (contentTypePattern) {
                const exactDuplicate = detailsEl.textContent.includes(statusPattern) && 
                                     detailsEl.textContent.includes(contentTypePattern);
                if (exactDuplicate) {
                    return; // Skip exact duplicate
                }
            }

            // Add JavaScript-specific information if this is a JS endpoint
            if (data.javascript_endpoint) {
                responseInfo += `\nJavaScript Endpoint: ${data.js_description || 'JavaScript Library'}`;
                if (data.response_content) {
                    responseInfo += `\nJavaScript Content:\n\`\`\`javascript\n${data.response_content}\n\`\`\``;
                }
            }

            responseInfo += EventFormatter.formatResponseInfo(data, false);
            detailsEl.textContent += responseInfo;
        }
    }

    // Re-apply filter after updating the message type
    if (data.javascript_endpoint) {
        applyFilter();
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

    // Add timestamp to details - support HTML content
    let detailsWithTimestamp;
    if (details) {
        // Check if details contains HTML (has < and > characters)
        const isHtml = details.includes('<') && details.includes('>');
        if (isHtml) {
            detailsWithTimestamp = `<div class="timestamp-header">Timestamp: ${timestampWithMillis}</div><div class="details-content">${details}</div>`;
        } else {
            detailsWithTimestamp = `Timestamp: ${timestampWithMillis}\n\n${details}`;
        }
    } else {
        detailsWithTimestamp = `Timestamp: ${timestampWithMillis}`;
    }

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

    DOM.contentMessages.appendChild(msg);
    if (shouldShow && !userInteracting) {
        msg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}


function attachExpandHandler(msg) {
    msg.addEventListener('click', function (e) {
        // Don't close if clicking on the details content (allows text selection)
        if (e.target.closest('.message-details')) {
            return;
        }
        
        const details = this.querySelector('.message-details');
        if (details) {
            const isHidden = details.style.display === 'none' || details.style.display === '';
            details.style.display = isHidden ? 'block' : 'none';
        }
    });
}

// ===== NAVIGATION & PAGINATION =====
function getVisiblePageSeparators() {
    return Array.from(DOM.contentMessages.querySelectorAll('.page-separator'));
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
    const containerTop = DOM.contentMessages.scrollTop;
    const containerHeight = DOM.contentMessages.clientHeight;
    const viewportCenter = containerTop + containerHeight / 2;

    for (let i = separators.length - 1; i >= 0; i--) {
        if (separators[i].offsetTop <= viewportCenter) {
            return i;
        }
    }
    return 0;
}

// ===== CURRENT PAGE UTILITIES =====
// URL display logic removed

// URL display functions removed

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
        { element: DOM.showJavaScriptEndpointsToggle, setting: 'showJavaScriptEndpoints' },
        { element: DOM.searchAllContentToggle, setting: 'searchAllContent' }
    ];

    toggleMappings.forEach(({ element, setting }) => {
        if (element) {
            element.checked = settings[setting];
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
    const platformSearchText = document.getElementById('platformFilterInput')?.value.toLowerCase() || '';
    const messages = DOM.contentMessages.querySelectorAll('.message');

    messages.forEach(msg => {
        const messageType = msg.getAttribute('data-type');
        
        // Get text to search based on setting
        let messageText = '';
        if (settings.searchAllContent) {
            // Search all content (summary + details)
            messageText = msg.textContent.toLowerCase();
        } else {
            // Search only summary
            const messageTextEl = msg.querySelector('.message-text');
            messageText = messageTextEl ? messageTextEl.textContent.toLowerCase() : '';
        }

        const isUrlChange = messageType === 'url_change' || messageType === 'URLChange';
        const typeVisible = checkMessageVisibility(messageType);
        const textMatch = !filterText || messageText.includes(filterText);

        // Show if it's a URL change, OR if it's a visible type that matches the content filter.
        // Platform search doesn't affect visibility, only highlighting.
        const shouldShow = isUrlChange || (typeVisible && textMatch);
        msg.style.display = shouldShow ? 'block' : 'none';
        
        // Apply content search highlighting if there's a filter text
        if (filterText && shouldShow) {
            highlightSearchText(msg, filterText);
        } else {
            removeSearchHighlighting(msg);
        }
        
        // Apply platform search highlighting (works on all visible messages)
        if (platformSearchText && shouldShow) {
            highlightPlatformText(msg, platformSearchText);
        } else {
            removePlatformHighlighting(msg);
        }
    });

    updateNavigationButtons();
    
    // Update search navigation
    findSearchResults();
}

// ===== SEARCH HIGHLIGHTING =====
function highlightSearchText(messageElement, searchText) {
    // Remove existing highlights first
    removeSearchHighlighting(messageElement);
    
    if (!searchText) return;
    
    // Highlight in message text
    const messageTextEl = messageElement.querySelector('.message-text');
    if (messageTextEl) {
        highlightTextInElement(messageTextEl, searchText);
    }
    
    // Highlight in details if search all content is enabled
    if (settings.searchAllContent) {
        const detailsEl = messageElement.querySelector('.message-details');
        if (detailsEl) {
            highlightTextInElement(detailsEl, searchText);
        }
    }
}

function highlightTextInElement(element, searchText) {
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    
    textNodes.forEach(textNode => {
        const text = textNode.textContent;
        const lowerText = text.toLowerCase();
        const searchIndex = lowerText.indexOf(searchText.toLowerCase());
        
        if (searchIndex !== -1) {
            const beforeText = text.substring(0, searchIndex);
            const matchText = text.substring(searchIndex, searchIndex + searchText.length);
            const afterText = text.substring(searchIndex + searchText.length);
            
            const fragment = document.createDocumentFragment();
            
            if (beforeText) {
                fragment.appendChild(document.createTextNode(beforeText));
            }
            
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'search-highlight';
            highlightSpan.textContent = matchText;
            fragment.appendChild(highlightSpan);
            
            if (afterText) {
                fragment.appendChild(document.createTextNode(afterText));
            }
            
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    });
}

function removeSearchHighlighting(messageElement) {
    // Remove existing search highlights
    const highlights = messageElement.querySelectorAll('.search-highlight');
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize(); // Merge adjacent text nodes
    });
}

// ===== PLATFORM SEARCH HIGHLIGHTING =====
function highlightPlatformText(messageElement, platformText) {
    // Remove existing platform highlights first
    removePlatformHighlighting(messageElement);
    
    if (!platformText) return;
    
    // Highlight platform names in message type attribute
    const messageType = messageElement.getAttribute('data-type');
    if (messageType && messageType.toLowerCase().includes(platformText.toLowerCase())) {
        // Add a visual indicator to the message
        messageElement.classList.add('platform-match');
    }
    
    // Highlight platform names in the message content
    const messageTextEl = messageElement.querySelector('.message-text');
    if (messageTextEl) {
        highlightPlatformInElement(messageTextEl, platformText);
    }
    
    // Highlight platform names in details if search all content is enabled
    if (settings.searchAllContent) {
        const detailsEl = messageElement.querySelector('.message-details');
        if (detailsEl) {
            highlightPlatformInElement(detailsEl, platformText);
        }
    }
}

function highlightPlatformInElement(element, platformText) {
    const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
        textNodes.push(node);
    }
    
    textNodes.forEach(textNode => {
        const text = textNode.textContent;
        const lowerText = text.toLowerCase();
        const searchIndex = lowerText.indexOf(platformText.toLowerCase());
        
        if (searchIndex !== -1) {
            const beforeText = text.substring(0, searchIndex);
            const matchText = text.substring(searchIndex, searchIndex + platformText.length);
            const afterText = text.substring(searchIndex + platformText.length);
            
            const fragment = document.createDocumentFragment();
            
            if (beforeText) {
                fragment.appendChild(document.createTextNode(beforeText));
            }
            
            const highlightSpan = document.createElement('span');
            highlightSpan.className = 'platform-highlight';
            highlightSpan.textContent = matchText;
            fragment.appendChild(highlightSpan);
            
            if (afterText) {
                fragment.appendChild(document.createTextNode(afterText));
            }
            
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    });
}

function removePlatformHighlighting(messageElement) {
    // Remove platform match class
    messageElement.classList.remove('platform-match');
    
    // Remove existing platform highlights
    const highlights = messageElement.querySelectorAll('.platform-highlight');
    highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize(); // Merge adjacent text nodes
    });
}

// ===== SEARCH NAVIGATION FUNCTIONS =====
function findSearchResults() {
    const filterText = document.getElementById('filterInput')?.value.toLowerCase() || '';
    const platformSearchText = document.getElementById('platformFilterInput')?.value.toLowerCase() || '';
    
    console.log(`Finding search results: filterText="${filterText}", platformSearchText="${platformSearchText}"`);
    
    // Only update search results if search text changed
    if (filterText !== lastSearchText || platformSearchText !== lastPlatformSearchText) {
        searchResults = [];
        currentSearchIndex = -1;
        lastSearchText = filterText;
        lastPlatformSearchText = platformSearchText;
        
        if (!filterText && !platformSearchText) {
            clearSearchNavigation();
            return;
        }
        
        const messages = DOM.contentMessages.querySelectorAll('.message');
        console.log(`Checking ${messages.length} messages for search matches`);
        
        messages.forEach((msg, msgIndex) => {
            // Only check visible messages
            if (msg.style.display === 'none') {
                return;
            }
            
            const messageText = msg.textContent.toLowerCase();
            const messageType = msg.getAttribute('data-type')?.toLowerCase() || '';
            let hasMatch = false;
            let matchType = '';
            
            // Check content filter match (from left input)
            if (filterText && messageText.includes(filterText)) {
                hasMatch = true;
                matchType = 'content';
            }
            
            // Check platform search match (from right input)
            if (platformSearchText && (messageText.includes(platformSearchText) || messageType.includes(platformSearchText))) {
                hasMatch = true;
                matchType = matchType ? 'both' : 'platform';
            }
            
            if (hasMatch) {
                searchResults.push({
                    element: msg,
                    index: msgIndex,
                    type: matchType,
                    text: messageText.substring(0, 100) // For debugging
                });
                console.log(`Found match #${searchResults.length}: type=${matchType}, msgIndex=${msgIndex}`);
            }
        });
        
        console.log(`Total search results found: ${searchResults.length}`);
        
        // Auto-select first result if we have results
        if (searchResults.length > 0) {
            currentSearchIndex = 0;
            searchResults[0].element.classList.add('current-search-result');
            // Use a slight delay to ensure DOM is ready
            setTimeout(() => {
                scrollToSearchResult(searchResults[0].element);
            }, 50);
        }
    }
    
    updateSearchNavigationButtons();
}

function updateSearchNavigationButtons() {
    if (!DOM.prevSearchBtn || !DOM.nextSearchBtn) {
        console.warn('Search navigation buttons not found in DOM');
        return;
    }
    
    if (searchResults.length === 0) {
        DOM.prevSearchBtn.disabled = true;
        DOM.nextSearchBtn.disabled = true;
        DOM.prevSearchBtn.classList.remove('active');
        DOM.nextSearchBtn.classList.remove('active');
        console.log('Search navigation buttons disabled - no results');
        return;
    }
    
    DOM.prevSearchBtn.disabled = false;
    DOM.nextSearchBtn.disabled = false;
    
    if (currentSearchIndex >= 0) {
        DOM.prevSearchBtn.classList.add('active');
        DOM.nextSearchBtn.classList.add('active');
        console.log(`Search navigation buttons active - ${currentSearchIndex + 1}/${searchResults.length}`);
    } else {
        DOM.prevSearchBtn.classList.remove('active');
        DOM.nextSearchBtn.classList.remove('active');
        console.log('Search navigation buttons ready - no current selection');
    }
}

function navigateToSearchResult(direction) {
    console.log(`Navigating ${direction}, searchResults.length: ${searchResults.length}`);
    
    if (searchResults.length === 0) {
        console.log('No search results to navigate');
        return;
    }
    
    // Remove previous highlight
    if (currentSearchIndex >= 0 && currentSearchIndex < searchResults.length) {
        const prevResult = searchResults[currentSearchIndex];
        prevResult.element.classList.remove('current-search-result');
    }
    
    if (direction === 'next') {
        currentSearchIndex = currentSearchIndex >= searchResults.length - 1 ? 0 : currentSearchIndex + 1;
    } else {
        currentSearchIndex = currentSearchIndex <= 0 ? searchResults.length - 1 : currentSearchIndex - 1;
    }
    
    console.log(`Current search index: ${currentSearchIndex}`);
    
    // Highlight current result
    const currentResult = searchResults[currentSearchIndex];
    currentResult.element.classList.add('current-search-result');
    
    // Check if the current result has collapsed details and expand them for better visibility
    const detailsElement = currentResult.element.querySelector('.message-details');
    if (detailsElement && (detailsElement.style.display === 'none' || detailsElement.style.display === '')) {
        console.log('Expanding details for better search result visibility');
        detailsElement.style.display = 'block';
        
        // Scroll after a brief delay to allow for expansion
        setTimeout(() => {
            scrollToSearchResult(currentResult.element);
        }, 100);
    } else {
        // Enhanced scrolling logic
        scrollToSearchResult(currentResult.element);
    }
    
    updateSearchNavigationButtons();
}

function scrollToSearchResult(element) {
    const contentContainer = DOM.contentMessages;
    
    if (!contentContainer || !element) {
        console.warn('Content container or element not found for scrolling');
        return;
    }
    
    try {
        // Enhanced scrolling that handles expanded details
        const scrollToElement = () => {
            // Get the current scroll position and container info
            const containerRect = contentContainer.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            
            console.log('Container rect:', containerRect);
            console.log('Element rect:', elementRect);
            
            // Check if element is already fully visible
            const elementTop = elementRect.top - containerRect.top;
            const elementBottom = elementRect.bottom - containerRect.top;
            const containerHeight = containerRect.height;
            
            const isFullyVisible = elementTop >= 0 && elementBottom <= containerHeight;
            
            if (!isFullyVisible) {
                // Calculate the scroll position to center the element
                // We need to find the element's position relative to the content container's scroll
                const currentScrollTop = contentContainer.scrollTop;
                const elementOffsetFromTop = elementRect.top - containerRect.top;
                const targetScrollTop = currentScrollTop + elementOffsetFromTop - (containerHeight / 2) + (elementRect.height / 2);
                
                console.log(`Scrolling: currentScrollTop=${currentScrollTop}, elementOffsetFromTop=${elementOffsetFromTop}, targetScrollTop=${targetScrollTop}`);
                
                contentContainer.scrollTo({
                    top: Math.max(0, targetScrollTop),
                    behavior: 'smooth'
                });
            } else {
                console.log('Element is already fully visible');
            }
        };
        
        // Try immediate scroll first
        scrollToElement();
        
        // If the element has details that might be expanding, wait and try again
        const hasDetails = element.querySelector('.message-details');
        if (hasDetails) {
            // Wait for any animations or expansions to complete
            setTimeout(() => {
                scrollToElement();
            }, 300);
        }
        
    } catch (error) {
        console.error('Error scrolling to search result:', error);
        // Final fallback - use native scrollIntoView
        try {
            element.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'center',
                inline: 'nearest'
            });
        } catch (fallbackError) {
            console.error('Fallback scrolling also failed:', fallbackError);
        }
    }
}

function clearSearchNavigation() {
    // Remove all current search result highlights
    document.querySelectorAll('.current-search-result').forEach(el => {
        el.classList.remove('current-search-result');
    });
    
    searchResults = [];
    currentSearchIndex = -1;
    lastSearchText = '';
    lastPlatformSearchText = '';
    updateSearchNavigationButtons();
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
        'javascript_endpoint': settings.showJavaScriptEndpoints,
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
    const emptyState = DOM.contentMessages.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    if (message.startsWith('[STRUCTURED] ')) {
        try {
            const logEntry = JSON.parse(message.substring(13));
            console.log('📨 Structured log entry:', logEntry);

            if (logEntry.type && logEntry.event && logEntry.data) {
                // Check for consent_update events specifically
                if (logEntry.type === 'consent' && logEntry.event === 'consent_update') {
                    const consentData = logEntry.data.data_layer_data || logEntry.data;
                    console.log('🎯 Extracted consent data:', consentData);
                    checkConsentInDataLayer(consentData);
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
        DOM.contentMessages.querySelectorAll('.message-details').forEach(details => {
            details.style.display = allExpanded ? 'block' : 'none';
        });
        DOM.toggleDetailsBtn.textContent = allExpanded ? 'Collapse All' : 'Expand All';
    });

    // Clear output
    document.getElementById('clearOutputBtn')?.addEventListener('click', () => {
        DOM.contentMessages.innerHTML = `<div class="empty-state">
            <div class="empty-icon">📊</div>
            <div>Waiting for GA4 and marketing pixel events...</div>
            <div class="empty-state-description">Events from GA4, Facebook, TikTok, Snapchat, Pinterest, LinkedIn, Twitter/X, Microsoft, Amazon, Criteo, Reddit, Quora, Outbrain, Taboola, sGTM, Adobe Analytics, Segment, Mixpanel, URL changes, and Custom Tracking will appear here</div>
        </div>`;
        // Clear current page info and recreate consent header after clearing
        // URL display logic removed
        updateConsentStatusHeader();
    });

    // Settings toggles with unified handlers
    const settingsToggles = [
        { element: DOM.showServerCookiesToggle, setting: 'showServerCookies' },
        { element: DOM.showClientCookiesToggle, setting: 'showClientCookies' },
        { element: DOM.showDataLayerToggle, setting: 'showDataLayer' },
        { element: DOM.showInfoToggle, setting: 'showInfo' },
        { element: DOM.showJavaScriptEndpointsToggle, setting: 'showJavaScriptEndpoints' },
        { element: DOM.searchAllContentToggle, setting: 'searchAllContent' }
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

    DOM.contentMessages?.addEventListener('scroll', () => {
        updateNavigationButtons();
    });

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
        
        // Search navigation shortcuts
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (e.shiftKey) {
                navigateToSearchResult('prev');
            } else {
                navigateToSearchResult('next');
            }
        }
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

    // Filter inputs
    DOM.filterInput?.addEventListener('input', applyFilter);
    DOM.platformFilterInput?.addEventListener('input', applyFilter);
    
    // Clear button event listeners
    DOM.clearFilterBtn?.addEventListener('click', () => {
        if (DOM.filterInput) {
            DOM.filterInput.value = '';
            DOM.filterInput.focus();
            applyFilter();
        }
    });
    
    DOM.clearPlatformFilterBtn?.addEventListener('click', () => {
        if (DOM.platformFilterInput) {
            DOM.platformFilterInput.value = '';
            DOM.platformFilterInput.focus();
            applyFilter();
        }
    });
    
    // Search navigation
    if (DOM.prevSearchBtn) {
        DOM.prevSearchBtn.addEventListener('click', () => {
            console.log('Previous search button clicked');
            navigateToSearchResult('prev');
        });
        console.log('Previous search button event listener attached');
    } else {
        console.warn('Previous search button not found');
    }
    
    if (DOM.nextSearchBtn) {
        DOM.nextSearchBtn.addEventListener('click', () => {
            console.log('Next search button clicked');
            navigateToSearchResult('next');
        });
        console.log('Next search button event listener attached');
    } else {
        console.warn('Next search button not found');
    }
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
    
    // Initialize search navigation
    updateSearchNavigationButtons();

    connect();
}

// Start the application
init().catch(console.error);