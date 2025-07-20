# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GA4 + Marketing Pixel Logger tool that uses mitmproxy to intercept and analyze web traffic for tracking analytics events. The tool monitors GA4 events and marketing pixels from various platforms including Facebook, TikTok, Snapchat, Pinterest, LinkedIn, Twitter/X, Microsoft/Bing, Amazon, Criteo, Reddit, Quora, Outbrain, and Taboola.

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

3. **ga4-logger-overlay.html** - Browser-based UI that:
   - Connects to WebSocket server for real-time event streaming
   - Displays structured analytics events with platform-specific icons
   - Provides filtering, expandable details, and event categorization
   - Shows request status updates and cookie tracking

### Platform Detection System

The tool uses a sophisticated platform detection system with:
- **PLATFORMS** configuration dictionary mapping hostnames to platform configs
- **PlatformConfig** named tuples with hosts, paths, parameter mappings, and identifiers
- Cached platform detection for performance optimization
- Host + path matching for accurate platform identification (handles conflicts like www.google.com)

### Data Flow

1. Browser requests → mitmproxy → ga4-logger.py (request interception)
2. ga4-logger.py → structured JSON logs → stdout
3. start-logging.py → captures stdout → WebSocket server
4. Browser overlay → WebSocket client → real-time display

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

### Configuration

- **TARGET_DOMAIN**: Set via command line or environment variable
- **DEBUG_MODE**: Toggle in ga4-logger.py for detailed debug output
- **ENABLE_DATALAYER_LOGGING**: Toggle DataLayer monitoring (default: True)
- **ENABLE_WEBSOCKET_OUTPUT**: Toggle WebSocket streaming (default: True)

### Adding New Platforms

To add support for a new marketing platform:

1. Add platform configuration to **PLATFORMS** dictionary in ga4-logger.py:
```python
"NewPlatform": PlatformConfig(
    name="NewPlatform",
    hosts={"tracking.newplatform.com"},
    paths={"/track", "/pixel"},
    param_map={'pid': 'pixel_id', 'event': 'event_name'},
    pixel_id_key="pid",
    event_name_key="event",
    description="Description of the platform"
)
```

2. Add platform icon to **platformIconMap** in ga4-logger-overlay.html
3. Test with sample requests to ensure proper detection and parsing

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

### Security Considerations

This tool is designed for **defensive security analysis only**:
- Monitors analytics tracking for privacy compliance
- Detects unauthorized tracking pixels
- Analyzes consent management implementations
- Validates GDPR/CCPA compliance in tracking setups

The tool should only be used for legitimate security analysis and privacy auditing purposes.

## File Structure

- `ga4-logger.py` - Core mitmproxy interception logic
- `start-logging.py` - Orchestrator and WebSocket server
- `ga4-logger-overlay.html` - Browser-based real-time UI
- `requirements.txt` - Python dependencies
- `ga4_events.log` - Generated log file (if created during runtime)

## Common Issues

- **Port conflicts**: The tool automatically finds available ports for mitmproxy
- **Certificate issues**: Uses `--ignore-certificate-errors` for HTTPS interception
- **Platform detection**: Check PLATFORMS configuration if new tracking domains aren't detected
- **WebSocket connection**: Overlay connects to localhost:9999 by default