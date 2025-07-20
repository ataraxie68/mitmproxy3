// ===== GLOBAL STATE =====
let ws, reconnectAttempts = 0, allExpanded = false;
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

// ===== UTILITY FUNCTIONS =====
function updateStatus(message, type = 'info') {
    DOM.status.textContent = message;
    DOM.status.style.color = CONFIG.statusColors[type];
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
    if (platform !== 'GA4' || !paramValue) return null;
    
    const limit = CONFIG.ga4Limits[paramName] || CONFIG.ga4Limits.custom_parameter;
    const current = paramValue.length;
    
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

            if (platform === 'GA4') {
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
    // Use JSON.stringify for robust, recursive pretty-printing of objects.
    return JSON.stringify(obj, null, indent);
}

function prettyPrintDetailsRaw(metadata, data = null) {
    let out = '';
    if (metadata) {
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
    }
    if (data) {
        out += `Data:\n${prettyPrintNestedJson(data, 1)}`;
    }
    return out;
}

function prettyPrintDetailsFlat(data, metadata = null, isDataLayer = false) {
    let out = '';
    const relevantFields = ['page_url', 'referrer_url', 'client_id', 'user_id', 'session_id', 'timestamp'];
    
    if (isDataLayer) {
        out += formatDataLayerDetails(data);
    } else {
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
        
        if (data.extra_info && Array.isArray(data.extra_info)) {
            out += `Extra Info:\n${data.extra_info.map(info => `  • ${info}`).join('\n')}\n`;
        }
        
        if (data.mapped_data && Object.keys(data.mapped_data).length > 0) {
            out += `Mapped Data:\n`;
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
    
    // Add metadata information if available
    if (metadata) {
        if (metadata.request_url) out += `\nRequest URL: ${metadata.request_url}\n`;
        if (metadata.raw_data) {
            const rawDataForDisplay = { ...metadata.raw_data };
            delete rawDataForDisplay._request_path; // Remove redundant key
            delete rawDataForDisplay._request_host;
            out += `\nRaw Data:\n${prettyPrintNestedJson(rawDataForDisplay, 1)}`;
        }
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
    
    if (data.path) out += `Path: ${data.path}\n`;
    if (data.cookie_type) out += `Type: ${data.cookie_type}\n`;
    if (data.cookie_count) out += `Count: ${data.cookie_count}\n`;
    
    if (data.cookies && Array.isArray(data.cookies)) {
        out += `\nCookies:\n`;
        data.cookies.forEach((cookie, index) => {
            out += `  ${index + 1}. ${cookie}\n`;
        });
    }
    
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
    
    // Check if we have highlighting info with pre-formatted text
    if (data.highlight_info && data.highlight_info.should_highlight && data.highlight_info.highlight_text) {
        const platformClass = getPlatformHighlightClass(data.platform);
        // Use the pre-formatted highlight text from Python (which already includes platform, event, and pixel_id)
        return `<span class="universal-highlight ${platformClass}">${data.highlight_info.highlight_text}</span>`;
    }
    
    // Fallback to manual formatting
    let pixelId = '';
    if (data.pixel_id) {
        const platformClass = getPlatformHighlightClass(data.platform);
        pixelId = ` <span class="pixel-id universal-highlight ${platformClass}">${data.pixel_id}</span>`;
    }

    return `<span class="platform-name">${platform}</span> <b class="event-name">${event}</b>${pixelId}`;
}

// ===== MESSAGE HANDLING =====
const messageHandlers = {
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
        const icon = CONFIG.typeIconMap.datalayer;
        const summary = `DataLayer <b>${event}</b>`;
        const details = formatDataLayerAsJSON(data) + (logEntry.metadata ? `\n\nMetadata:\n${prettyPrintDetailsRaw(logEntry.metadata)}` : '');
        renderMessage(summary, 'DataLayer', icon, false, false, details);
    },
    
    'cookie': (logEntry) => {
        const { data } = logEntry;
        const icon = CONFIG.typeIconMap.cookie;
        const summary = `Cookie <b>Set</b>: ${data.cookies?.join(', ') || 'Unknown'}`;
        const details = formatCookieDetails(data, logEntry.metadata);
        const cookieType = data.cookie_type === 'tracking' ? 'ServerCookie' : 'ClientCookie';
        renderMessage(summary, cookieType, icon, false, false, details);
    },
    
    'url_change': (logEntry) => {
        const { event, data } = logEntry;
        const icon = CONFIG.typeIconMap.url_change;
        
        // Create prominent summary with new URL (no extra link icon)
        const newUrl = data.to_url || data.url || 'Unknown URL';
        const summary = `<b>Page Navigation</b> → ${newUrl}`;
        
        const details = formatUrlChangeDetails(data) + (logEntry.metadata ? `\n\nMetadata:\n${prettyPrintDetailsRaw(logEntry.metadata)}` : '');
        
        // Keep consistent type naming with Python side
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
        handler(logEntry);
    } else {
        // Generic handler for unknown types
        const icon = CONFIG.typeIconMap[type] || CONFIG.typeIconMap.info;
        const summary = `${type}: ${event}`;
        const details = prettyPrintDetailsRaw(logEntry.metadata, data);
        renderMessage(summary, type, icon, false, false, details);
    }
}

function updateRequestStatus(data) {
    const messages = DOM.content.querySelectorAll('.message');
    let targetMessage = null;

    // Look for the most recent marketing pixel event from the same platform
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const messageType = msg.getAttribute('data-type');
        const messageText = msg.querySelector('.message-text')?.textContent || '';

        // Match marketing pixel events OR error messages from the same platform
        const isExactPlatformMatch = messageType.toLowerCase() === data.platform.toLowerCase();
        const isErrorFromPlatform = messageType.toLowerCase() === 'error' && 
                                   messageText.toLowerCase().includes(data.platform.toLowerCase());
        const isNotStatusMessage = !messageText.includes('Request') && !messageText.includes('✅') && !messageText.includes('❌');
        const isRecentMessage = true; // We're looking from newest to oldest
        
        if ((isExactPlatformMatch || isErrorFromPlatform) && isNotStatusMessage && isRecentMessage) {
            targetMessage = msg;
            break;
        }
    }
    
    if (targetMessage) {
        // Show status icon when request failed OR add response info for successful JavaScript endpoints
        const hasResponseInfo = data.response_type || data.response_size;
        
        if (!data.success) {
            const statusIcon = '❌';
            const messageTextEl = targetMessage.querySelector('.message-text');
            if (messageTextEl) {
                // Only add status if it doesn't already have one
                if (!messageTextEl.textContent.includes('✅') && !messageTextEl.textContent.includes('❌')) {
                    messageTextEl.innerHTML += ` ${statusIcon}`;
                    
                    // Add detailed error info to details
                    const detailsEl = targetMessage.querySelector('.message-details');
                    if (detailsEl) {
                        let statusInfo = `\n\n--- Request Failed ---\nStatus: ${data.status_code || 'Unknown'}`;
                        if (data.method) statusInfo += `\nMethod: ${data.method}`;
                        
                        // Ensure the complete request URL is displayed
                        const requestUrl = data.request_url || data.url;
                        if (requestUrl) {
                            statusInfo += `\nRequest URL:\n${requestUrl}`;
                        }
                        
                        if (data.error_details) statusInfo += `\nError: ${data.error_details}`;
                        if (data.response_status) statusInfo += `\nResponse Status: ${data.response_status}`;
                        
                        // Add response information (JavaScript detection, size, etc.)
                        if (data.response_type) {
                            statusInfo += `\nResponse Type: ${data.response_type}`;
                        }
                        if (data.response_size) {
                            statusInfo += `\nResponse Size: ${data.response_size}`;
                        }
                        
                        // Debug: log the data to see what we're getting
                        console.log('Request status data:', data);
                        
                        detailsEl.textContent += statusInfo;
                    }
                }
            }
        } else if (hasResponseInfo) {
            // For successful requests with response info (like JavaScript endpoints), add details without icon
            const detailsEl = targetMessage.querySelector('.message-details');
            if (detailsEl && !detailsEl.textContent.includes('--- Response Info ---')) {
                let responseInfo = `\n\n--- Response Info ---`;
                if (data.response_type) {
                    responseInfo += `\nResponse Type: ${data.response_type}`;
                }
                if (data.response_size) {
                    responseInfo += `\nResponse Size: ${data.response_size}`;
                }
                responseInfo += `\nStatus: ${data.status_code} (Success)`;
                
                detailsEl.textContent += responseInfo;
            }
        }
        // Other successful requests remain silent
    }
    // If no matching message found, don't create a separate status message
    // This prevents the "Privacy Sandbox Request Success" separate lines
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
    
    if (detailsText.includes('<b>') || detailsText.includes('<span class="param-')) {
        renderMessage(message, messageType, icon, false, false, detailsText);
    } else {
        renderMessage(message, messageType, icon, false, false, detailsText);
    }
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
    if (shouldShow) {
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
    
    if (message.startsWith('[STRUCTURED] ')) {
        try {
            const logEntry = JSON.parse(message.substring(13));
            if (logEntry.type && logEntry.event && logEntry.data) {
                handleStructuredLog(logEntry);
                return;
            }
        } catch (e) {
            // Fall through to legacy handling
        }
    }
    handleLegacyMessage(message, type);
}

// ===== EVENT LISTENERS =====
function initializeEventListeners() {
    // Theme toggle
    DOM.themeToggle?.addEventListener('click', toggleTheme);
    
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

// ===== INITIALIZATION =====
async function init() {
    await loadConfig();
    initTheme();
    initializeSettings();
    initializeEventListeners();
    updateNavigationButtons();
    applyFilter(); // Apply default filter settings
    connect();
}

// Start the application
init().catch(console.error);