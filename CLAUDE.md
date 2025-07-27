# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GA4 + Marketing Pixel Logger tool that uses mitmproxy to intercept and analyze web traffic for tracking analytics events. The tool monitors GA4 events and marketing pixels from 16+ platforms including Facebook, TikTok, Snapchat, Pinterest, LinkedIn, Twitter/X, Microsoft/Bing, Amazon, Criteo, Reddit, Quora, Outbrain, and Taboola.

## Architecture

### Core Components

1. **ga4-logger.py** - Main mitmproxy script that:
   - Intercepts HTTP/HTTPS requests using mitmproxy
   - Detects tracking requests from 16+ marketing platforms
   - Parses URL parameters and POST data for analytics events
   - Outputs structured JSON logs for consumption by the overlay
   - Handles both GET and POST requests, including GA4 JSON batch requests

2. **start-logging.py** - Orchestrator script that:
   - Launches mitmproxy subprocess with the ga4-logger.py script
   - Starts an embedded WebSocket server on port 9999
   - Opens Playwright browser instances with proxy configuration
   - Manages two browser windows: overlay and target site
   - Handles DataLayer monitoring via JavaScript injection
   - Coordinates output between mitmproxy and browser overlay

3. **ga4-logger-overlay.html/.js/.css** - Browser-based UI that:
   - Connects to WebSocket server for real-time event streaming
   - Displays structured analytics events with platform-specific icons
   - Provides filtering, expandable details, and event categorization
   - Shows request status updates and cookie tracking

### Platform Detection and Event Handling System

The tool uses a sophisticated platform detection and event handling architecture:

#### Platform Detection (UnifiedPlatformDetector)
- **Host + Path Matching**: Uses both hostname and path patterns for accurate platform identification
- **Caching**: Platform detection results are cached for performance
- **Regional GA4 Detection**: Special handling for regional Google Analytics domains
- **sGTM Detection**: Server-side Google Tag Manager identification

#### Event Handler Pattern
- **BaseEventHandler**: Abstract base class defining the event handling interface
- **Specialized Handlers**: Platform-specific handlers (GA4EventHandler, FacebookEventHandler, etc.)
- **EVENT_HANDLERS Registry**: Maps platform names to their corresponding handler classes
- **Unified Processing**: All handlers implement extract_identifiers() and extract_platform_info()

Key specialized handlers:
- `GA4EventHandler`: Handles GA4, GTM library loading, consent mode, and tag diagnostics
- `ServerSideGTMEventHandler`: Dedicated handler for server-side GTM events
- `ConsentManagementPlatformEventHandler`: Generic handler for CMP vendors (OneTrust, Cookiebot, etc.)
- `FacebookEventHandler`, `LinkedInEventHandler`, etc.: Platform-specific event parsing

#### Configuration System
- **config.json**: Centralized configuration for UI settings, platform configs, and WebSocket settings
- **Platform Configurations**: Each platform has hosts, paths, parameter mappings, and UI settings
- **Dynamic Loading**: Configuration is loaded at runtime and can be modified without code changes

### Data Flow Architecture

1. **Request Interception**: Browser requests → mitmproxy → ga4-logger.py
2. **Platform Detection**: UnifiedPlatformDetector identifies the platform
3. **Event Processing**: Appropriate EventHandler processes the request
4. **Structured Logging**: JSON logs → stdout with [STRUCTURED] prefix
5. **Output Coordination**: start-logging.py captures stdout → WebSocket server
6. **Real-time Display**: Browser overlay → WebSocket client → live UI updates

### WebSocket Communication Layer
- **Embedded Server**: start-logging.py runs WebSocket server on port 9999
- **Message Queue**: Queue-based message broadcasting to multiple clients
- **Buffer System**: Late-connecting clients receive buffered messages
- **Real-time Updates**: Live streaming of analytics events to browser overlay

## Development Commands

### Setup and Installation
```bash
# Install dependencies
pip install -r requirements.txt

# Dependencies include:
# - mitmproxy (for traffic interception)
# - playwright (for browser automation)
# - websockets (for real-time communication)
```

### Running the Tool
```bash
# Basic usage (monitors default domain)
python start-logging.py

# Monitor specific domain
python start-logging.py --domain https://www.example.com
python start-logging.py -d www.example.com

# The tool will:
# 1. Start mitmproxy on a random available port
# 2. Launch WebSocket server on port 9999
# 3. Open two browser windows (overlay + target site)
# 4. Begin real-time monitoring
```

### Configuration Management

Configuration is handled through multiple layers:

1. **config.json**: Main configuration file with UI settings, platform configs, and WebSocket settings
2. **config.py**: Python configuration loader with environment variable support
3. **Runtime Parameters**: Command-line arguments and environment variables

Key configuration areas:
- **Platform Configurations**: Add new tracking platforms in config.json
- **UI Settings**: Icons, colors, and parameter validation limits
- **WebSocket Settings**: Connection parameters and retry logic
- **Browser Settings**: Headless mode, certificate handling

### Adding New Platforms

To add support for a new marketing platform:

1. **Add platform configuration to config.json**:
```json
"NewPlatform": {
  "name": "NewPlatform",
  "hosts": ["tracking.newplatform.com"],
  "paths": ["/track", "/pixel"],
  "paramMap": {"pid": "pixel_id", "event": "event_name"},
  "pixelIdKey": "pid",
  "eventNameKey": "event",
  "description": "Description of the platform",
  "ui": {
    "icon": "<i class=\"fa-solid fa-icon brand-icon\"></i>",
    "color": "#FF6600",
    "highlightClass": "universal-highlight-newplatform"
  }
}
```

2. **Add CSS styling** in ga4-logger-overlay.css:
```css
.icon-newplatform { color: #FF6600; }
```

3. **Create specialized handler** (if needed) in ga4-logger.py:
```python
class NewPlatformEventHandler(BaseEventHandler):
    """Specialized handler for NewPlatform events"""
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        # Platform-specific logic
        pass
```

4. **Register handler** in EVENT_HANDLERS dictionary

### Debugging and Development

#### Debug Mode
```bash
# Enable debug logging in ga4-logger.py
DEBUG_MODE = True

# Or via environment variable
DEBUG_MODE=true python start-logging.py
```

#### Console Debugging
- Browser console shows detailed WebSocket communication
- ga4-logger.py outputs structured JSON logs with debug information
- mitmproxy console provides detailed request/response information

#### Common Development Patterns
- **Request Filtering**: Add exclusions in `process_request()` method
- **Parameter Extraction**: Implement in platform-specific event handlers  
- **UI Enhancements**: Modify overlay JavaScript for new display features
- **Platform Detection**: Extend UnifiedPlatformDetector for new patterns

### Log Output Format

The tool outputs structured JSON logs with this format:
```json
{
  "timestamp": 1234567890.123,
  "type": "ga4_event|marketing_pixel_event|datalayer|consent|cookie|url_change",
  "event": "event_name",
  "data": {
    "platform": "GA4",
    "pixel_id": "G-XXXXXXXXXX",
    "extra_info": ["key: value"],
    "mapped_data": {}
  },
  "metadata": {
    "request_path": "/collect",
    "raw_data": {}
  }
}
```

### Browser Monitoring Components

The tool includes sophisticated browser-side monitoring:

- **browser-monitor.js**: Injected script for DataLayer monitoring and cookie banner detection
- **CMP Detection**: Consent Management Platform vendor identification
- **Cookie Analysis**: Marketing vs non-marketing cookie classification
- **GDPR Compliance**: Consent violation detection and reporting

### Security Considerations

This tool is designed for **defensive security analysis only**:
- Monitors analytics tracking for privacy compliance
- Detects unauthorized tracking pixels
- Analyzes consent management implementations
- Validates GDPR/CCPA compliance in tracking setups

The tool should only be used for legitimate security analysis and privacy auditing purposes.

## File Structure

### Core Files
- `ga4-logger.py` - Core mitmproxy interception logic and event handlers
- `start-logging.py` - Orchestrator, WebSocket server, and browser automation
- `ga4-logger-overlay.html/.js/.css` - Browser-based real-time UI
- `browser-monitor.js` - Injected browser monitoring script
- `config.json` - Centralized configuration
- `config.py` - Configuration loader
- `requirements.txt` - Python dependencies

### Generated Files
- `ga4_events.log` - Log file (if file logging is enabled)
- `__pycache__/` - Python bytecode cache

## Common Issues

- **Port conflicts**: The tool automatically finds available ports for mitmproxy
- **Certificate issues**: Uses `--ignore-certificate-errors` for HTTPS interception
- **Platform detection**: Check config.json platformConfigs if new tracking domains aren't detected
- **WebSocket connection**: Overlay connects to localhost:9999 by default
- **googleapis.com exclusions**: Google API requests are automatically excluded from processing