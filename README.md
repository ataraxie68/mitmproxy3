# GA4 + Marketing Pixel Logger

A comprehensive web analytics and marketing pixel monitoring tool that intercepts and analyzes web traffic for tracking events across 16+ marketing platforms using mitmproxy.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.8+-green.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)

## 🎯 Features

- **Real-time Analytics Monitoring** - Live capture of GA4 events and marketing pixels
- **Multi-Platform Support** - Tracks 16+ platforms including GA4, Facebook, TikTok, Snapchat, Pinterest, LinkedIn, Twitter/X, Microsoft/Bing, Amazon, Criteo, Reddit, Quora, Outbrain, Taboola, and more
- **Consent Tracking** - Visual consent status indicator with GDPR compliance monitoring
- **Cookie Analysis** - Comprehensive cookie tracking with marketing classification
- **DataLayer Monitoring** - Real-time Google Tag Manager DataLayer event capture
- **Browser-based UI** - Modern overlay interface with filtering and expandable details
- **Compliance Tools** - Cookie banner detection and consent violation warnings

## 🚀 Quick Start

### Prerequisites

- Python 3.8 or higher
- pip package manager

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ataraxie68/mitmproxy3.git
   cd mitmproxy3
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run the tool:**
   ```bash
   # Monitor default domain
   python start-logging.py
   
   # Monitor specific domain
   python start-logging.py --domain https://www.example.com
   python start-logging.py -d www.example.com
   ```

## 📊 Interface Overview

The tool opens two browser windows:

1. **Analytics Overlay** - Real-time event display with:
   - 🎯 Consent status indicator (🔴 declined, 🟢 accepted, 🔘 unknown)
   - Platform-specific event filtering
   - Expandable event details
   - Adjustable font sizing (A+/A-)
   - Dark/Light theme toggle

2. **Target Website** - Proxied browser instance for testing

## 🛡️ Consent & Privacy Monitoring

### Consent Status Indicator
- **🔴 Red Dot** - User declined consent (all tracking blocked)
- **🟢 Green Dot** - User accepted consent (tracking allowed)
- **🔘 Gray Dot** - Unknown consent status
- **Hover tooltip** - Shows detailed consent information and timestamp

### GDPR Compliance Features
- Cookie banner detection
- Marketing cookie classification
- Consent violation alerts
- Privacy compliance monitoring

## 🎨 Supported Platforms

| Platform | Icon | Detection |
|----------|------|-----------|
| GA4 | 📊 | Google Analytics events |
| Facebook | 👥 | Meta Pixel events |
| TikTok | 🎵 | TikTok Pixel tracking |
| Snapchat | 👻 | Snap Pixel events |
| Pinterest | 📌 | Pinterest Tag events |
| LinkedIn | 💼 | LinkedIn Insight Tag |
| Twitter/X | 🐦 | X Pixel tracking |
| Microsoft/Bing | 🔍 | Microsoft UET |
| Amazon | 📦 | Amazon DSP pixels |
| Criteo | 🎯 | Criteo OneTag |
| Reddit | 🔄 | Reddit Pixel |
| Quora | ❓ | Quora Pixel |
| Outbrain | 📰 | Outbrain Pixel |
| Taboola | 📱 | Taboola Pixel |
| sGTM | 🌐 | Server-side GTM |
| Custom | ⚙️ | Custom tracking |

## 🔧 Configuration

### Environment Variables
- `TARGET_DOMAIN` - Set default monitoring domain
- `DEBUG_MODE` - Enable detailed debug output
- `ENABLE_DATALAYER_LOGGING` - Toggle DataLayer monitoring (default: True)
- `ENABLE_WEBSOCKET_OUTPUT` - Toggle WebSocket streaming (default: True)

### Browser Settings
- Certificate handling for HTTPS interception
- Proxy configuration on random available ports
- Stealth mode to avoid detection

## 📝 Log Output Format

The tool outputs structured JSON logs:

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

## 🔍 Use Cases

### Analytics Auditing
- Verify tracking implementation
- Debug GA4 event firing
- Validate marketing pixel deployment
- Cross-platform event correlation

### Privacy Compliance
- GDPR compliance verification
- Cookie audit and classification
- Consent management validation
- Marketing tracking oversight

### Quality Assurance
- E-commerce tracking verification
- Conversion funnel analysis
- Tag management debugging
- Cross-browser testing

## ⚙️ Advanced Features

### Font Size Adjustment
- **A+/A-** buttons resize all interface elements
- Separate sizing for header, content, and buttons
- Persistent settings via localStorage

### Platform Filtering
- Individual platform toggle controls
- Bulk select/deselect options
- Real-time filtering without data loss

### Event Details
- Expandable event information
- Request/response metadata
- Parameter validation (GA4)
- Debug information display

## 🛠️ Development

### Project Structure
```
├── ga4-logger.py          # Core mitmproxy interception logic
├── start-logging.py       # Orchestrator and WebSocket server
├── ga4-logger-overlay.html # Browser-based UI
├── ga4-logger-overlay.css  # Styling and themes
├── ga4-logger-overlay.js   # Frontend logic and event handling
├── requirements.txt        # Python dependencies
└── README.md              # This file
```

### Adding New Platforms

1. **Update Platform Configuration** in `ga4-logger.py`:
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

2. **Add Platform Icon** in `ga4-logger-overlay.js`:
```javascript
CONFIG.platformIconMap["NewPlatform"] = '<i class="fa-solid fa-icon"></i>';
```

3. **Test** with sample requests to ensure detection

### Dependencies

- **mitmproxy** - HTTP/HTTPS traffic interception
- **playwright** - Browser automation and control
- **websockets** - Real-time communication between components

## 🔒 Security Considerations

**⚠️ DEFENSIVE USE ONLY**

This tool is designed exclusively for **defensive security analysis**:
- ✅ Privacy compliance auditing
- ✅ Analytics tracking validation
- ✅ Consent management verification
- ✅ GDPR/CCPA compliance testing
- ❌ **NOT for malicious purposes**

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/new-platform`)
3. Commit your changes (`git commit -am 'Add NewPlatform support'`)
4. Push to the branch (`git push origin feature/new-platform`)
5. Create a Pull Request

## 🐛 Issues & Support

- Report bugs via [GitHub Issues](https://github.com/ataraxie68/mitmproxy3/issues)
- Check existing issues before creating new ones
- Provide detailed reproduction steps
- Include log output when relevant

## 📈 Roadmap

- [ ] Additional marketing platforms
- [ ] Enhanced consent detection
- [ ] Export functionality
- [ ] Advanced filtering options
- [ ] Performance metrics
- [ ] Mobile device support

---

**Built with ❤️ for privacy-conscious analytics monitoring**

![Screenshot](docs/screenshot.png)