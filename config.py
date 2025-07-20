"""
Unified configuration system for the GA4 + Marketing Pixel Logger.
Replaces both config.py and config.json with a single source of truth.
"""

from typing import Dict, Set, NamedTuple, Optional
from config_loader import (
    get_config, get_platform_color, get_platform_config, get_all_platform_configs,
    get_server_tracking_config, get_all_hosts, get_all_paths, get_platforms_dict,
    PlatformConfig
)

# Load configuration on module import
config = get_config()

# Platform configurations from JSON
PLATFORMS: Dict[str, PlatformConfig] = get_platforms_dict()

# Host and path sets for fast lookup
ALL_HOSTS: Set[str] = get_all_hosts()
ALL_PATHS: Set[str] = get_all_paths()
MARKETING_PIXEL_HOSTS: Set[str] = ALL_HOSTS.copy()
MARKETING_PIXEL_PATHS: Set[str] = ALL_PATHS.copy()

# Server tracking configuration from JSON
server_tracking_config = get_server_tracking_config()
SERVER_TRACKING_PATTERNS = server_tracking_config.get('patterns', {
    'gtm': ['gtm', 'sgtm', 'server-gtm', 'gtm-server'],
    'analytics': ['analytics', 'tracking', 'metrics', 'data', 'stats'],
    'events': ['events', 'event', 'collect', 'track', 'beacon'],
    'paths': ['/gtm/', '/collect', '/mp/collect', '/g/collect', '/analytics/', '/track', '/events', '/beacon', '/pixel', '/hit']
})

ALL_HOST_PATTERNS = set(
    SERVER_TRACKING_PATTERNS.get('gtm', []) + 
    SERVER_TRACKING_PATTERNS.get('analytics', []) + 
    SERVER_TRACKING_PATTERNS.get('events', [])
)

sgtm_indicators = server_tracking_config.get('sgtmIndicators', {})
SGTM_INDICATORS = {
    'host_patterns': sgtm_indicators.get('hostPatterns', ['gtm', 'sgtm', 'server-gtm', 'gtm-server', 'tm.']),
    'path_patterns': sgtm_indicators.get('pathPatterns', ['/g/collect', '/collect', '/mp/collect', '/analytics/', '/track', '/events']),
    'excluded_paths': sgtm_indicators.get('excludedPaths', ['/gtag/js', '/gtm/js', '/gtag/config', '/gtag/event', '/ccm/collect']),
    'ga4_params': sgtm_indicators.get('ga4Params', ['en', 'cid', 'sid', '_p', 'dl', 'dr', 'dt']),
    'consent_params': sgtm_indicators.get('consentParams', ['gcs', 'dma', 'dma_cps', 'gdpr', 'gdpr_consent']),
    'gtm_id_prefixes': sgtm_indicators.get('gtmIdPrefixes', ['GTM-', 'G-', 'AW-', 'DC-']),
    'tracking_id_prefixes': sgtm_indicators.get('trackingIdPrefixes', ['G-', 'GA-', 'GTM-', 'AW-', 'DC-']),
    # Enhanced parameter categories
    'eventParams': sgtm_indicators.get('eventParams', ['event', 'event_name', 'en', 'ev', 'action', 'event_action', 'category', 'event_category']),
    'trackingParams': sgtm_indicators.get('trackingParams', ['track', 'tracking', 'pixel', 'pixel_id', 'id', 'user_id', 'uid', 'client_id', 'cid']),
    'sessionParams': sgtm_indicators.get('sessionParams', ['session', 'session_id', 'sid', 'visit', 'visit_id', 's']),
    'valueParams': sgtm_indicators.get('valueParams', ['value', 'revenue', 'price', 'amount', 'val', 'total']),
    'ecommerceParams': sgtm_indicators.get('ecommerceParams', ['currency', 'item_id', 'product_id', 'sku', 'quantity', 'product_name', 'item_name']),
    'customParams': sgtm_indicators.get('customParams', ['custom', 'param', 'data', 'properties', 'traits', 'context']),
    'timestampParams': sgtm_indicators.get('timestampParams', ['timestamp', 'time', 't', '_p', 'ts']),
    'serverGtmParams': sgtm_indicators.get('serverGtmParams', ['gtm', 'container_id', 'gtm_container', 'server_container_url'])
}

# Platform highlighting configuration from centralized config
def get_platform_highlight_info(platform: str) -> Dict[str, str]:
    """Get platform highlighting information from centralized config."""
    return {
        'color': get_platform_color(platform),
        'highlight_class': config.get_platform_highlight_class(platform)
    }

# Configuration variables from JSON
try:
    WEBSOCKET_CONFIG = config.get_websocket_config()
    LOGGING_CONFIG = config.get_logging_config()
    PROXY_CONFIG = config.get_proxy_config()
    BROWSER_CONFIG = config.get_browser_config()
except Exception as e:
    print(f"Warning: Could not load centralized config: {e}")
    # Fallback to defaults
    WEBSOCKET_CONFIG = {'port': 9999, 'host': 'localhost'}
    LOGGING_CONFIG = {'debugMode': False}
    PROXY_CONFIG = {'ignoreCertificateErrors': True}
    BROWSER_CONFIG = {'headless': False}

# Convenience functions
def get_websocket_port() -> int:
    """Get WebSocket port from configuration."""
    return WEBSOCKET_CONFIG.get('port', 9999)

def get_websocket_host() -> str:
    """Get WebSocket host from configuration."""
    return WEBSOCKET_CONFIG.get('host', 'localhost')

def is_debug_mode() -> bool:
    """Check if debug mode is enabled."""
    return LOGGING_CONFIG.get('debugMode', False)

def get_browser_headless() -> bool:
    """Check if browser should run in headless mode."""
    return BROWSER_CONFIG.get('headless', False)

def ignore_certificate_errors() -> bool:
    """Check if certificate errors should be ignored."""
    return PROXY_CONFIG.get('ignoreCertificateErrors', True)