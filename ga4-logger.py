from mitmproxy import http
import urllib.parse
import sys
import json
import time
import os
import re
import hashlib
from typing import Dict, List, Optional, Union
from config import (
    PLATFORMS, ALL_HOSTS, ALL_PATHS, 
    SERVER_TRACKING_PATTERNS, ALL_HOST_PATTERNS, SGTM_INDICATORS,
    get_platform_highlight_info, get_websocket_port, is_debug_mode
)

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)

# Load centralized configuration
DEBUG_MODE = is_debug_mode()
WEBSOCKET_PORT = get_websocket_port()


EVENT_PARAMS: List[tuple] = [
    ('gcs', 'GCS'), ('ep.decision_id', 'decision_id'), ('ep.slot_id', 'slot_id'),
    ('ep.item_name', 'item_name'), ('ep.type', 'type'), ('ep.hostname', 'hostname'),
    ('ep.dy_user', 'dy_user'), ('ep.dy_session', 'dy_session')
]

# Platform formatting rules for pixel IDs
PLATFORM_ID_FORMATTERS = {
    "GA4": {
        "G-": ("GA4 Measurement ID", "GA4"),
        "UA-": ("Universal Analytics ID", "UA"), 
        "CCM-": ("GA4 Consent Mode", "CCM")
    },
    "Google Ads": {
        "AW-": ("Google Ads Conversion ID", "Ads"),
        "G-": ("GA4 → Google Ads", "GA4→Ads")
    },
    "Facebook": lambda pid: ("Facebook Pixel ID", "FB") if pid.isdigit() and len(pid) >= 15 else None,
    "TikTok": lambda pid: ("TikTok Pixel Code", "TT") if len(pid) >= 10 else None,
    "Snapchat": lambda pid: ("Snapchat Pixel ID", "SC") if "-" in pid and len(pid) >= 30 else None,
    "Pinterest": lambda pid: ("Pinterest Tag ID", "PIN") if pid.isdigit() else None,
    "LinkedIn": lambda pid: ("LinkedIn Partner ID", "LI") if pid.isdigit() else None,
    "Twitter/X": lambda pid: ("Twitter/X Pixel ID", "X"),
    "Microsoft/Bing": lambda pid: ("Bing UET Tag ID", "UET") if pid.isdigit() else None
}


# Global state
TARGET_DOMAIN: Optional[str] = os.environ.get('TARGET_DOMAIN')
pending_requests: Dict[str, Dict] = {}  # Track pending tracking requests
# platform_cache removed - now handled by platform_detector


class UnifiedLogger:
    """Unified logging system for all output types"""
    
    def __init__(self):
        self.enable_debug = DEBUG_MODE
    
    def log_structured(self, log_type: str, event_name: str, data: Dict, metadata: Dict = None) -> None:
        """Output structured log entries for overlay consumption"""
        # Structured JSON for overlay (primary output)
        log_entry = {
            "timestamp": time.time(),
            "type": log_type,
            "event": event_name,
            "data": data,
            "metadata": metadata or {}
        }
        print(f"[STRUCTURED] {json.dumps(log_entry, ensure_ascii=False, separators=(',', ':'))}", flush=True)
    
    def log_debug(self, message: str) -> None:
        """Log debug message if debug mode is enabled"""
        if self.enable_debug:
            print(f"DEBUG: {message}", flush=True)
    
    def log_info(self, message: str) -> None:
        """Log informational message"""
        print(message, flush=True)
    
    def log_error(self, message: str) -> None:
        """Log error message"""
        print(f"ERROR: {message}", flush=True)


# Global logger instance
unified_logger = UnifiedLogger()

def _generate_request_hash(url: str, post_data: str = "") -> str:
    """Generate unique hash for request/response matching"""
    # Combine URL and POST data for unique fingerprint
    content = f"{url}|{post_data}"
    return hashlib.md5(content.encode()).hexdigest()[:12]  # Short hash (12 chars)

# Startup message
unified_logger.log_info("GA4 + Marketing Pixel Logger with organized platform configuration ready!")
unified_logger.log_info(f"Configured Platforms: {len(PLATFORMS)} ({', '.join(PLATFORMS.keys())})")
unified_logger.log_info(f"Monitoring {len(ALL_HOSTS)} total hosts, {len(ALL_PATHS)} tracking paths")
unified_logger.log_info("Tracking: Events, Consents, Cookies")
if TARGET_DOMAIN:
    unified_logger.log_info(f"Target Domain: {TARGET_DOMAIN}")
unified_logger.log_info("-" * 50)


def extract_event_info(data: Dict[str, str]) -> List[str]:
    """Legacy function - now delegates to unified system"""
    # For backward compatibility, create a temporary GA4 handler
    from config import PLATFORMS
    if "GA4" in PLATFORMS:
        handler = GA4EventHandler(PLATFORMS["GA4"])
        return handler._extract_ga4_event_info(data)
    return []

# Unified Event Handler System
class BaseEventHandler:
    """Base class for unified event handling across platforms"""
    
    def __init__(self, platform_config):
        self.config = platform_config
        self.platform_name = platform_config.name
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        """Extract pixel_id, event_name, and event_type - can be overridden by subclasses"""
        pixel_id = data.get(self.config.pixel_id_key, "")
        event_name = data.get(self.config.event_name_key, "Unknown")
        event_type = "Standard Event"  # Default event type
        return pixel_id, event_name, event_type
    
    def extract_platform_info(self, data: Dict[str, str], mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
        """Extract platform-specific information - can be overridden by subclasses"""
        extra_info = []
        
        # Common extraction patterns
        if value := mapped_data.get('value'):
            currency = mapped_data.get('currency', '')
            extra_info.append(self._format_value_currency(value, currency))
        
        if content_name := mapped_data.get('content_name'):
            extra_info.append(f"content: {self._truncate_value(content_name)}")
        
        if content_ids := mapped_data.get('content_ids'):
            extra_info.append(f"ids: {content_ids[:20]}")
        
        return extra_info
    
    def _extract_ga4_event_info(self, data: Dict[str, str]) -> List[str]:
        """Extract GA4-specific event information (moved from extract_event_info)"""
        extra_info = []
        
        # Extract specific parameters
        for param_key, display_name in EVENT_PARAMS:
            if value := data.get(param_key):
                if param_key == 'gcs':
                    extra_info.append(f"{display_name}: {value}")
                else:
                    truncated = value[:50] + "..." if len(value) > 50 else value
                    extra_info.append(f"{display_name}: {truncated}")
        
        # Add product information if present
        products = parse_product_data(data)
        if products:
            event_name = data.get("en", "")
            if len(products) == 1:
                name = products[0].get('name', 'Unknown')[:15]
                extra_info.append(f"product: {name}")
            elif event_name == "view_item_list":
                names = [p.get('name', 'Unknown')[:12] for p in products[:3]]
                suffix = "..." if len(products) > 3 else ""
                extra_info.append(f"products ({len(products)}): {', '.join(names)}{suffix}")
            else:
                extra_info.append(f"products: {len(products)} items")
        
        return extra_info
    
    def _truncate_value(self, value: str, max_length: int = 30) -> str:
        """Truncate value with ellipsis if too long"""
        return value[:max_length] + "..." if len(value) > max_length else value
    
    def _format_value_currency(self, value: str, currency: str = "") -> str:
        """Format value with optional currency"""
        return f"value: {value} {currency}".strip()


class GA4EventHandler(BaseEventHandler):
    """Specialized handler for GA4 events"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        request_path = data.get("_request_path", "")
        
        # GTM Library Loading
        if "gtag/js" in request_path:
            return data.get("id", ""), "gtag_library_load", "JavaScript Library"
        
        # Consent Mode (CCM)
        if "ccm/collect" in request_path:
            pixel_id = data.get("gtm") or f"CCM-{data.get('gcs', 'Unknown')}"
            event_name = data.get("en", "consent_mode_event")
            return pixel_id, event_name, "Consent Mode"
        
        # Standard GA4 event
        pixel_id, event_name, _ = super().extract_identifiers(data)
        return pixel_id, event_name, "Analytics Event"
    
    def extract_platform_info(self, data: Dict[str, str], mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
        if event_name == "gtag_library_load":
            extra_info = []
            if gtm_id := data.get("gtm"): extra_info.append(f"GTM: {gtm_id}")
            if container_id := data.get("cx"): extra_info.append(f"Container: {container_id}")
            if experiments := data.get("tag_exp"):
                exp_count = len(experiments.split('~')) if experiments else 0
                extra_info.append(f"Experiments: {exp_count}")
            return extra_info
        elif "ccm/collect" in str(data.get("_request_path", "")):
            extra_info = []
            if gcs := data.get("gcs"): extra_info.append(f"GCS: {gcs}")
            if gdpr := data.get("gdpr"): extra_info.append(f"GDPR: {'Yes' if gdpr == '1' else 'No'}")
            if gdpr_consent := data.get("gdpr_consent"): extra_info.append(f"Consent: {self._truncate_value(gdpr_consent, 10)}")
            if npa := data.get("npa"): extra_info.append(f"Non-Personalized: {'Yes' if npa == '1' else 'No'}")
            if dma := data.get("dma"): extra_info.append(f"DMA: {dma}")
            if dma_cps := data.get("dma_cps"): extra_info.append(f"DMA-CPS: {dma_cps}")
            if page_url := data.get("dl"):
                domain = page_url.split("//")[-1].split("/")[0] if "//" in page_url else page_url
                extra_info.append(f"Domain: {domain}")
            return extra_info
        else:
            return self._extract_ga4_event_info(data)


class ServerSideGTMEventHandler(BaseEventHandler):
    """Specialized handler for Server-side GTM events"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        request_path = data.get("_request_path", "")
        
        # GTM Library Loading
        if "gtag/js" in request_path:
            return data.get("id", ""), "gtag_library_load (sGTM)", "JavaScript Library"
        
        # Consent Mode (CCM)
        if "ccm/collect" in request_path:
            pixel_id = data.get("gtm") or f"CCM-{data.get('gcs', 'Unknown')}"
            event_name = data.get("en", "consent_mode_event")
            return pixel_id, event_name, "Consent Mode"
        
        # Standard sGTM event
        pixel_id, event_name, _ = super().extract_identifiers(data)
        return pixel_id, event_name, "Server-side Analytics"
    
    def extract_platform_info(self, data: Dict[str, str], mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
        if event_name == "gtag_library_load (sGTM)":
            extra_info = []
            if gtm_id := data.get("gtm"): extra_info.append(f"GTM: {gtm_id}")
            if container_id := data.get("cx"): extra_info.append(f"Container: {container_id}")
            if experiments := data.get("tag_exp"):
                exp_count = len(experiments.split('~')) if experiments else 0
                extra_info.append(f"Experiments: {exp_count}")
            return extra_info
        elif "ccm/collect" in str(data.get("_request_path", "")):
            extra_info = []
            if gcs := data.get("gcs"): extra_info.append(f"GCS: {gcs}")
            if gdpr := data.get("gdpr"): extra_info.append(f"GDPR: {'Yes' if gdpr == '1' else 'No'}")
            if gdpr_consent := data.get("gdpr_consent"): extra_info.append(f"Consent: {self._truncate_value(gdpr_consent, 10)}")
            if npa := data.get("npa"): extra_info.append(f"Non-Personalized: {'Yes' if npa == '1' else 'No'}")
            if dma := data.get("dma"): extra_info.append(f"DMA: {dma}")
            if dma_cps := data.get("dma_cps"): extra_info.append(f"DMA-CPS: {dma_cps}")
            if page_url := data.get("dl"):
                domain = page_url.split("//")[-1].split("/")[0] if "//" in page_url else page_url
                extra_info.append(f"Domain: {domain}")
            return extra_info
        else:
            return self._extract_ga4_event_info(data)


class FacebookEventHandler(BaseEventHandler):
    """Specialized handler for Facebook events"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        pixel_id, event_name, _ = super().extract_identifiers(data)
        
        # Determine event type based on event name
        if event_name in ["PageView"]:
            event_type = "Page Tracking"
        elif event_name in ["Purchase", "InitiateCheckout", "AddToCart"]:
            event_type = "E-commerce"
        elif event_name in ["Lead", "CompleteRegistration", "Subscribe"]:
            event_type = "Conversion"
        elif event_name in ["ViewContent", "Search", "AddToWishlist"]:
            event_type = "Engagement"
        else:
            event_type = "Custom Event"
        
        return pixel_id, event_name, event_type
    
    def extract_platform_info(self, data: Dict[str, str], mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
        extra_info = []
        
        if value := mapped_data.get('content_name'): extra_info.append(f"content: {self._truncate_value(value)}")
        if value := mapped_data.get('content_category'): extra_info.append(f"category: {value}")
        if value := mapped_data.get('value'): extra_info.append(self._format_value_currency(value, mapped_data.get('currency', '')))
        if value := mapped_data.get('content_ids'):
            try:
                if value.startswith('[') and value.endswith(']'):
                    ids = json.loads(value)
                    if isinstance(ids, list) and ids:
                        extra_info.append(f"ids: {', '.join(str(id)[:10] for id in ids[:3])}")
                else:
                    extra_info.append(f"id: {value[:20]}")
            except:
                extra_info.append(f"id: {value[:20]}")
        if value := mapped_data.get('num_items'): extra_info.append(f"items: {value}")
        
        return extra_info


class GoogleAdsEventHandler(BaseEventHandler):
    """Specialized handler for Google Ads events"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        pixel_id = data.get(self.config.pixel_id_key, "")
        request_path = str(data.get("_request_path", ""))
        
        # Use utility function to extract AdWords ID
        if adwords_id := _extract_adwords_id(request_path):
            if not pixel_id:
                pixel_id = f"AW-{adwords_id}"
        
        # Path-to-event mapping
        path_events = {
            "/pagead/1p-conversion/": "enhanced_conversion",
            "/pagead/conversion/": "conversion_tracking", 
            "/ads/conversion/": "conversion_tracking",
            "/pagead/1p-user-list/": "remarketing_user_list"
        }
        
        # Check path patterns first
        for path_pattern, event_name in path_events.items():
            if path_pattern in request_path:
                event_type = "Enhanced Conversion" if "enhanced" in event_name else "Conversion Tracking"
                return pixel_id, event_name, event_type
        
        # Hit type mapping
        hit_type = data.get("t", "")
        hit_type_events = {
            "sr": ("remarketing_audience", "Remarketing"),
            "pageview": ("pageview_tracking", "Page Tracking"), 
            "event": ("custom_event", "Custom Event")
        }
        
        if hit_type in hit_type_events:
            event_name, event_type = hit_type_events[hit_type]
            return pixel_id, event_name, event_type
        
        # Path context mapping
        if "ga-audiences" in request_path:
            return pixel_id, "audience_building", "Audience Building"
        elif "conversion" in request_path:
            return pixel_id, "conversion_tracking", "Conversion Tracking"
        else:
            event_name = f"hit_type_{hit_type}" if hit_type else "Ads Activity"
            return pixel_id, event_name, "Ads Activity Tracking"
    
    def extract_platform_info(self, data: Dict[str, str], mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
        extra_info = []
        if conv_label := mapped_data.get('conversion_label'): extra_info.append(f"label: {conv_label}")
        if gcs := mapped_data.get('consent_state'): extra_info.append(f"gcs: {gcs}")
        return extra_info


class LinkedInEventHandler(BaseEventHandler):
    """Specialized handler for LinkedIn events with detailed path classification"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        pixel_id = data.get(self.config.pixel_id_key, "")
        request_path = data.get("_request_path", "")
        
        # Enhanced path-based classification based on LinkedIn API documentation
        if "/collect" in request_path:
            # General data collection endpoint
            event_name, event_type = self._classify_collect_endpoint(data)
        elif "/attribution_trigger" in request_path:
            # Conversion event trigger endpoint
            event_name = "Attribution Trigger"
            event_type = "Conversion Attribution"
        elif "/li.lms-analytics/" in request_path:
            # LinkedIn LMS Analytics
            event_name = "LMS Analytics"
            event_type = "Learning Analytics"
        elif "/px" in request_path:
            # Pixel endpoint
            event_name = "Pixel Fire"
            event_type = "Pixel Tracking"
        else:
            # Fallback to parameter-based detection
            event_name, event_type = self._classify_by_parameters(data)
        
        # Add li_fat_id information if present
        if li_fat_id := data.get("li_fat_id"):
            event_name = f"{event_name} (li_fat_id: {li_fat_id})"
        
        return pixel_id, event_name, event_type
    
    def _classify_collect_endpoint(self, data: Dict[str, str]) -> tuple[str, str]:
        """Classify /collect endpoint based on parameters and usage patterns"""
        # Check format parameter for JavaScript vs beacon-style requests
        fmt = data.get("fmt", "")
        
        if fmt == "js":
            event_name = "Data Collection (JS)"
            event_type = "JavaScript Tracking"
        else:
            event_name = "Data Collection (Beacon)"
            event_type = "Beacon Tracking"
        
        # Check for specific tracking purposes
        if data.get("conversionId"):
            event_name = f"Conversion Collection ({fmt or 'beacon'})"
            event_type = "Conversion Tracking"
        elif data.get("eventId"):
            event_name = f"Custom Event Collection ({fmt or 'beacon'})"
            event_type = "Custom Event Tracking"
        elif data.get("v") and data.get("v") != "0":
            event_name = f"Value Tracking ({fmt or 'beacon'})"
            event_type = "Value-based Tracking"
        
        return event_name, event_type
    
    def _classify_by_parameters(self, data: Dict[str, str]) -> tuple[str, str]:
        """Fallback classification based on parameters"""
        if data.get("conversionId"):
            return "Conversion Event", "Conversion Tracking"
        elif data.get("eventId"):
            event_id = data.get("eventId")
            event_name = f"Custom Event_{event_id[:8]}" if len(event_id) > 10 else f"Custom Event_{event_id}"
            return event_name, "Custom Event Tracking"
        elif data.get("v") and data.get("v") != "0":
            return "Value Event", "Value-based Tracking"
        elif url := data.get("url", "").lower():
            # URL-based event classification
            url_events = {
                ("checkout", "purchase", "order"): ("Purchase Page", "E-commerce Tracking"),
                ("cart", "basket"): ("Cart Page", "E-commerce Tracking"), 
                ("contact", "form"): ("Lead Page", "Lead Generation"),
                ("signup", "register"): ("Registration Page", "Registration Tracking"),
                ("demo", "trial"): ("Demo Request", "Lead Generation"),
                ("download"): ("Download Page", "Content Engagement")
            }
            
            for keywords, (event_name, event_type) in url_events.items():
                if isinstance(keywords, tuple):
                    if any(keyword in url for keyword in keywords):
                        return event_name, event_type
                else:
                    if keywords in url:
                        return event_name, event_type
            
            return "Page View", "Page Tracking"
        else:
            # Check for GTM integration
            if data.get("tm") == "gtmv2":
                return "GTM Integration", "Tag Manager Event"
            else:
                return "Insight Tag", "General Tracking"
    
    def extract_platform_info(self, data: Dict[str, str], mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
        """Extract LinkedIn-specific information with enhanced details"""
        extra_info = []
        request_path = data.get("_request_path", "")
        
        # Path-specific information
        if "/collect" in request_path:
            # Add format information
            if fmt := mapped_data.get('format'):
                extra_info.append(f"format: {fmt}")
            
            # Add timing information
            timing_info = "page load" if "/collect" in request_path else "event trigger"
            extra_info.append(f"timing: {timing_info}")
            
            # Add usage context
            if "GTM" in event_name:
                extra_info.append("usage: base pixel tag")
            elif "Custom Event" in event_name:
                extra_info.append("usage: custom trigger")
            elif "Conversion" in event_name:
                extra_info.append("usage: conversion trigger")
            else:
                extra_info.append("usage: audience building")
                
        elif "/attribution_trigger" in request_path:
            extra_info.append("type: conversion attribution")
            extra_info.append("timing: user conversion")
            extra_info.append("style: beacon-only")
        
        # Standard parameter extraction
        if value := mapped_data.get('value'):
            currency = mapped_data.get('currency', '')
            extra_info.append(f"value: {value} {currency}".strip())
        
        if order_id := mapped_data.get('order_id'):
            extra_info.append(f"order: {order_id}")
        
        if page_url := mapped_data.get('page_url'):
            domain = page_url.split("//")[-1].split("/")[0] if "//" in page_url else page_url.split("/")[0]
            extra_info.append(f"domain: {domain}")
        
        # LinkedIn-specific IDs
        if partner_id := mapped_data.get('partner_id'):
            extra_info.append(f"partner: {partner_id}")
        
        if conversion_id := mapped_data.get('conversion_id'):
            extra_info.append(f"conversion: {conversion_id}")
        
        if li_fat_id := mapped_data.get('li_fat_id'):
            extra_info.append(f"fat_id: {li_fat_id}")
        
        return extra_info


class PinterestEventHandler(BaseEventHandler):
    """Specialized handler for Pinterest events"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        pixel_id = data.get(self.config.pixel_id_key, "")
        dep_value = data.get("dep", "").upper()
        
        pinterest_events = {
            "PAGE_LOAD": ("page_load", "Page Tracking"),
            "CONVERSION": ("conversion", "Conversion"), 
            "CUSTOM": ("custom", "Custom Event")
        }
        
        for keyword, (event_name, event_type) in pinterest_events.items():
            if keyword in dep_value:
                return pixel_id, event_name, event_type
        
        event_name = data.get(self.config.event_name_key, "Unknown")
        return pixel_id, event_name, "Pinterest Event"


class DoubleClickEventHandler(BaseEventHandler):
    """Specialized handler for DoubleClick events"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        request_path = data.get("_request_path", "")
        request_url = data.get("_request_url", "")
        
        # DDM Activity/Floodlight tracking (both formats)
        if "/ddm/activity/" in request_path:
            pixel_id, event_name = self._extract_ddm_activity_info(request_path, data)
            event_name = "Floodlight Activity"
            return pixel_id, event_name, "Floodlight Activity"
        elif "activity" in request_path:
            pixel_id, event_name = self._extract_activity_semicolon_params(request_url, data)
            event_name = "Floodlight Activity"
            return pixel_id, event_name, "Floodlight Activity"
        elif "google_com" in request_path:
            return "", "Cookie Matching", "Cookie Matching"
        
        # View-through conversion tracking
        elif "/pagead/viewthroughconversion/" in request_path:
            if match := re.search(r'/pagead/viewthroughconversion/(\d+)/', request_path):
                pixel_id = match.group(1)
                event_name = "View-Through Conversion"
                if cv := data.get("cv"):
                    event_name += f" (${cv})"
                return pixel_id, event_name, "View-Through Conversion"
            return "", "View-Through Conversion", "View-Through Conversion"
        
        # GA4 Enhanced Conversions
        elif "/g/collect" in request_path:
            pixel_id = data.get("tid", "")
            event_type = data.get("t", "")
            event_name = "GA Signals" if event_type == "dc" else f"GA4 {event_type}" if event_type else "GA4 Event"
            return pixel_id, event_name, "Enhanced Conversion"
        
        # Standard DoubleClick tracking
        else:
            pixel_id = data.get("tid", data.get("label", ""))
            event_name = data.get("t", data.get("label", "DoubleClick Evenxxxt"))
            return pixel_id, event_name, "Display Tracking"
    
    def _extract_activity_semicolon_params(self, request_url: str, data: Dict[str, str]) -> tuple[str, str]:
        """Extract parameters from /activity;param1=value1;param2=value2;... format"""
        # Extract the path part after the domain
        if '://ad.doubleclick.net/' in request_url:
            path_part = request_url.split('://ad.doubleclick.net/')[-1]
            
            if path_part.startswith('activity;'):
                # Remove 'activity;' prefix and parse parameters
                param_string = path_part[9:]  # Remove 'activity;'
                
                # Parse semicolon-separated parameters
                params = {}
                for param in param_string.split(';'):
                    if '=' in param:
                        key, value = param.split('=', 1)
                        import urllib.parse
                        value = urllib.parse.unquote(value)
                        params[key] = value
                
                # Extract key identifiers
                src_id = params.get('src', '')  # Advertiser/source ID
                activity_type = params.get('type', '')  # Activity type
                category = params.get('cat', '')  # Activity category
                ord_id = params.get('ord', '')  # Order ID
                
                # Create meaningful pixel ID and event name
                pixel_id = src_id if src_id else "Unknown"
                
                if activity_type and category:
                    event_name = f"Floodlight_{activity_type}_{category}"
                elif activity_type:
                    event_name = f"Floodlight_{activity_type}"
                else:
                    event_name = "Floodlight_Activity"
                
                # Add order info if present and not default
                if ord_id and ord_id != '1':
                    event_name += f"_ord{ord_id}"
                
                return pixel_id, event_name
        
        # Fallback if parsing fails
        return "Unknown", "Floodlight_Activity"
    
    def _extract_ddm_activity_info(self, request_path: str, data: Dict[str, str]) -> tuple[str, str]:
        """Extract DDM Activity/Floodlight information from path parameters"""
        # Extract activity parameters from path like: /ddm/activity/gdpr=0;src=10802082;type=invmedia;cat=de-gr0;...
        activity_part = request_path.split('/ddm/activity/')[-1].split('?')[0]
        
        # Parse semicolon-separated parameters
        params = {}
        for param in activity_part.split(';'):
            if '=' in param:
                key, value = param.split('=', 1)
                # Decode URL encoding and template variables
                import urllib.parse
                value = urllib.parse.unquote(value)
                params[key] = value
        
        # Extract key identifiers
        src_id = params.get('src', '')  # Advertiser/source ID
        activity_type = params.get('type', '')  # Activity type
        category = params.get('cat', '')  # Activity category
        ord_id = params.get('ord', '')  # Order ID
        
        # Create meaningful pixel ID and event name
        pixel_id = src_id if src_id else "Unknown"
        
        if activity_type and category:
            event_name = f"Floodlight_{activity_type}_{category}"
        elif activity_type:
            event_name = f"Floodlight_{activity_type}"
        else:
            event_name = "Floodlight_Activity"
        
        # Add order info if present
        if ord_id and ord_id != '1':
            event_name += f"_ord{ord_id}"
        
        return pixel_id, event_name


class MicrosoftBingEventHandler(BaseEventHandler):
    """Specialized handler for Microsoft/Bing UET events"""
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        request_path = data.get("_request_path", "")
        pixel_id = data.get(self.config.pixel_id_key, "")
        event_name = data.get(self.config.event_name_key, "")
        event_type = "UET Tracking"

        # Path-based classification
        if "/p/insights/t/" in request_path:
            match = re.search(r'/p/insights/t/(\d+)', request_path)
            if match:
                pixel_id = match.group(1)
            event_name = "UET_Insights"
            event_type = "Analytics Insights"

        elif "/p/insights/c/j" in request_path:
            event_name = "UET_JavaScript"
            event_type = "JavaScript Library"

        elif "/action/" in request_path:
            evt = data.get("evt", "")
            event_name = evt if evt else "UET_Action"

            if evt.lower() in ["conversion", "goal", "purchase"]:
                event_type = "Conversion Tracking"
            else:
                event_type = "Action Tracking"

        elif "/bat.js" in request_path or "/uet.js" in request_path:
            event_name = "UET_Library_Load"
            event_type = "JavaScript Library"

        else:
            # Fallback
            if not event_name or event_name == "Unknown":
                event_name = "UET_Event"
            event_type = "UET Tracking"

        return pixel_id, event_name, event_type
    
    def extract_platform_info(self, data: Dict[str, str], mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
        extra_info = []
        
        # Goal value and currency
        if goal_value := mapped_data.get('goal_value'):
            currency = mapped_data.get('goal_currency', '')
            extra_info.append(self._format_value_currency(goal_value, currency))
        
        if revenue := mapped_data.get('revenue'):
            extra_info.append(f"revenue: {revenue}")
        
        # Page URL
        if page_url := mapped_data.get('page_url'):
            domain = page_url.split("//")[-1].split("/")[0] if "//" in page_url else page_url
            extra_info.append(f"domain: {domain}")
        
        return extra_info


class PrivacySandboxEventHandler(BaseEventHandler):
    """Specialized handler for Privacy Sandbox events"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        pixel_id = data.get(self.config.pixel_id_key, "")
        request_path = data.get("_request_path", "")
        host = data.get("_request_host", "")
        
        # Determine platform from request host
        if "facebook.com" in host:
            platform_name = "Facebook"
        elif any(pattern in host for pattern in ["google.com", "doubleclick.net", "googlesyndication.com","region1.google-analytics.com"]):
            platform_name = "Google"
        else:
            platform_name = "Privacy Sandbox"
        
        # Sandbox event mapping
        sandbox_events = {
            "/privacy_sandbox/topics/registration": "Topics Registration",
            "/privacy_sandbox/pixel/register/trigger": "Pixel Registration", 
            "/privacy_sandbox/topics/": "Topics API",
            "/privacy_sandbox/fledge/": "FLEDGE",
            "/privacy_sandbox/attribution_reporting/": "Attribution Reporting",
            "/privacy_sandbox/trust_tokens/": "Trust Tokens",
            "/privacy_sandbox/private_aggregation/": "Private Aggregation",
            "/privacy_sandbox/shared_storage/": "Shared Storage",
            "/privacy_sandbox/": "Privacy Sandbox"
        }
        
        event_type_name = "Privacy Sandbox Event"
        for path_pattern, sandbox_event_name in sandbox_events.items():
            if path_pattern in request_path:
                event_type_name = sandbox_event_name
                break
        
        if data.get("ev") == "PageView":
            return pixel_id, f"{platform_name} PageView", "Privacy-Enhanced Tracking"
        elif data.get("en"):
            event_name = data.get("en")
            return pixel_id, f"{platform_name} {event_type_name} {event_name}", "Privacy Sandbox"
        else:
            return pixel_id, f"{platform_name} {event_type_name}", "Privacy Sandbox"


class CCMEventHandler(BaseEventHandler):
    """Specialized handler for Google Consent Collection Module (CCM) events"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        pixel_id = data.get(self.config.pixel_id_key, "")
        request_path = data.get("_request_path", "")
        
        # Check for consent-related parameters to determine event type
        consent_state = data.get("gcs", "")
        gdpr_applies = data.get("gdpr", "")
        dma_state = data.get("dma", "")
        
        # Determine event type based on consent parameters
        if consent_state:
            if "G1" in consent_state:
                event_name = "Consent Granted"
                event_type = "Consent Update"
            elif "G0" in consent_state:
                event_name = "Consent Denied"
                event_type = "Consent Update"
            else:
                event_name = "Consent State Change"
                event_type = "Consent Update"
        elif gdpr_applies:
            event_name = "GDPR Compliance Check"
            event_type = "Privacy Compliance"
        elif dma_state:
            event_name = "DMA Consent Processing"
            event_type = "Privacy Compliance"
        else:
            event_name = "Consent Collection"
            event_type = "Privacy Data Collection"
        
        return pixel_id, event_name, event_type


class ConsentManagementPlatformEventHandler(BaseEventHandler):
    """Generic handler for all Consent Management Platform events (OneTrust, Usercentrics, Cookiebot, etc.)"""
    
    def extract_identifiers(self, data: Dict[str, str]) -> tuple[str, str, str]:
        pixel_id = data.get(self.config.pixel_id_key, "")
        request_path = data.get("_request_path", "")
        request_host = data.get("_request_host", "")
        
        # Detect CMP provider from host
        cmp_provider = self._detect_cmp_provider(request_host)
        
        # Determine event type based on URL path and parameters
        if any(path in request_path for path in ["/browser-ui/", "/otnotice/", "/cc.js", "/cs.js", "/uc.js"]):
            event_name = f"{cmp_provider} Banner Load"
            event_type = "Banner Display"
        elif any(path in request_path for path in ["/api/", "/consent/", "/groups/", "/choice.js"]):
            if "consent" in request_path.lower():
                event_name = f"{cmp_provider} Consent API"
                event_type = "Consent Processing"
            elif "settings" in request_path.lower() or "groups" in request_path.lower():
                event_name = f"{cmp_provider} Settings Load"
                event_type = "Configuration"
            else:
                event_name = f"{cmp_provider} API Request"
                event_type = "API Communication"
        elif any(path in request_path for path in ["/settings/", "/latest/", "/scripttemplates/"]):
            event_name = f"{cmp_provider} Configuration"
            event_type = "Settings"
        elif any(path in request_path for path in ["/privacy-notice/", "/cookie-policy/"]):
            event_name = f"{cmp_provider} Policy Load"
            event_type = "Policy Display"
        else:
            event_name = f"{cmp_provider} Activity"
            event_type = "Consent Management"
        
        return pixel_id, event_name, event_type
    
    def _detect_cmp_provider(self, host: str) -> str:
        """Detect which CMP provider based on hostname"""
        cmp_mapping = {
            "usercentrics": "Usercentrics",
            "cookielaw.org": "OneTrust", 
            "onetrust.com": "OneTrust",
            "optanon": "OneTrust",
            "cookiebot.com": "Cookiebot",
            "consentmanager": "ConsentManager",
            "consensu.org": "ConsentManager", 
            "iubenda.com": "Iubenda",
            "cookie-script.com": "CookieScript",
            "quantcast.com": "Quantcast",
            "trustarc.com": "TrustArc",
            "didomi": "Didomi"
        }
        
        for key, provider in cmp_mapping.items():
            if key in host.lower():
                return provider
        
        return "CMP"  # Generic fallback
    
    def extract_platform_info(self, data: Dict[str, str], mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
        extra_info = []
        
        # Version information (various CMP providers)
        if version := mapped_data.get('version'):
            extra_info.append(f"version: {version}")
        
        # Language/locale
        if language := mapped_data.get('language'):
            extra_info.append(f"lang: {language}")
        if location := mapped_data.get('location'):
            extra_info.append(f"location: {location}")
        
        # IDs and identifiers
        if group_id := mapped_data.get('group_id'):
            extra_info.append(f"group: {group_id}")
        if domain_id := mapped_data.get('domain_id'):
            extra_info.append(f"domain: {domain_id}")
        if website_id := mapped_data.get('website_id'):
            extra_info.append(f"site: {website_id}")
        if cookiebot_id := mapped_data.get('cookiebot_id'):
            extra_info.append(f"cbid: {cookiebot_id}")
        
        # Services/purposes
        if services := mapped_data.get('services'):
            try:
                if services.startswith('[') and services.endswith(']'):
                    import json
                    services_list = json.loads(services)
                    extra_info.append(f"services: {len(services_list)}")
                else:
                    extra_info.append(f"services: {services[:20]}")
            except:
                extra_info.append(f"services: {services[:20]}")
        
        # Consent data
        if consent_data := mapped_data.get('consent_data'):
            extra_info.append(f"consent: {consent_data[:15]}...")
        if consent_id := mapped_data.get('consent_id'):
            extra_info.append(f"consent_id: {consent_id}")
        
        # Controller/settings
        if controller_id := mapped_data.get('controller_id'):
            extra_info.append(f"controller: {controller_id}")
        if settings_id := mapped_data.get('settings_id'):
            extra_info.append(f"settings: {settings_id}")
        
        return extra_info


# Event Handler Factory
EVENT_HANDLERS = {
    "GA4": GA4EventHandler,
    "sGTM": ServerSideGTMEventHandler,  # Use dedicated sGTM handler
    "Server-side GTM": ServerSideGTMEventHandler,  # Backward compatibility
    "Facebook": FacebookEventHandler,
    "Google Ads": GoogleAdsEventHandler,
    "LinkedIn": LinkedInEventHandler,
    "Pinterest": PinterestEventHandler,
    "Microsoft/Bing": MicrosoftBingEventHandler,
    "DoubleClick": DoubleClickEventHandler,
    "Privacy Sandbox": PrivacySandboxEventHandler,
    "Google Consent Collection": CCMEventHandler,
    "Consent Management Platform": ConsentManagementPlatformEventHandler
}


def get_event_handler(platform: str) -> BaseEventHandler:
    """Get appropriate event handler for platform"""
    if platform not in PLATFORMS:
        return BaseEventHandler(type('DefaultConfig', (), {
            'name': platform,
            'pixel_id_key': 'pixel_id',
            'event_name_key': 'event_name'
        })())
    
    config = PLATFORMS[platform]
    handler_class = EVENT_HANDLERS.get(platform, BaseEventHandler)
    return handler_class(config)


# Helper functions for platform-specific info extraction - moved to BaseEventHandler class


def extract_platform_specific_info(data: Dict[str, str], platform: str, mapped_data: Dict[str, str], event_name: str = "") -> List[str]:
    """Legacy function - now uses unified handler system"""
    handler = get_event_handler(platform)
    return handler.extract_platform_info(data, mapped_data, event_name)

def parse_product_data(data: Dict[str, str]) -> List[Dict[str, str]]:
    """Parse Enhanced Ecommerce product data efficiently"""
    products = []
    product_params = {k: v for k, v in data.items() if k.startswith('pr') and k[2:].isdigit()}
    
    for prod_value in product_params.values():
        try:
            decoded = urllib.parse.unquote(prod_value)
            product_info = {}
            
            for part in decoded.split('~'):
                if len(part) > 2:
                    prefix, value = part[:2], part[2:]
                    if prefix in {'nm': 'name', 'id': 'id', 'pr': 'price', 'br': 'brand', 'ca': 'category', 'qt': 'quantity'}:
                        product_info[{'nm': 'name', 'id': 'id', 'pr': 'price', 'br': 'brand', 'ca': 'category', 'qt': 'quantity'}[prefix]] = value
            
            if product_info:
                products.append(product_info)
        except Exception:
            continue
    
    return products

def process_json_event(json_data: Dict, event: Dict, url_params: Dict[str, str]) -> Dict[str, str]:
    """Process a single event from JSON batch"""
    event_data = url_params.copy()
    
    # Get GA4 parameter mapping for JSON processing
    ga4_param_map = PLATFORMS["GA4"].param_map
    
    # Add common fields
    for json_key, ga_key in ga4_param_map.items():
        if json_key in json_data:
            if json_key == 'non_personalized_ads':
                event_data['npa'] = '1' if json_data[json_key] else '0'
            else:
                event_data[ga_key] = str(json_data[json_key])
    
    # Add event data
    if 'name' in event:
        event_data['en'] = event['name']
    
    if 'params' in event:
        for param_key, param_value in event['params'].items():
            if param_key in ga4_param_map:
                event_data[ga4_param_map[param_key]] = str(param_value)
            else:
                prefix = f'ep.{param_key}'
                if isinstance(param_value, list):
                    event_data[prefix] = ', '.join(str(v) for v in param_value)
                else:
                    event_data[prefix] = str(param_value)
    
    return event_data


class UnifiedPlatformDetector:
    """Unified platform detection system"""
    
    def __init__(self):
        self.platform_cache = {}
    
    def detect_platform(self, host: str, path: str, flow: http.HTTPFlow = None) -> str:
        """Detect marketing platform from hostname AND path with unified logic"""
        cache_key = f"{host}:{path}"
        
        # Check cache first
        if cache_key in self.platform_cache:
            return self.platform_cache[cache_key]
        
        # HIGHEST PRIORITY: Privacy Sandbox detection by path (regardless of host)
        if "/privacy-sandbox" in path or "/privacy_sandbox" in path:
            self.platform_cache[cache_key] = "Privacy Sandbox"
            return "Privacy Sandbox"
        
        # HIGH PRIORITY: Google Consent Collection Module detection
        if path == "/ccm/collect" and host in ["www.google.com", "google.com", "www.googletagmanager.com", "googletagmanager.com"]:
            self.platform_cache[cache_key] = "Google Consent Collection"
            return "Google Consent Collection"
        
        # HIGH PRIORITY: Regional Google Analytics detection (pattern-based)
        if self._is_regional_ga4(host, path):
            self.platform_cache[cache_key] = "GA4"
            return "GA4"
        
        # Server-side GTM detection (integrated)
        if flow:
            sgtm_result = self._check_server_side_tracking(host, path, flow)
            if sgtm_result == "sGTM":
                self.platform_cache[cache_key] = "sGTM"
                return "sGTM"
        
        # Standard platform detection with path matching
        platform = self._detect_standard_platform(host, path)
        self.platform_cache[cache_key] = platform
        return platform
    
    def _is_regional_ga4(self, host: str, path: str) -> bool:
        """Check if this is a regional Google Analytics domain"""
        import re
        
        # GA4 paths that should be detected
        ga4_paths = ["/g/collect", "/g/s/collect", "/collect", "/r/collect", "/gtag/js", "/mp/collect"]
        
        # Check if path matches GA4 patterns
        path_matches = any(path.startswith(ga4_path) for ga4_path in ga4_paths)
        
        if not path_matches:
            return False
        
        # Regional Google Analytics patterns
        regional_patterns = [
            r"^region\d+\.analytics\.google\.com$",         # region1.analytics.google.com, region2.analytics.google.com, etc.
            r"^region\d+\.google-analytics\.com$",          # region1.google-analytics.com, region2.google-analytics.com, etc.
            r"^[a-z]{2,5}\d*\.analytics\.google\.com$",     # us1.analytics.google.com, eu2.analytics.google.com, asia1.analytics.google.com, etc.
            r"^[a-z]{2,5}\d*\.google-analytics\.com$",      # us1.google-analytics.com, eu2.google-analytics.com, asia1.google-analytics.com, etc.
        ]
        
        # Check if host matches any regional pattern
        for pattern in regional_patterns:
            if re.match(pattern, host):
                return True
        
        return False
    
    def _detect_standard_platform(self, host: str, path: str) -> str:
        """Detect standard platforms using configuration"""
        # First pass: Find platforms that match both host AND path (highest priority)
        for platform_name, config in PLATFORMS.items():
            if host in config.hosts:
                # Check if path matches any of the platform's paths
                if any(path.startswith(platform_path) for platform_path in config.paths):
                    return platform_name
        
        # Second pass: Fallback to host-only detection for platforms without specific path requirements
        for platform_name, config in PLATFORMS.items():
            if host in config.hosts:
                return platform_name
        
        # Return "Custom Tracking" instead of "Unknown" for proper response handling
        return "Custom Tracking"
    
    def _is_server_side_gtm(self, host: str, path: str, flow: http.HTTPFlow) -> bool:
        """Integrated server-side GTM detection based only on parameters."""
        # Skip if already known GA4 or DoubleClick hosts.
        # This check is now less relevant as the primary detection is parameter-based,
        # but it can serve as a quick exit path.
        if host in PLATFORMS["GA4"].hosts or host in PLATFORMS["DoubleClick"].hosts:
            return False
        
        # Use consolidated parameter extraction
        params = self._get_all_params(flow)
        
        # Use unified server-side detection logic (which is now parameter-based)
        detection_result = self._detect_server_side_tracking(host, path, params, advanced_scoring=True)
        
        if detection_result["is_server_side"] and detection_result["platform"] == "sGTM":
            if DEBUG_MODE:
                unified_logger.log_debug(f"[SGTM DETECTION] Host: {host}, Path: {path}, Score: {detection_result['score']}")
            return True
        
        return False
    
    def _check_server_side_tracking(self, host: str, path: str, flow: http.HTTPFlow) -> str:
        """Check server-side tracking and return platform name or None"""
        # Skip if already known platform hosts - prevent misclassification
        known_platform_hosts = set()
        for platform_config in PLATFORMS.values():
            known_platform_hosts.update(platform_config.hosts)
        
        if host in known_platform_hosts:
            return None
        
        # Use consolidated parameter extraction
        params = self._get_all_params(flow)
        
        # Use unified server-side detection logic (which is now parameter-based)
        detection_result = self._detect_server_side_tracking(host, path, params, advanced_scoring=True)
        
        if detection_result["is_server_side"] and detection_result["platform"] == "sGTM":
            if DEBUG_MODE:
                unified_logger.log_debug(f"[SGTM DETECTION] Host: {host}, Path: {path}, Score: {detection_result['score']}")
            return "sGTM"
        elif detection_result["is_server_side"] and detection_result["platform"] == "Custom Tracking":
            return "Custom Tracking"
        else:
            return None
    
    def _get_all_params(self, flow: http.HTTPFlow) -> Dict[str, str]:
        """Extract all parameters from request with caching"""
        if hasattr(flow, "_all_params_dict"):
            return flow._all_params_dict
        
        params = dict(flow.request.query)
        if flow.request.method == "POST" and flow.request.content:
            content_type = flow.request.headers.get("content-type", "").lower()
            try:
                post_text = flow.request.get_text()
                if "application/json" in content_type or post_text.strip().startswith("{"):
                    json_data = json.loads(post_text)
                    if isinstance(json_data, dict):
                        params.update(json_data)
                elif "application/x-www-form-urlencoded" in content_type:
                    post_params = urllib.parse.parse_qs(post_text)
                    params.update({k: v[0] for k, v in post_params.items() if v})
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass
        flow._all_params_dict = params
        return params
    
    def _has_tracking_indicators(self, params: Dict[str, str]) -> bool:
        """Check if parameters contain tracking indicators using enhanced config"""
        # Enhanced tracking detection with multiple parameter categories
        
        # Check GA4/sGTM parameters (most common)
        ga4_indicators = SGTM_INDICATORS['ga4_params']
        if sum(1 for p in ga4_indicators if p in params) >= 2:
            return True
        
        # Check for event parameters (strong indicator of tracking)
        event_indicators = SGTM_INDICATORS['eventParams']
        if any(p in params for p in event_indicators):
            return True
        
        # Check for tracking parameters (user/session identification)
        tracking_indicators = SGTM_INDICATORS['trackingParams']
        if sum(1 for p in tracking_indicators if p in params) >= 2:
            return True
        
        # Check consent and server GTM parameters
        consent_indicators = SGTM_INDICATORS['consent_params']
        server_gtm_indicators = SGTM_INDICATORS['serverGtmParams']
        if any(p in params for p in consent_indicators) and \
           any(p in params for p in server_gtm_indicators):
            return True
        
        # Check for session + value combination (e-commerce tracking)
        session_indicators = SGTM_INDICATORS['sessionParams']
        value_indicators = SGTM_INDICATORS['valueParams']
        if any(p in params for p in session_indicators) and \
           any(p in params for p in value_indicators):
            return True
        
        # Check for e-commerce parameters
        ecommerce_indicators = SGTM_INDICATORS['ecommerceParams']
        if sum(1 for p in ecommerce_indicators if p in params) >= 2:
            return True
        
        # Check platform-specific key parameters from config
        platform_key_params = set()
        for platform_config in PLATFORMS.values():
            platform_key_params.update([
                platform_config.pixel_id_key,
                platform_config.event_name_key
            ])
        
        # If we have pixel_id + event_name from any platform, it's likely tracking
        matching_platform_params = sum(1 for p in platform_key_params if p in params)
        if matching_platform_params >= 2:
            return True
        
        return False
    
    def _detect_server_side_tracking(self, host: str, path: str, params: Dict[str, str], advanced_scoring: bool = False) -> Dict[str, Union[bool, str, int]]:
        """Unified server-side tracking detection based only on parameters."""
        # All host and path checks have been removed as per user request.

        if advanced_scoring:
            # Advanced sGTM detection with scoring based only on parameters.
            
            # Parameter analysis for sGTM
            gtm_id = params.get('gtm', '')
            # GTM parameter can be either a standard container ID or a hashed container ID
            has_gtm_container = bool(gtm_id and (
                any(gtm_id.startswith(p) for p in SGTM_INDICATORS['gtm_id_prefixes']) or
                len(gtm_id) > 10  # Hashed container IDs are typically long
            ))
            
            tid_value = params.get('tid', '')
            has_tracking_id = tid_value and any(tid_value.startswith(p) for p in SGTM_INDICATORS['tracking_id_prefixes'])
            
            # Enhanced scoring for sGTM with new parameter categories
            score = 0
            # Host and path scoring removed.
            if has_gtm_container: score += 4
            if has_tracking_id: score += 2
            if sum(1 for p in SGTM_INDICATORS['ga4_params'] if p in params) >= 3: score += 2
            if any(p in params for p in SGTM_INDICATORS['consent_params']): score += 1
            if sum(1 for p in SGTM_INDICATORS['serverGtmParams'] if p in params) >= 1: score += 2
            
            # Enhanced parameter detection
            if any(p in params for p in SGTM_INDICATORS['eventParams']): score += 3  # Event parameters are strong indicators
            if sum(1 for p in SGTM_INDICATORS['trackingParams'] if p in params) >= 2: score += 2
            if any(p in params for p in SGTM_INDICATORS['sessionParams']): score += 1
            if any(p in params for p in SGTM_INDICATORS['valueParams']): score += 1
            if sum(1 for p in SGTM_INDICATORS['ecommerceParams'] if p in params) >= 2: score += 2
            if any(p in params for p in SGTM_INDICATORS['timestampParams']): score += 1
            
            # Legacy specific checks
            if 'en' in params and 'cid' in params: score += 1
            if 'gcs' in params: score += 1
            
            if DEBUG_MODE:
                unified_logger.log_debug(f"[SGTM SCORE] Host: {host}, Path: {path}, Score: {score}, GTM: {has_gtm_container}, TID: {has_tracking_id}")
            
            return {
                "is_server_side": score >= 1,
                "platform": "sGTM" if score >= 3 else "Custom Tracking",
                "score": score
            }
        else:
            # Basic server-side tracking detection based only on parameters.
            if self._has_tracking_indicators(params):
                return {"is_server_side": True, "platform": "Custom Tracking", "score": 1}
        
        return {"is_server_side": False, "platform": "None", "score": 0}
    
    def clear_cache(self):
        """Clear detection cache and clean up dynamic hosts"""
        if len(self.platform_cache) > 200:
            # Keep most common platforms, clear the rest
            common_platforms = {k: v for k, v in self.platform_cache.items() 
                              if v in ["GA4", "Facebook", "TikTok", "Google Ads", "sGTM"]}
            self.platform_cache.clear()
            self.platform_cache.update(common_platforms)
            


# Global detector instance
platform_detector = UnifiedPlatformDetector()


def detect_platform_from_host_and_path(host: str, path: str, flow: http.HTTPFlow = None) -> str:
    """Detect marketing platform from hostname AND path - handles conflicts like www.google.com"""
    return platform_detector.detect_platform(host, path, flow)

def get_param_map_for_platform(platform: str) -> Dict[str, str]:
    """Legacy function - now uses unified system"""
    if platform in PLATFORMS:
        return PLATFORMS[platform].param_map
    return {'pixel_id': 'pixel_id', 'event': 'event_name', 'value': 'value',
            'currency': 'currency', 'url': 'page_url', 'ref': 'referrer'}

def _format_pixel_id(pixel_id: str, platform: str) -> Dict[str, str]:
    """Format pixel ID using lookup rules"""
    if not pixel_id:
        return {"id": "", "type": "", "formatted": ""}
    
    formatter = PLATFORM_ID_FORMATTERS.get(platform)
    
    if isinstance(formatter, dict):
        # Handle prefix-based formatting (GA4, Google Ads)
        for prefix, (type_name, short_name) in formatter.items():
            if pixel_id.startswith(prefix):
                return {
                    "id": pixel_id,
                    "type": type_name,
                    "formatted": f"{pixel_id} ({short_name})"
                }
        # Special case for GA4 GTM containers
        if platform == "GA4" and len(pixel_id) > 10 and not pixel_id.startswith(("G-", "UA-")):
            return {
                "id": pixel_id,
                "type": "GTM Container (CCM)",
                "formatted": f"{pixel_id} (GTM-CCM)"
            }
    
    elif callable(formatter):
        # Handle lambda-based formatting
        result = formatter(pixel_id)
        if result:
            type_name, short_name = result
            return {
                "id": pixel_id,
                "type": type_name,
                "formatted": f"{pixel_id} ({short_name})"
            }
    
    # Handle other platforms
    if platform in ["Amazon", "Criteo", "Reddit", "Quora", "Outbrain", "Taboola"]:
        return {
            "id": pixel_id,
            "type": f"{platform} Pixel ID",
            "formatted": f"{pixel_id} ({platform[:3].upper()})"
        }
    
    # Generic fallback
    return {
        "id": pixel_id,
        "type": "Pixel/Property ID",
        "formatted": f"{pixel_id} ({platform})"
    }

def detect_javascript_endpoint(platform: str, request_path: str, request_url: str) -> Optional[Dict[str, str]]:
    """Detect if this is a JavaScript endpoint and return information about it"""
    js_patterns = {
        "Microsoft/Bing": {
            "/p/insights/c/j": "Bing Analytics JavaScript - Dynamic tracking code",
            "/p/insights/s/": "Bing Analytics Script Library - Versioned tracking library",
            "/p/insights/t/": "Bing UET Tag Insights - Event tracking endpoint",
            "/bat.js": "Bing Ads Tag JavaScript - UET tracking library",
            "/uet.js": "Universal Event Tracking JavaScript - Core tracking code"
        },
        "GA4": {
            "/gtag/js": "Google Analytics JavaScript - gtag library",
            "/gtm.js": "Google Tag Manager JavaScript - Container code"
        },
        "Facebook": {
            "/tr/": "Facebook Pixel JavaScript - Dynamic tracking code",
            "/sdk.js": "Facebook JavaScript SDK"
        }
    }
    
    # Check for common JavaScript file extensions and script paths
    if (request_path.endswith(('.js', '.json')) or 
        '/js' in request_path or 
        '/c/j' in request_path or 
        '/s/' in request_path):
        platform_patterns = js_patterns.get(platform, {})
        
        # Check for specific patterns
        for pattern, description in platform_patterns.items():
            if pattern in request_path:
                return {
                    "is_javascript": True,
                    "type": "JavaScript Library",
                    "description": description,
                    "pattern": pattern
                }
        
        # Generic JavaScript detection
        return {
            "is_javascript": True,
            "type": "JavaScript/JSON Response",
            "description": f"{platform} script or configuration file",
            "pattern": "Generic JS/JSON endpoint"
        }
    
    return None

def get_request_description(platform: str, event_name: str, data: Dict[str, str], request_path: Optional[str] = None) -> Optional[str]:
    """Generate descriptive text for special request types to display in details panel"""
    
    # Get base platform description from config
    base_description = None
    if platform in PLATFORMS:
        base_description = PLATFORMS[platform].description
    
    # Add special context for specific request types
    if platform == "GA4":
        # GTM Library Loading
        if event_name == "gtag_library_load":
            ga4_id = data.get("id", "")
            return (f"Google Tag Manager library loading request for GA4 property {ga4_id}. "
                   f"This loads the gtag.js JavaScript library required for GA4 tracking and "
                   f"initializes the measurement framework.")
        
        # Consent Mode (CCM) Requests
        elif request_path and "ccm/collect" in request_path:
            gdpr_status = "GDPR applies" if data.get("gdpr") == "1" else "Non-GDPR region"
            consent_mode = data.get("gcs", "Unknown")
            dma_status = "DMA compliance active" if data.get("dma") == "1" else "No DMA requirements"
            
            return (f"GA4 Consent Mode request - Privacy-compliant tracking with limited data collection. "
                   f"{gdpr_status}. Consent state: {consent_mode}. {dma_status}. "
                   f"This endpoint respects user privacy preferences and regulatory requirements "
                   f"by collecting only essential analytics data when full consent is not available.")
        
        # Legacy Universal Analytics warning
        elif data.get("tid", "").startswith("UA-"):
            return (f"Legacy Universal Analytics {event_name} event. "
                   f"Note: Universal Analytics was sunset in July 2023. Consider migrating to GA4.")
    
    elif platform == "Google Ads":
        # Add specific context for Google Ads request types
        if "conversion" in str(request_path):
            return f"{base_description} This is a conversion tracking request recording valuable user actions."
        elif data.get("t") == "sr" or "ga-audiences" in str(request_path):
            return f"{base_description} This is a remarketing request building audience lists for retargeting."
    
    elif platform == "Facebook":
        # Add specific context for Facebook event types
        fb_event_contexts = {
            "PageView": "This tracks basic page views for analytics and audience building.",
            "Purchase": "This tracks e-commerce purchases for conversion optimization.",
            "AddToCart": "This tracks shopping cart additions for retargeting campaigns.",
            "Lead": "This tracks lead generation events like form submissions.",
            "CompleteRegistration": "This tracks user registration completions.",
            "ViewContent": "This tracks product/content views for remarketing."
        }
        
        context = fb_event_contexts.get(event_name, f"This tracks the custom '{event_name}' event.")
        return f"{base_description} {context}"
    
    # For all other platforms, return the base description from config
    return base_description


# Utility functions for common patterns
def _extract_adwords_id(request_path: str) -> Optional[str]:
    """Extract AdWords ID from URL path patterns"""
    patterns = [
        r'/pagead/1p-conversion/(\d+)(?:/|\?|$)',
        r'/pagead/conversion/(\d+)(?:/|\?|$)', 
        r'/pagead/1p-user-list/(\d+)(?:/|\?|$)',
        r'/ads/conversion/(\d+)(?:/|\?|$)'
    ]
    
    for pattern in patterns:
        if match := re.search(pattern, request_path):
            return match.group(1)
    return None

# Legacy functions - consolidated into unified system


def extract_platform_identifiers(data: Dict[str, str], platform: str) -> tuple[str, str, str]:
    """Legacy function - now uses unified handler system"""
    handler = get_event_handler(platform)
    return handler.extract_identifiers(data)

def _get_highlight_info(pixel_id: str, platform: str, event_name: str) -> Dict[str, str]:
    """Generate universal highlighting information for all platforms"""
    highlight_info = {
        "primary_id": pixel_id,
        "platform": platform,
        "event_name": event_name,
        "highlight_text": "",
        "should_highlight": False
    }
    
    # Only highlight if we have a valid pixel_id
    if not pixel_id or pixel_id == "Unknown":
        return highlight_info
    
    # Create platform-specific highlighting text
    platform_colors = {
        "GA4": "#EA4335",
        "Facebook": "#1877F2", 
        "TikTok": "#000000",
        "LinkedIn": "#0077B5",
        "Twitter/X": "#1DA1F2",
        "Pinterest": "#E60023",
        "Snapchat": "#FFFC00",
        "Microsoft/Bing": "#00BCF2",
        "Google Ads": "#4285F4",
        "DoubleClick": "#4285F4",
        "Amazon": "#FF9900",
        "Criteo": "#F68B1E",
        "Reddit": "#FF4500",
        "Quora": "#B92B27",
        "Outbrain": "#0070F3",
        "Taboola": "#1A73E8",
        "sGTM": "#EA4335",
        "Server-side GTM": "#EA4335",
        "Privacy Sandbox": "#34A853"
    }
    
    # Generate highlighting text based on platform
    color = platform_colors.get(platform, "#6366F1")
    
    if platform == "GA4":
        # GA4 specific highlighting
        if pixel_id.startswith("G-"):
            highlight_info["highlight_text"] = f"GA4 {event_name} {pixel_id}"
        elif pixel_id.startswith("UA-"):
            highlight_info["highlight_text"] = f"UA {event_name} {pixel_id}"
        elif pixel_id.startswith("CCM-"):
            highlight_info["highlight_text"] = f"CCM {event_name} {pixel_id}"
        else:
            highlight_info["highlight_text"] = f"GA4 {event_name} {pixel_id}"
    
    elif platform == "Facebook":
        # Facebook specific highlighting - match the screenshot format
        if pixel_id.isdigit() and len(pixel_id) >= 15:
            highlight_info["highlight_text"] = f"Facebook PageView {pixel_id}"
        else:
            highlight_info["highlight_text"] = f"Facebook {event_name} {pixel_id}"
    
    elif platform == "LinkedIn":
        # LinkedIn specific highlighting
        if pixel_id.isdigit():
            highlight_info["highlight_text"] = f"LinkedIn {event_name} {pixel_id}"
        else:
            highlight_info["highlight_text"] = f"LinkedIn {event_name} {pixel_id}"
    
    elif platform == "Microsoft/Bing":
        # Microsoft/Bing specific highlighting
        if pixel_id.isdigit():
            highlight_info["highlight_text"] = f"Microsoft/Bing {event_name} {pixel_id}"
        else:
            highlight_info["highlight_text"] = f"Microsoft/Bing {event_name} {pixel_id}"
    
    else:
        # Generic highlighting for other platforms
        highlight_info["highlight_text"] = f"{platform} {event_name} {pixel_id}"
    
    highlight_info["should_highlight"] = True
    highlight_info["color"] = color
    
    return highlight_info

def process_marketing_pixel_event(data: Dict[str, str], platform: str, request_path: Optional[str] = None, request_url: Optional[str] = None, post_data: str = "") -> None:
    """Process a marketing pixel event from any platform"""
    unified_logger.log_debug(f"Processing {platform} event with {len(data)} parameters")
    
    param_map = get_param_map_for_platform(platform)
    
    # Map platform parameters to friendly names
    mapped_data = {}
    for platform_key, friendly_name in param_map.items():
        if platform_key in data:
            mapped_data[friendly_name] = data[platform_key]
    

    pixel_id, event_name, event_type = extract_platform_identifiers(data, platform)

    unified_logger.log_debug(f"{event_name}, {pixel_id}, {platform}")
    
    # Handle validation errors and unknown requests
    if event_name == "Unknown" and not pixel_id:
        # Generate unique hash for request/response matching
        request_hash = _generate_request_hash(request_url or "", post_data)
   
        # Standardized error event data structure
        error_event_data = {
            "platform": platform,
            "pixel_id": "",  # Empty since missing
            "event_type": "",
            "message": f"Missing {platform} event name and pixel ID",
            "request_hash": request_hash  # Add hash for response matching
        }
        # Filter out internal request metadata from raw_data
        clean_data = {k: v for k, v in data.items() if not k.startswith('_request_')}
        
        unified_logger.log_structured("custom_tracking", "not defined", error_event_data, 
                                      {"request_path": request_path, "raw_data": clean_data, "request_url": request_url})
        return
    
    # Additional debugging for missing event names (when pixel_id exists but event_name is Unknown)
    if event_name == "Unknown" and pixel_id:
        unified_logger.log_debug(f"Warning: {platform} pixel_id found ({pixel_id}) but event_name is Unknown. Available params: {list(data.keys())}")
    
    # Extract platform-specific information using unified function
    extra_info = extract_platform_specific_info(data, platform, mapped_data, event_name)
    
    # Format property/account ID
    try:
        property_info = _format_pixel_id(pixel_id, platform)
    except Exception as e:
        unified_logger.log_error(f"Property detection error: {e}")
        property_info = {"id": pixel_id, "type": "Unknown", "formatted": pixel_id}
    
    # Log to terminal for all marketing pixels with formatted property ID
    property_display = property_info["formatted"] if property_info["formatted"] else pixel_id
    unified_logger.log_info(f"{platform} {event_name} ({property_display})")
    
    # Add highlighting info for universal highlighting system
    highlight_info = _get_highlight_info(pixel_id, platform, event_name)
    
    # Process successful event (all platforms) - unified log type
    log_type = "marketing_pixel_event"
    
    # Generate unique hash for request/response matching
    request_hash = _generate_request_hash(request_url or "", post_data)
    
    event_data = {
        "platform": platform,
        "pixel_id": pixel_id,  # Keep for backwards compatibility
        "property_id": property_info["id"],
        "property_type": property_info["type"],
        "property_formatted": property_info["formatted"],
        "event_type": event_type,  # New field for event classification
        "extra_info": extra_info,
        "page_url": data.get("dl", data.get("url", data.get("u", ""))),
        "referrer_url": data.get("rl", data.get("ref", data.get("rf", ""))),
        "mapped_data": mapped_data,
        "highlight_info": highlight_info,
        "request_hash": request_hash  # Unique hash for matching
    }
    
    # Add descriptive text for special request types
    request_description = get_request_description(platform, event_name, data, request_path)
    if request_description:
        event_data["description"] = request_description
    
    # Detect JavaScript endpoints
    js_info = detect_javascript_endpoint(platform, request_path, request_url)
    if js_info:
        event_data["js_info"] = js_info
    
    # Add GA4-specific fields (maintain backwards compatibility)
    if platform == "GA4":
        event_data.update({
            "tracking_id": pixel_id,  # Keep for backwards compatibility
            "client_id": data.get("cid", ""),
            "products": parse_product_data(data),
            "page_location": data.get("dl", ""),
            "page_title": data.get("dt", "")

        })

    # if (data.get("gcs", "")):
    #     event_data.update({data.get("gcs", "")})
    
    
    # Filter out internal request metadata from raw_data
    clean_data = {k: v for k, v in data.items() if not k.startswith('_request_')}
    
    unified_logger.log_structured(log_type, event_name, event_data, 
                                  {"request_path": request_path, "raw_data": clean_data, "request_url": request_url})



def is_tracking_request(flow: http.HTTPFlow) -> bool:
    """Check if a request is a tracking request based only on parameters."""
    # This function now primarily relies on parameter-based detection.
    # The host and path checks are secondary.
    
    # Auto-detect server-side tracking patterns first, as they are the most reliable.
    if is_server_side_tracking_request(flow):
        return True

    # Then check for known tracking paths as a fallback.
    host = flow.request.pretty_host
    path = flow.request.path
    
    # More flexible path matching for tracking requests
    if host in ALL_HOSTS:
        # First try exact startswith matching
        if any(path.startswith(tracking_path) for tracking_path in ALL_PATHS):
            return True
        
        # Then try more flexible matching for common tracking patterns
        for tracking_path in ALL_PATHS:
            # Remove trailing slashes for comparison
            clean_tracking_path = tracking_path.rstrip('/')
            clean_request_path = path.rstrip('/').split('?')[0]  # Remove query params
            
            # Check if the path contains the tracking path segment
            if (clean_tracking_path in clean_request_path or 
                clean_request_path.startswith(clean_tracking_path) or
                # Handle cases like "/api/v1/settings" matching "/api/"
                (clean_tracking_path.endswith('/') and clean_request_path.startswith(clean_tracking_path.rstrip('/')))):
                return True

    # Debug logging for tracking request detection failures
    if DEBUG_MODE and host in ALL_HOSTS:
        unified_logger.log_debug(f"Host {host} found in ALL_HOSTS but path {path} not matched. Available paths: {list(ALL_PATHS)}")
    
    return False


def is_server_side_tracking_request(flow: http.HTTPFlow) -> bool:
    """Auto-detect server-side tracking requests based only on parameters."""
    host = flow.request.pretty_host
    path = flow.request.path
    
    # Use unified detection logic from platform detector, which is now parameter-based
    params = platform_detector._get_all_params(flow)
    detection_result = platform_detector._detect_server_side_tracking(host, path, params, advanced_scoring=False)
    
    if detection_result["is_server_side"]:
        return True
            
    return False


def is_server_side_gtm_request(host: str, path: str, flow: http.HTTPFlow) -> bool:
    """Legacy function - now uses unified detector"""
    return platform_detector._is_server_side_gtm(host, path, flow)


class UnifiedResponseProcessor:
    """Unified response processing for tracking and cookie handling"""
    
    def __init__(self):
        self.platform_detector = platform_detector
        self.logger = unified_logger
    
    def _debug_log(self, message: str) -> None:
        """Debug logging wrapper"""
        if DEBUG_MODE:
            unified_logger.log_debug(message)
    
    def _is_success_status(self, status_code: int) -> bool:
        """Check if status code indicates success"""
        return status_code in [200, 204, 302]
    
    def _is_error_status(self, status_code: int) -> bool:
        """Check if status code indicates error"""
        return status_code >= 400
    
    def _calculate_response_time(self, flow: http.HTTPFlow) -> str:
        """Calculate response time with error handling"""
        try:
            if (hasattr(flow, 'response') and hasattr(flow.response, 'timestamp_end') and 
                hasattr(flow.request, 'timestamp_start') and 
                flow.response.timestamp_end and flow.request.timestamp_start):
                response_time = (flow.response.timestamp_end - flow.request.timestamp_start) * 1000
                return f"{response_time:.0f}ms"
        except (AttributeError, TypeError):
            pass
        return ""
    
    def _detect_content_type(self, flow: http.HTTPFlow) -> tuple[str, bool]:
        """Detect content type and if it's JavaScript"""
        content_type = flow.response.headers.get("content-type", "").lower()
        is_javascript = any(js_type in content_type for js_type in ["javascript", "application/js", "text/js"])
        return content_type, is_javascript
    
    def _build_response_info(self, flow: http.HTTPFlow) -> dict:
        """Build comprehensive response information"""
        content_type, is_javascript = self._detect_content_type(flow)
        status_code = flow.response.status_code
        
        response_info = {
            "response_type": "JavaScript" if is_javascript else "Data",
            "content_type": content_type,
            "status_code": status_code
        }
        
        # Add response size
        if flow.response.content:
            response_info["response_size"] = f"{len(flow.response.content)} bytes"
        else:
            response_info["response_size"] = "0 bytes"
        
        # Add response timing
        if response_time := self._calculate_response_time(flow):
            response_info["response_time"] = response_time
        
        # Add cache headers
        if cache_control := flow.response.headers.get("cache-control"):
            response_info["cache_control"] = cache_control
        
        # Add etag (truncated if too long)
        if etag := flow.response.headers.get("etag"):
            response_info["etag"] = etag[:20] + "..." if len(etag) > 20 else etag
        
        return response_info
    
    def _create_response_metadata(self, flow: http.HTTPFlow, response_info: dict = None) -> dict:
        """Create standardized response metadata"""
        return {
            "request_path": flow.request.path,
            "raw_data": {},
            "request_url": flow.request.url,
            "response_headers": dict(flow.response.headers),
            "response_info": response_info or {}
        }
    
    def process_response(self, flow: http.HTTPFlow) -> None:
        """Process response for tracking status and cookie monitoring"""
        host = flow.request.pretty_host
        path = flow.request.path
        platform = self.platform_detector.detect_platform(host, path, flow)
        
        # Debug logging
        self._debug_log(f"Processing response for {platform} (host: {host}, path: {path})")
        
        # Process tracking response and cookies
        self._handle_tracking_response(flow, platform)
        self._handle_cookie_setting(flow)
    
    def _handle_tracking_response(self, flow: http.HTTPFlow, platform: str) -> None:
        """Handle response status for tracking requests"""
        request_key = f"{flow.request.method}:{flow.request.url}"
        status_code = flow.response.status_code
        
        # Generate request hash for matching
        post_data = flow.request.get_text() if flow.request.content else ""
        request_hash = _generate_request_hash(flow.request.url, post_data)
        
        # Build response information
        response_info = self._build_response_info(flow)
        content_type, is_javascript = self._detect_content_type(flow)
        
        # Handle JavaScript endpoints separately
        if is_javascript:
            self._handle_javascript_response(flow, platform, response_info)
            if self._is_success_status(status_code):
                self._log_successful_request(flow, platform, status_code, request_key)
            return
        
        # Handle different status codes for non-JavaScript responses
        if self._is_error_status(status_code):
            self._log_failed_request(flow, platform, status_code, request_hash)
        elif self._is_success_status(status_code):
            self._log_successful_response(flow, platform, status_code, request_hash, response_info)
    
    def _log_successful_response(self, flow: http.HTTPFlow, platform: str, status_code: int, request_hash: str, response_info: dict) -> None:
        """Log successful non-JavaScript response"""
        request_key = f"{flow.request.method}:{flow.request.url}"
        
        # Create status data for overlay
        status_data = {
            "request_url": flow.request.url,
            "platform": platform,
            "status_code": status_code,
            "method": flow.request.method,
            "success": True,
            "request_hash": request_hash,
            **response_info
        }
        
        # Send status update to overlay
        metadata = self._create_response_metadata(flow, response_info)
        self.logger.log_structured("request_status_update", "status_received", status_data, metadata)
        self._log_successful_request(flow, platform, status_code, request_key)
        
        # Debug logging
        self._debug_log(f"Response info sent: {response_info} for {flow.request.url}")
    
    def _log_failed_request(self, flow: http.HTTPFlow, platform: str, status_code: int, request_hash: str = "") -> None:
        """Log failed tracking request"""
        error_data = {
            "platform": platform,
            "status_code": status_code,
            "url": flow.request.url,
            "method": flow.request.method,
            "message": f"Tracking request failed with HTTP {status_code}",
            "request_hash": request_hash
        }
        metadata = self._create_response_metadata(flow)
        self.logger.log_structured("warning", "tracking_request_failed", error_data, metadata)
    
    def _log_successful_request(self, flow: http.HTTPFlow, platform: str, status_code: int, request_key: str) -> None:
        """Log and track successful request"""
        self._debug_log(f"✓ {platform} tracking success: HTTP {status_code}")
        
        # Store success status
        pending_requests[request_key] = {
            "status": "success",
            "status_code": status_code,
            "timestamp": time.time()
        }
        
        # Cleanup old entries
        self._cleanup_old_requests()
    
    def _handle_javascript_response(self, flow: http.HTTPFlow, platform: str, response_info: Dict[str, str]) -> None:
        """Handle JavaScript endpoint response with proper classification"""
        path = flow.request.path
        
        # Try to get a more specific description based on the path
        js_info = detect_javascript_endpoint(platform, path, flow.request.url)
        description = js_info["description"] if js_info else f"{platform} JavaScript Library"
        
        # Log to terminal
        self.logger.log_info(f"{platform} JavaScript Library ({description})")
        
        # Create structured log for overlay
        event_data = {
            "platform": platform,
            "endpoint_type": "javascript_library",
            "description": description,
            "content_type": flow.response.headers.get("content-type", ""),
            "status_code": flow.response.status_code,
            **response_info
        }
        
        self.logger.log_structured(
            "javascript_endpoint", 
            description, 
            event_data,
            {
                "request_path": path, 
                "raw_data": {}, 
                "request_url": flow.request.url,
                "response_headers": dict(flow.response.headers)
            }
        )
    
    def _cleanup_old_requests(self) -> None:
        """Clean up old request tracking data"""
        if len(pending_requests) > 500:
            oldest_keys = sorted(pending_requests.keys(), 
                               key=lambda k: pending_requests[k]["timestamp"])[:250]
            for old_key in oldest_keys:
                del pending_requests[old_key]
        
        # Also cleanup platform cache
        self.platform_detector.clear_cache()
    
    def _handle_cookie_setting(self, flow: http.HTTPFlow) -> None:
        """Handle cookie setting monitoring"""
        set_cookie_headers = flow.response.headers.get_all('set-cookie')
        if not set_cookie_headers:
            return
        
        host = flow.request.pretty_host
        path = flow.request.path
        
        # Debug: Log all cookie setting attempts
        self._debug_log(f"Cookies detected on {host}: {len(set_cookie_headers)} cookies")
        
        # Determine if this is a relevant domain
        is_tracking_domain = self._is_tracking_domain(host)
        is_target_domain = self._is_target_domain(host)
        
        self._debug_log(f"Cookie domain check - {host}: tracking={is_tracking_domain}, target={is_target_domain}")
        
        if is_tracking_domain or is_target_domain:
            cookies_info = self._extract_cookie_names(set_cookie_headers)
            if cookies_info:
                self._debug_log(f"Logging cookies for {host}: {cookies_info}")
                self._log_cookie_setting(host, path, cookies_info, is_tracking_domain, set_cookie_headers, flow.request.url)
            else:
                self._debug_log(f"No cookie names extracted from {len(set_cookie_headers)} headers")
        else:
            self._debug_log(f"Ignoring cookies from non-relevant domain: {host}")
    
    def _is_tracking_domain(self, host: str) -> bool:
        """Check if host is a tracking domain"""
        return host in ALL_HOSTS or any(domain in host for domain in 
                                       ['google', 'facebook', 'analytics', 'doubleclick', 'googlesyndication'])
    
    def _is_target_domain(self, host: str) -> bool:
        """Check if host is the target domain"""
        if not TARGET_DOMAIN:
            return False
        try:
            target_host = urllib.parse.urlparse(TARGET_DOMAIN).netloc
            return host == target_host or host.endswith(f'.{target_host}')
        except:
            return False
    
    def _extract_cookie_names(self, set_cookie_headers) -> List[str]:
        """Extract cookie names from Set-Cookie headers"""
        cookies_info = []
        for cookie_header in set_cookie_headers:
            cookie_parts = cookie_header.split(';')
            if cookie_parts:
                cookie_name_value = cookie_parts[0].strip()
                cookie_name = cookie_name_value.split('=')[0] if '=' in cookie_name_value else cookie_name_value
                cookies_info.append(cookie_name)
        return cookies_info
    
    def _log_cookie_setting(self, host: str, path: str, cookies_info: List[str], 
                           is_tracking_domain: bool, set_cookie_headers, request_url: str) -> None:
        """Log cookie setting event"""
        cookie_type = "tracking" if is_tracking_domain else "target_domain"
        
        cookie_data = {
            "host": host,
            "domain": host,  # Standardize with client-side
            "path": path,
            "action": "set",  # Standardize with client-side
            "cookies": cookies_info,
            "cookie_count": len(cookies_info),
            "cookie_type": cookie_type,
            "full_cookies": set_cookie_headers,
            # For compatibility with display logic, if single cookie provide as cookie_name
            "cookie_name": cookies_info[0] if len(cookies_info) == 1 else None
        }
        
        # Create a minimal flow-like object for metadata creation
        metadata = {
            "request_path": path,
            "raw_data": {},
            "request_url": request_url
        }
        
        self.logger.log_structured("cookie", "cookie_set", cookie_data, metadata)
        self._debug_log(f"✓ Logged {len(cookies_info)} cookies for {host} ({cookie_type})")


# Global response processor instance
response_processor = UnifiedResponseProcessor()


def response(flow: http.HTTPFlow) -> None:
    """Main response handler using unified processor"""
    response_processor.process_response(flow)

class UnifiedRequestProcessor:
    """Unified request processing pipeline"""
    
    def __init__(self):
        self.platform_detector = platform_detector
    
    def process_request(self, flow: http.HTTPFlow) -> None:
        """Unified request processing for all HTTP methods"""
        # Fast path exclusion for non-relevant files and JavaScript endpoints
        path = flow.request.path
        if (path.lower().endswith(('.js', '.html')) or 
            '/js' in path or 
            '/c/j' in path or 
            '/s/' in path):
            return
        
        # Use optimized tracking check
        if not is_tracking_request(flow):
            return
        
        host = flow.request.pretty_host
        platform = self.platform_detector.detect_platform(host, path, flow)
        
        # Extract request data based on method
        try:
            request_data = self._extract_request_data(flow, platform)
            
            # Get POST data for hash generation
            post_data = flow.request.get_text() if flow.request.content else ""
            
            # Process single request or batch
            if isinstance(request_data, list):
                # Handle batch requests (like GA4 JSON batches)
                for data in request_data:
                    process_marketing_pixel_event(data, platform, flow.request.path, flow.request.url, post_data)
            else:
                # Handle single request
                process_marketing_pixel_event(request_data, platform, flow.request.path, flow.request.url, post_data)
        
        except Exception as e:
            unified_logger.log_error(f"PARSE_ERROR: {str(e)[:100]}")
    
    def _extract_request_data(self, flow: http.HTTPFlow, platform: str) -> Union[Dict[str, str], List[Dict[str, str]]]:
        """Extract request data from GET/POST unified"""
        # Start with URL parameters
        url_params = dict(flow.request.query)
        
        # Add request metadata for platform handlers (will be filtered out of raw_data before logging)
        url_params["_request_path"] = flow.request.path
        url_params["_request_host"] = flow.request.pretty_host
        url_params["_request_url"] = flow.request.url
        
        if flow.request.method == "GET":
            return url_params
        
        # Handle POST requests
        if not flow.request.content:
            return url_params
        
        raw_data = flow.request.get_text()
        
        # Try to parse as JSON first (for all platforms)
        if raw_data.strip().startswith(('{', '[')):
            try:
                json_data = json.loads(raw_data)
                
                # Handle GA4 JSON batch requests specifically
                if platform == "GA4" and isinstance(json_data, dict) and 'events' in json_data and isinstance(json_data['events'], list):
                    # Return batch of processed events
                    return [process_json_event(json_data, event, url_params) for event in json_data['events']]
                
                # Handle generic JSON for other platforms
                else:
                    # Flatten JSON data to parameters
                    flattened_params = self._flatten_json_to_params(json_data)
                    url_params.update(flattened_params)
                    return url_params
                    
            except json.JSONDecodeError:
                # If JSON parsing fails, continue to URL-encoded parsing
                pass
        
        # URL-encoded POST requests (fallback)
        try:
            post_data = urllib.parse.parse_qs(raw_data)
            post_data = {k: (v[0] if v else "") for k, v in post_data.items()}
            url_params.update(post_data)
            return url_params
        except Exception:
            return url_params
    
    def _flatten_json_to_params(self, json_data: Union[Dict, List, str, int, float, bool], prefix: str = "") -> Dict[str, str]:
        """Flatten JSON data into parameter dictionary for non-GA4 platforms"""
        params = {}
        
        if isinstance(json_data, dict):
            for key, value in json_data.items():
                new_key = f"{prefix}.{key}" if prefix else key
                if isinstance(value, (dict, list)):
                    params.update(self._flatten_json_to_params(value, new_key))
                else:
                    params[new_key] = str(value) if value is not None else ""
        
        elif isinstance(json_data, list):
            for i, item in enumerate(json_data):
                new_key = f"{prefix}[{i}]" if prefix else f"item_{i}"
                if isinstance(item, (dict, list)):
                    params.update(self._flatten_json_to_params(item, new_key))
                else:
                    params[new_key] = str(item) if item is not None else ""
        
        else:
            # Handle primitive values
            key = prefix if prefix else "value"
            params[key] = str(json_data) if json_data is not None else ""
        
        return params


# Global request processor instance
request_processor = UnifiedRequestProcessor()


def request(flow: http.HTTPFlow) -> None:
    """Main request handler with unified processing"""
    request_processor.process_request(flow)