import subprocess
import time
import signal
import os
import json
import sys
import threading
import queue
import socket
import websockets
import argparse
import urllib.parse
from playwright.sync_api import sync_playwright
from config import (
    get_websocket_port, get_websocket_host, is_debug_mode,
    get_browser_headless, ignore_certificate_errors
)

# macOS asyncio fix
if sys.platform == "darwin":
    import asyncio
    asyncio.set_event_loop_policy(asyncio.DefaultEventLoopPolicy())

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Load centralized configuration
WEBSOCKET_PORT = get_websocket_port()
WEBSOCKET_HOST = get_websocket_host()
DEBUG_MODE = is_debug_mode()
BROWSER_HEADLESS = get_browser_headless()
IGNORE_CERT_ERRORS = ignore_certificate_errors()

# Configuration
MITMPROXY_SCRIPT = "./ga4-logger.py"
ENABLE_WEBSOCKET_SERVER = True

# Global state
output_queue = queue.Queue()
websocket_message_queue = queue.Queue()
connected_clients = set()
websocket_server = None
last_logged_url = None
TARGET_DOMAIN = None
PROXY_SERVER = None  # Will be set when mitmproxy starts

# Message buffer for late-connecting clients
message_buffer = []
# Keep messages until URL change instead of fixed size limit

async def handle_websocket_client(websocket):
    """Handle new websocket client connections"""
    print(f"🔌 Browser overlay connected", flush=True)
    connected_clients.add(websocket)
    
    # Send welcome message
    await websocket.send(json.dumps({
        "timestamp": time.time(),
        "message": "🎯 Connected to embedded GA4 Logger server",
        "source": "embedded-server"
    }))
    
    # Send buffered messages to catch up
    if message_buffer:
        print(f"📤 Sending {len(message_buffer)} buffered messages to new client", flush=True)
        for buffered_msg in message_buffer:
            try:
                await websocket.send(json.dumps({
                    "timestamp": time.time(),
                    "message": buffered_msg,
                    "source": "ga4-logger-buffered"
                }))
            except Exception as e:
                print(f"❌ Error sending buffered message: {e}", flush=True)
                break
    
    try:
        async for message in websocket:
            pass  # Keep connection alive
    except websockets.exceptions.ConnectionClosed:
        print(f"🔌 Browser overlay disconnected", flush=True)
    except Exception as e:
        print(f"❌ Error handling browser client: {e}", flush=True)
    finally:
        connected_clients.discard(websocket)

async def broadcast_to_browsers(message):
    """Broadcast message to all connected browser overlays"""
    if connected_clients:
        ws_message = json.dumps({
            "timestamp": time.time(),
            "message": message,
            "source": "ga4-logger"
        })
        try:
            await asyncio.gather(
                *[client.send(ws_message) for client in connected_clients],
                return_exceptions=True
            )
        except Exception as e:
            print(f"❌ Broadcast error: {e}", flush=True)

def start_websocket_services():
    """Start both websocket server and broadcast handler"""
    def run_server():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        async def server_with_broadcast():
            # Start websocket server
            global websocket_server
            try:
                websocket_server = await websockets.serve(handle_websocket_client, WEBSOCKET_HOST, WEBSOCKET_PORT)
                print(f"✅ Embedded websocket server running on ws://{WEBSOCKET_HOST}:{WEBSOCKET_PORT}", flush=True)
                
                # Handle message broadcasting
                async def process_broadcast_queue():
                    while True:
                        try:
                            message = websocket_message_queue.get(timeout=1)
                            if message is None:
                                break
                            await broadcast_to_browsers(message)
                            websocket_message_queue.task_done()
                        except queue.Empty:
                            await asyncio.sleep(0.1)
                        except Exception as e:
                            print(f"❌ Broadcast error: {e}", flush=True)
                
                # Run both server and broadcast handler
                await asyncio.gather(
                    websocket_server.wait_closed(),
                    process_broadcast_queue()
                )
            except Exception as e:
                print(f"❌ Websocket service error: {e}", flush=True)
        
        try:
            loop.run_until_complete(server_with_broadcast())
        except Exception as e:
            print(f"❌ Server thread error: {e}", flush=True)
        finally:
            loop.close()
    
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    return server_thread

def clear_message_buffer():
    """Clear the message buffer - called on URL changes"""
    global message_buffer
    buffer_size = len(message_buffer)
    message_buffer.clear()
    if buffer_size > 0:
        print(f"🧹 Cleared message buffer ({buffer_size} messages) due to URL change", flush=True)

def extract_cookies_from_buffer():
    """Extract all cookies found in the message buffer"""
    global message_buffer
    
    cookies_found = []
    seen_cookies = set()  # Track unique cookies by name+domain combination
    
    for message in message_buffer:
        try:
            # Check if this is a structured log message
            if message.startswith('[STRUCTURED] '):
                log_data = json.loads(message[13:])  # Remove '[STRUCTURED] ' prefix
                log_type = log_data.get('type', '')
                event = log_data.get('event', '')
                data = log_data.get('data', {})
                
                # Extract cookies from cookie events
                if log_type == 'cookie':
                    # Handle both single cookie (cookie_name) and multiple cookies (cookies list)
                    cookie_names = []
                    if data.get('cookie_name'):
                        cookie_names.append(data.get('cookie_name'))
                    if data.get('cookies') and isinstance(data.get('cookies'), list):
                        cookie_names.extend(data.get('cookies'))
                    
                    # Remove duplicates while preserving order
                    seen_in_this_event = set()
                    unique_cookie_names = []
                    for cookie_name in cookie_names:
                        if cookie_name and cookie_name not in seen_in_this_event:
                            seen_in_this_event.add(cookie_name)
                            unique_cookie_names.append(cookie_name)
                    
                    cookie_domain = data.get('domain', '')
                    
                    # Process each cookie
                    for cookie_name in unique_cookie_names:
                        if not cookie_name:  # Skip empty names
                            continue
                            
                        # Create unique identifier for this cookie
                        cookie_key = f"{cookie_name}:{cookie_domain}"
                        
                        # Skip if we've already seen this cookie
                        if cookie_key in seen_cookies:
                            continue
                        
                        seen_cookies.add(cookie_key)
                        
                        cookie_info = {
                            'name': cookie_name,
                            'action': data.get('action', event),
                            'type': data.get('cookie_type', 'unknown'),
                            'domain': cookie_domain,
                            'path': data.get('path', ''),
                            'is_marketing': data.get('is_marketing_cookie', False),
                            'banner_visible': data.get('banner_visible', False),
                            'timestamp': log_data.get('timestamp', ''),
                            'source': 'structured_log'
                        }
                        
                        # Add detailed cookie information if available
                        if data.get('detailed_cookies'):
                            # Find the specific detailed cookie info for this cookie
                            for detailed_cookie in data.get('detailed_cookies', []):
                                if isinstance(detailed_cookie, dict) and detailed_cookie.get('name') == cookie_name:
                                    cookie_info['detailed_cookies'] = [detailed_cookie]
                                    break
                        
                        # Add cookie metadata if available
                        if data.get('cookie_metadata'):
                            cookie_info['metadata'] = data.get('cookie_metadata')
                        
                        cookies_found.append(cookie_info)
                
                # Extract cookies from violation events
                elif log_type == 'violation' and event == 'marketing_cookie_while_banner_visible':
                    violating_cookie_name = data.get('violating_cookie_name', data.get('cookie_name', ''))
                    violating_cookie_domain = data.get('domain', '')
                    
                    # Create unique identifier for this cookie
                    cookie_key = f"{violating_cookie_name}:{violating_cookie_domain}"
                    
                    # Skip if we've already seen this cookie
                    if cookie_key in seen_cookies:
                        continue
                    
                    seen_cookies.add(cookie_key)
                    
                    violating_cookie = {
                        'name': violating_cookie_name,
                        'action': data.get('action', 'set'),
                        'type': 'marketing_violation',
                        'domain': violating_cookie_domain,
                        'is_marketing': True,
                        'banner_visible': True,
                        'severity': data.get('severity', 'HIGH'),
                        'timestamp': log_data.get('timestamp', ''),
                        'source': 'violation_log'
                    }
                    cookies_found.append(violating_cookie)
                
                # Extract cookies from GDPR audit events
                elif log_type == 'gdpr_audit' and event == 'complete_cookie_audit':
                    if data.get('all_cookies'):
                        for cookie in data.get('all_cookies', []):
                            audit_cookie_name = cookie.get('name', '')
                            audit_cookie_domain = data.get('domain', '')
                            
                            # Create unique identifier for this cookie
                            cookie_key = f"{audit_cookie_name}:{audit_cookie_domain}"
                            
                            # Skip if we've already seen this cookie
                            if cookie_key in seen_cookies:
                                continue
                            
                            seen_cookies.add(cookie_key)
                            
                            audit_cookie = {
                                'name': audit_cookie_name,
                                'action': 'audit',
                                'type': 'audit',
                                'domain': audit_cookie_domain,
                                'is_marketing': cookie.get('is_marketing', False),
                                'value': cookie.get('value', ''),
                                'http_only': cookie.get('http_only', False),
                                'secure': cookie.get('secure', False),
                                'same_site': cookie.get('same_site', ''),
                                'timestamp': log_data.get('timestamp', ''),
                                'source': 'gdpr_audit'
                            }
                            cookies_found.append(audit_cookie)
            
            # Check for legacy cookie messages (non-structured)
            elif 'cookie' in message.lower() and any(keyword in message.lower() for keyword in ['set', 'get', 'delete', 'update']):
                # Try to extract basic cookie info from legacy messages
                legacy_cookie_name = 'unknown'
                legacy_cookie_domain = ''
                
                # Create unique identifier for this cookie
                cookie_key = f"{legacy_cookie_name}:{legacy_cookie_domain}"
                
                # Skip if we've already seen this cookie
                if cookie_key in seen_cookies:
                    continue
                
                seen_cookies.add(cookie_key)
                
                legacy_cookie = {
                    'name': legacy_cookie_name,
                    'action': 'legacy',
                    'type': 'legacy',
                    'domain': legacy_cookie_domain,
                    'is_marketing': False,
                    'banner_visible': False,
                    'timestamp': time.time(),
                    'source': 'legacy_message',
                    'raw_message': message
                }
                cookies_found.append(legacy_cookie)
                
        except (json.JSONDecodeError, KeyError, Exception) as e:
            # Skip malformed messages
            continue
    
    return cookies_found

def send_to_websocket(message):
    """Send message to websocket clients via queue and buffer for late connections"""
    global message_buffer
    
    try:
        # Add to buffer for late-connecting clients
        message_buffer.append(message)
        
        # Keep buffer size manageable - only clear on URL changes
        # (URL changes will be handled separately to clear the buffer)
        
        # Send to currently connected clients
        websocket_message_queue.put(message)
        return True
    except Exception as e:
        print(f"❌ Websocket queue error: {e}", flush=True)
        return False

def unified_output_handler():
    """Handle all output from the output_queue"""
    while True:
        try:
            message = output_queue.get(timeout=1)
            if message is None:
                break

            # Only send structured logs to websocket
            if message.startswith('[STRUCTURED]'):
                # Send to websocket
                send_to_websocket(message)
                # Also generate console output for certain structured events
                try:
                    log_data = json.loads(message[13:])  # Remove '[STRUCTURED] ' prefix
                    log_type = log_data.get('type', '')
                    event = log_data.get('event', '')
                    data = log_data.get('data', {})

                    if log_type == 'datalayer':
                        print(f"DL: {event}", flush=True)
                    elif log_type == 'url_change':
                        print(f"*** URL CHANGE ***", flush=True)
                        print(f"URL: {data.get('url', '')}", flush=True)
                    elif log_type == 'consent':
                        if event.startswith('consent_'):
                            consent_action = event.replace('consent_', '').replace('_', ' ').title()
                            print(f"✅ CONSENT: {consent_action}", flush=True)
                        else:
                            print(f"🔒 Consent: {event}", flush=True)
                            if data.get('consent_status'):
                                print(f"   Status: {data.get('consent_status')}", flush=True)
                    elif log_type == 'cookie':
                        cookie_name = data.get('cookie_name', '')
                        action = data.get('action', '')
                        is_marketing = data.get('is_marketing_cookie', False)
                        banner_visible = data.get('banner_visible', False)
                        
                        marker = "🔴" if (is_marketing and banner_visible) else "🟡" if is_marketing else "🔵"
                        risk_text = " [VIOLATION RISK]" if (is_marketing and banner_visible) else " [MARKETING]" if is_marketing else ""
                        
                        print(f"{marker} Cookie {action}: {cookie_name}{risk_text}", flush=True)
                    elif log_type == 'cookie_banner':
                        if event == 'banner_detected':
                            print(f"🍪 COOKIE BANNER DETECTED", flush=True)
                            print(f"   Method: {data.get('detection_method', 'unknown')}", flush=True)
                            print(f"   Element: {data.get('banner_element', {}).get('tag', 'unknown')} (id={data.get('banner_element', {}).get('id', 'none')})", flush=True)
                            print(f"   Preview: {data.get('text_preview', '')[:100]}{'...' if len(data.get('text_preview', '')) > 100 else ''}", flush=True)
                        elif event == 'banner_buttons':
                            button_texts = [btn.get('text', '').strip() for btn in data.get('buttons', []) if btn.get('text', '').strip()]
                            if button_texts:
                                print(f"🍪 Cookie Banner Buttons: {', '.join(button_texts[:3])}", flush=True)
                        elif event == 'banner_hidden':
                            print(f"🍪 Cookie banner hidden ({data.get('reason', 'unknown')})", flush=True)
                    elif log_type == 'violation':
                        if event == 'marketing_cookie_while_banner_visible':
                            violating_cookie = data.get('violating_cookie_name', data.get('cookie_name', 'unknown'))
                            total_marketing = data.get('total_marketing_cookies', 0)
                            total_other = data.get('total_other_cookies', 0)
                            
                            print(f"⚠️  🚨 GDPR VIOLATION WARNING 🚨", flush=True)
                            print(f"   Violating cookie: '{violating_cookie}' {data.get('action', 'set')} while banner visible!", flush=True)
                            print(f"   Total marketing cookies: {total_marketing}, Other cookies: {total_other}", flush=True)
                            print(f"   Severity: {data.get('severity', 'HIGH')}", flush=True)
                            print(f"   Risk: {data.get('compliance_risk', 'GDPR_VIOLATION_RISK')}", flush=True)
                            
                            # Show all marketing cookies if available
                            if data.get('all_marketing_cookies'):
                                marketing_names = [cookie.get('name', 'unknown') for cookie in data.get('all_marketing_cookies', [])]
                                print(f"   All marketing cookies: {', '.join(marketing_names[:10])}{'...' if len(marketing_names) > 10 else ''}", flush=True)
                        elif event == 'marketing_cookies_preloaded':
                            cookie_count = data.get('cookie_count', 0)
                            print(f"⚠️  🚨 GDPR PRELOAD VIOLATION 🚨", flush=True)
                            print(f"   {cookie_count} marketing cookie(s) already set before banner appeared!", flush=True)
                            print(f"   Domain: {data.get('domain', 'unknown')}", flush=True)
                            print(f"   Severity: {data.get('severity', 'MEDIUM')}", flush=True)
                            print(f"   Risk: {data.get('compliance_risk', 'GDPR_PRELOAD_VIOLATION')}", flush=True)
                            if data.get('marketing_cookies'):
                                cookie_names = [cookie.get('name', 'unknown') for cookie in data.get('marketing_cookies', [])]
                                print(f"   Cookies: {', '.join(cookie_names[:5])}{'...' if len(cookie_names) > 5 else ''}", flush=True)
                except (json.JSONDecodeError, KeyError):
                    pass  # Skip malformed structured logs
            else:
                # Only print to terminal, do NOT send to websocket
                print(message, flush=True)
            output_queue.task_done()
        except queue.Empty:
            continue

def parse_arguments():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description="GA4 + Marketing Pixel Logger with mitmproxy",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python start-logging.py
  python start-logging.py --domain https://www.example.com
  python start-logging.py -d www.example.com
        """
    )
    parser.add_argument(
        '--domain', '-d',
        type=str,
        help='Target domain to monitor (e.g., https://www.example.com or www.example.com)'
    )
    return parser.parse_args()

def normalize_domain(domain_input):
    """Normalize domain input to a proper URL"""
    if not domain_input:
        return "https://www.handmadekultur.de"  # Default
    
    # Add protocol if missing
    if not domain_input.startswith(('http://', 'https://')):
        domain_input = f"https://{domain_input}"
    
    try:
        parsed = urllib.parse.urlparse(domain_input)
        return f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return "https://www.handmadekultur.de"  # Fallback to default

def extract_domain_from_url(url):
    """Extract domain from URL for cookie monitoring"""
    try:
        parsed = urllib.parse.urlparse(url)
        return parsed.netloc
    except Exception:
        return None

def find_available_port():
    """Find an available port on the system"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def start_mitmproxy():
    """Start mitmproxy subprocess and capture output"""
    mitmproxy_port = find_available_port()
    global PROXY_SERVER
    PROXY_SERVER = f"http://127.0.0.1:{mitmproxy_port}"
    
    cmd = ["mitmweb", "-p", str(mitmproxy_port), "-s", MITMPROXY_SCRIPT, "-q"]
    print(f"Starting mitmproxy with command: {' '.join(cmd)}", flush=True)
    
    env = os.environ.copy()
    env.update({'PYTHONUNBUFFERED': '1', 'PYTHONIOENCODING': 'utf-8'})
    
    # Pass target domain to mitmproxy script via environment variable
    if TARGET_DOMAIN:
        env['TARGET_DOMAIN'] = TARGET_DOMAIN
    
    try:
        proc = subprocess.Popen(
            cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True, bufsize=1
        )
        print(f"Mitmproxy process started with PID: {proc.pid}", flush=True)
        
        def read_output(stream, prefix):
            for line in iter(stream.readline, ''):
                if line.strip():
                    if line.strip().startswith('[STRUCTURED]'):
                        send_to_websocket(line.rstrip())
                    else:
                        output_queue.put(f"[{prefix}] {line.rstrip()}")
            stream.close()
        
        # Start output readers
        threading.Thread(target=read_output, args=(proc.stdout, "MITM_LOG"), daemon=True).start()
        threading.Thread(target=read_output, args=(proc.stderr, "MITM_ERR"), daemon=True).start()
        
        return proc
    except FileNotFoundError:
        print("ERROR: mitmdump not found. Please install mitmproxy: pip install mitmproxy", flush=True)
        return None
    except Exception as e:
        print(f"ERROR starting mitmproxy: {e}", flush=True)
        return None

def stop_mitmproxy(proc):
    """Stop the mitmproxy subprocess"""
    if proc:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()



def create_structured_log(log_type, event, data, metadata=None):
    """Create a structured log entry"""
    log_data = {
        'timestamp': time.time(),
        'type': log_type,
        'event': event,
        'data': data,
        'metadata': metadata or {}
    }
    return f"[STRUCTURED] {json.dumps(log_data, ensure_ascii=False, separators=(',', ':'))}"

def run_browser_with_proxy():
    """Launch Playwright with proxy and monitoring in two separate windows"""
    global last_logged_url

    with sync_playwright() as p:
        # Check for certificates in downloads folder
        downloads_cert_pem = os.path.join(os.path.dirname(__file__), "downloads", "mitmproxy-ca-cert.pem")
        downloads_cert_p12 = os.path.join(os.path.dirname(__file__), "downloads", "mitmproxy-ca-cert.p12")
        mitm_cert_pem = os.path.expanduser("~/.mitmproxy/mitmproxy-ca-cert.pem")
        
        # Determine which certificate to use
        cert_pem_path = None
        if os.path.exists(downloads_cert_pem):
            cert_pem_path = downloads_cert_pem
            print(f"✅ Using certificate from downloads: {downloads_cert_pem}", flush=True)
        elif os.path.exists(mitm_cert_pem):
            cert_pem_path = mitm_cert_pem
            print(f"✅ Using certificate from ~/.mitmproxy: {mitm_cert_pem}", flush=True)
        else:
            print("⚠️  No mitmproxy certificates found", flush=True)
        
        # Enhanced browser launch args with stealth features
        launch_args = [
            '--ignore-certificate-errors', 
            '--ignore-ssl-errors', 
            '--ignore-certificate-errors-spki-list',
            '--disable-web-security',
            '--allow-running-insecure-content',
            '--test-type',
            '--reduce-security-for-testing',
            # Hide automation signatures
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-plugins',
            # '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI,BlinkGenPropertyTrees',
            '--disable-ipc-flooding-protection',
            '--no-first-run',
            '--no-default-browser-check',
            '--no-pings',
            '--no-sandbox',
            '--disable-infobars',
            '--hide-crash-restore-bubble',
            '--disable-background-mode',
            '--disable-restore-session-state',
            '--disable-features=TranslateUI',
            '--disable-component-extensions-with-background-pages',
            '--disable-extensions',
            '--disable-component-update',
            '--disable-client-side-phishing-detection',
            '--disable-hang-monitor',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            # '--kiosk',
            # '--window-size=1200,1000',
            '--window-position=100,100'
        ]
        
        # Add certificate if available
        if cert_pem_path:
            launch_args.extend([
                f'--extra-ssl-cert-file={cert_pem_path}',
                '--ignore-urlfetcher-cert-requests'
            ])
            print("✅ Browser configured with mitmproxy certificate", flush=True)
        
        browser = p.chromium.launch(
            headless=BROWSER_HEADLESS,
            proxy={"server": PROXY_SERVER},
            args=launch_args
        )
        # Context 1: Overlay window
        overlay_context = browser.new_context(ignore_https_errors=True)
        overlay_page = overlay_context.new_page()
        overlay_path = os.path.join(os.path.dirname(__file__), "ga4-logger-overlay.html")
        try:
            # Use goto() with file:// URL so relative paths work for CSS/JS
            file_url = f"file://{os.path.abspath(overlay_path)}"
            overlay_page.goto(file_url)
            overlay_page.set_viewport_size({"width": 1000, "height": 900})
        except Exception as e:
            print(f"❌ Could not load overlay HTML: {e}", flush=True)

        # Context 2: Website window
        downloads_path = os.path.join(os.path.dirname(__file__), "downloads")
        os.makedirs(downloads_path, exist_ok=True)
        
        site_context = browser.new_context(
            ignore_https_errors=True,
            accept_downloads=True,
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        
        site_page = site_context.new_page()
        
        # Hide automation signatures via JavaScript
        site_page.add_init_script("""
            // Hide webdriver property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => false,
            });
            
            // Hide automation indicators
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
            
            // Spoof chrome runtime
            window.chrome = {
                runtime: {}
            };
            
            // Hide playwright signatures
            delete window.__playwright;
            delete window.__pw_manual;
            
            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
            
            // Hide automation in plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });
        """)

        # Download handler - save to project directory
        def handle_download(download):
            try:
                filename = download.suggested_filename or f"download_{int(time.time())}"
                download_path = os.path.join(downloads_path, filename)
                # Wait for download to complete and save
                download.save_as(download_path)
                print(f"📥 Downloaded: {filename} → {download_path}", flush=True)
                
                # Also create a structured log entry
                structured_log = create_structured_log(
                    "info", "file_download",
                    {
                        "filename": filename,
                        "path": download_path,
                        "url": download.url,
                        "suggested_filename": download.suggested_filename
                    },
                    {"source": "download_handler"}
                )
                output_queue.put(structured_log)
            except Exception as e:
                print(f"❌ Download failed: {e}", flush=True)
                structured_log = create_structured_log(
                    "error", "download_failed",
                    {"error": str(e), "filename": filename},
                    {"source": "download_handler"}
                )
                output_queue.put(structured_log)

        # Listen for download events on the page
        site_page.on("download", handle_download)
        
        # Also try to intercept downloads via context
        site_context.on("page", lambda page: page.on("download", handle_download))


        # Load and inject the monitoring script from external file
        monitor_script_path = os.path.join(os.path.dirname(__file__), "browser-monitor.js")
        try:
            with open(monitor_script_path, 'r', encoding='utf-8') as f:
                monitor_script = f.read()
            site_page.add_init_script(monitor_script)
            print(f"✅ Loaded monitoring script from: {monitor_script_path}", flush=True)
        except FileNotFoundError:
            print(f"❌ Monitoring script not found: {monitor_script_path}", flush=True)
        except Exception as e:
            print(f"❌ Error loading monitoring script: {e}", flush=True)

        def handle_console(msg):
            """UnifiedResponseProcessor: Handle all console messages from the browser"""
            try:
                text = msg.text
                
                # DataLayer Event Processing
                if text.startswith('[DATALAYER_EVENT]'):
                    event_data = json.loads(text.replace('[DATALAYER_EVENT] ', ''))
                    event_name = event_data.get('event', 'Object - expand for details')
                    data_field = event_data.get('data', {})
                    
                    # Handle consent events
                    if isinstance(data_field, dict) and data_field.get('0') == 'consent':
                        # Legacy consent format
                        consent_action = data_field.get('1', 'unknown')
                        consent_data = data_field.get('2', {})
                        
                        structured_log = create_structured_log(
                            "consent", f"consent_{consent_action}",
                            consent_data,
                            {"source": "datalayer", "raw_event": event_data}
                        )
                        output_queue.put(structured_log)
                        
                    else:
                        # Regular DataLayer event
                        structured_log = create_structured_log(
                            "datalayer", event_name, {"data_layer_data": data_field},
                            {"source": "datalayer", "timestamp_string": event_data.get('timestamp', '')}
                        )
                        output_queue.put(structured_log)
                elif text.startswith('[COOKIE_EVENT]'):
                    cookie_data = json.loads(text.replace('[COOKIE_EVENT] ', ''))
                    action = cookie_data.get('action', 'unknown')
                    cookie_name = cookie_data.get('cookie_name')

                    structured_log = create_structured_log(
                        "cookie", f"cookie_{action}",
                        {
                            "cookie_name": cookie_name,
                            "action": action,
                            "new_value": cookie_data.get('new_value'),
                            "old_value": cookie_data.get('old_value'),
                            "domain": cookie_data.get('domain'),
                            "path": cookie_data.get('path'),
                            "host": cookie_data.get('host'),
                            "cookie_type": "client_side",
                            # Add fields for consistency with server-side
                            "cookies": [cookie_name] if cookie_name else [],
                            "cookie_count": 1 if cookie_name else 0
                        },
                        {
                            "source": "client_observer",
                            "timestamp": cookie_data.get('timestamp'),
                            "url": cookie_data.get('url'),
                            "request_url": cookie_data.get('url')  # Add for consistency
                        }
                    )
                    output_queue.put(structured_log)
                        
                # Monitor Messages
                elif text.startswith('[DATALAYER_MONITOR]'):
                    monitor_msg = text.replace('[DATALAYER_MONITOR] ', '')
                    structured_log = create_structured_log(
                        "info", "datalayer_monitor", {"message": monitor_msg},
                        {"source": "datalayer"}
                    )
                    output_queue.put(structured_log)
                    
                elif text.startswith('[COOKIE_MONITOR]'):
                    monitor_msg = text.replace('[COOKIE_MONITOR] ', '')
                    structured_log = create_structured_log(
                        "info", "cookie_monitor", {"message": monitor_msg},
                        {"source": "client_observer"}
                    )
                    output_queue.put(structured_log)
                    
                # Cookie Banner Events
                elif text.startswith('[COOKIE_BANNER_DETECTED]'):
                    banner_data = json.loads(text.replace('[COOKIE_BANNER_DETECTED] ', ''))
                    
                    # Extract cookies found before banner detection
                    cookies_found = extract_cookies_from_buffer()
                    marketing_cookies = [c for c in cookies_found if c.get('is_marketing', False)]
                    non_marketing_cookies = [c for c in cookies_found if not c.get('is_marketing', False)]
                    
                    # Build combined data for banner_detected event
                    event_data = {
                        "banner_element": {
                            "tag": banner_data.get('tag'),
                            "id": banner_data.get('id'),
                            "classes": banner_data.get('classes'),
                            "position": banner_data.get('position'),
                            "z_index": banner_data.get('z_index')
                        },
                        "text_preview": banner_data.get('text_preview'),
                        "detection_method": banner_data.get('detection_method'),
                        "bounding_rect": banner_data.get('bounding_rect'),
                        "visible": banner_data.get('visible'),
                        "url": banner_data.get('url'),
                        "cmp_vendor": banner_data.get('cmp_vendor')
                    }
                    
                    # Add cookie data if cookies were found
                    if cookies_found:
                        print(f"🍪 Cookie Banner Detected - Found {len(cookies_found)} cookies in buffer:", flush=True)
                        print(f"   📊 Marketing cookies: {len(marketing_cookies)}", flush=True)
                        for cookie in marketing_cookies:
                            print(f"      - {cookie['name']} ({cookie['action']})", flush=True)
                        
                        print(f"   📊 Non-marketing cookies: {len(non_marketing_cookies)}", flush=True)
                        for cookie in non_marketing_cookies:
                            print(f"      - {cookie['name']} ({cookie['action']})", flush=True)
                        
                        # Add cookie data to the banner_detected event
                        event_data.update({
                            "total_cookies": len(cookies_found),
                            "marketing_cookies_count": len(marketing_cookies),
                            "non_marketing_cookies_count": len(non_marketing_cookies),
                            "marketing_cookies": marketing_cookies,
                            "non_marketing_cookies": non_marketing_cookies,
                            "all_cookies": cookies_found
                        })
                    else:
                        print(f"🍪 Cookie Banner Detected - No cookies found in buffer", flush=True)
                    
                    # Create single structured log with combined data
                    structured_log = create_structured_log(
                        "cookie_banner", "banner_detected",
                        event_data,
                        {
                            "source": "cookie_banner_detector",
                            "timestamp": banner_data.get('timestamp')
                        }
                    )
                    output_queue.put(structured_log)
                    
                elif text.startswith('[COOKIE_BANNER_BUTTONS]'):
                    button_data = json.loads(text.replace('[COOKIE_BANNER_BUTTONS] ', ''))
                    structured_log = create_structured_log(
                        "cookie_banner", "banner_buttons",
                        {
                            "buttons": button_data.get('buttons', []),
                            "button_count": len(button_data.get('buttons', [])),
                            "url": button_data.get('url'),
                            "cmp_vendor": button_data.get('cmp_vendor')
                        },
                        {
                            "source": "cookie_banner_detector",
                            "timestamp": button_data.get('timestamp')
                        }
                    )
                    output_queue.put(structured_log)
                    
                elif text.startswith('[COOKIE_BANNER_MONITOR]'):
                    monitor_msg = text.replace('[COOKIE_BANNER_MONITOR] ', '')
                    structured_log = create_structured_log(
                        "info", "cookie_banner_monitor", {"message": monitor_msg},
                        {"source": "cookie_banner_detector"}
                    )
                    output_queue.put(structured_log)
                    
                # Cookie Banner State Changes
                elif text.startswith('[COOKIE_BANNER_HIDDEN]'):
                    hidden_data = json.loads(text.replace('[COOKIE_BANNER_HIDDEN] ', ''))
                    structured_log = create_structured_log(
                        "cookie_banner", "banner_hidden",
                        {
                            "url": hidden_data.get('url'),
                            "reason": hidden_data.get('reason')
                        },
                        {
                            "source": "cookie_banner_detector",
                            "timestamp": hidden_data.get('timestamp')
                        }
                    )
                    output_queue.put(structured_log)
                    
            except (json.JSONDecodeError, KeyError) as e:
                # Handle malformed JSON or missing keys
                if any(marker in text for marker in [
                    '[DATALAYER_EVENT]', '[DATALAYER_MONITOR]', '[COOKIE_EVENT]', 
                    '[COOKIE_MONITOR]', '[COOKIE_BANNER_DETECTED]', '[COOKIE_BANNER_BUTTONS]', 
                    '[COOKIE_BANNER_MONITOR]', '[MARKETING_COOKIE_VIOLATION]', 
                    '[MARKETING_COOKIES_ALREADY_SET]', '[COOKIE_BANNER_HIDDEN]', 
                    '[GDPR_COOKIE_AUDIT]', '[SCRIPT_INJECTION]', '[FRAME_CHECK]'
                ]):
                    output_queue.put(f"CLIENT: {text}")
                    if DEBUG_MODE:
                        print(f"⚠️  Parse error in console message: {e}", flush=True)

        site_page.on("console", handle_console)

        print("Navigating to target site...", flush=True)
        print("Page loaded successfully!", flush=True)
        print("", flush=True)
        print("UNIFIED CONSOLE - Both GA4 and DataLayer events:", flush=True)
        print("   (Output may be interleaved)", flush=True)
        print("   Close the browser window to stop monitoring.", flush=True)
        print("", flush=True)
        print("="*50, flush=True)
        print("⏳ Waiting 3 seconds for overlay to connect...", flush=True)
        time.sleep(3)
        target_url = TARGET_DOMAIN or "https://www.handmadekultur.de"
        print(f"🌐 Navigating to: {target_url}", flush=True)
        
        # Consolidated CDP URL change logging function
        def log_url_change(current_url, source, event_type="spa_pageview", navigation_type=None, extra_data=None):
            """Consolidated function for logging URL changes from CDP events"""
            global last_logged_url
            
            if not current_url or current_url == last_logged_url:
                return False
            
            # Clear message buffer on URL change
            clear_message_buffer()
            
            data = {
                "to_url": current_url,
                "from_url": last_logged_url,
                "url": current_url,
                "previous_url": last_logged_url,
                "timestamp": time.time(),
                "frame_id": "main_frame",
                "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            
            if navigation_type:
                data["navigation_type"] = navigation_type
            
            if extra_data:
                data.update(extra_data)
            
            metadata = {"source": source}
            if navigation_type:
                metadata["detection_method"] = navigation_type
            
            structured_log = create_structured_log(event_type, "page_view" if event_type == "spa_pageview" else "page_navigation", data, metadata)
            output_queue.put(structured_log)
            last_logged_url = current_url
            
            nav_label = f" ({navigation_type})" if navigation_type else ""
            print(f"🌐 [CDP] Navigation{nav_label}: {current_url}", flush=True)
            return True

        def handle_cdp_frame_navigated(event):
            """Handle full page navigation"""
            frame = event.get('frame', {})
            if frame.get('parentId') is None:  # Only main frame
                current_url = frame.get('url', '')
                
                # Capture page metadata after navigation
                extra_data = {
                    "referrer": None,
                    "title": None,
                    "description": None,
                    "frame_id": frame.get('id', 'main_frame')
                }
                
                # Try to capture page metadata
                try:
                    # Wait a bit for the page to load
                 
                    
                    # Extract page metadata
                    page_metadata = site_page.evaluate("""
                        () => {
                            const metadata = {};
                            
                            // Page title
                            metadata.title = document.title || '';
                            
                            // Meta description
                            const metaDesc = document.querySelector('meta[name="description"]');
                            metadata.description = metaDesc ? metaDesc.getAttribute('content') : '';
                            
                            // Meta keywords
                            const metaKeywords = document.querySelector('meta[name="keywords"]');
                            metadata.keywords = metaKeywords ? metaKeywords.getAttribute('content') : '';
                            
                            // Open Graph tags
                            const ogTitle = document.querySelector('meta[property="og:title"]');
                            metadata.og_title = ogTitle ? ogTitle.getAttribute('content') : '';
                            
                            const ogDesc = document.querySelector('meta[property="og:description"]');
                            metadata.og_description = ogDesc ? ogDesc.getAttribute('content') : '';
                            
                            const ogImage = document.querySelector('meta[property="og:image"]');
                            metadata.og_image = ogImage ? ogImage.getAttribute('content') : '';
                            
                            const ogUrl = document.querySelector('meta[property="og:url"]');
                            metadata.og_url = ogUrl ? ogUrl.getAttribute('content') : '';
                            
                            // Twitter Card tags
                            const twitterTitle = document.querySelector('meta[name="twitter:title"]');
                            metadata.twitter_title = twitterTitle ? twitterTitle.getAttribute('content') : '';
                            
                            const twitterDesc = document.querySelector('meta[name="twitter:description"]');
                            metadata.twitter_description = twitterDesc ? twitterDesc.getAttribute('content') : '';
                            
                            const twitterImage = document.querySelector('meta[name="twitter:image"]');
                            metadata.twitter_image = twitterImage ? twitterImage.getAttribute('content') : '';
                            
                            // Canonical URL
                            const canonical = document.querySelector('link[rel="canonical"]');
                            metadata.canonical_url = canonical ? canonical.getAttribute('href') : '';
                            
                            // Language
                            metadata.language = document.documentElement.lang || '';
                            
                            // Viewport
                            const viewport = document.querySelector('meta[name="viewport"]');
                            metadata.viewport = viewport ? viewport.getAttribute('content') : '';
                            
                            // Robots
                            const robots = document.querySelector('meta[name="robots"]');
                            metadata.robots = robots ? robots.getAttribute('content') : '';
                            
                            return metadata;
                        }
                    """)
                    
                    extra_data.update(page_metadata)
                    
                except Exception as e:
                    # If metadata extraction fails, continue without it
                    pass
                
                log_url_change(current_url, "cdp_frame_navigated", "url_change", None, extra_data)


        def handle_cdp_navigated_within_document(event):
            """Handle same-document navigation (hash changes, pushState without full reload)"""
            global last_logged_url
            current_url = event.get('url', '')
            
            if current_url:
                # Determine navigation type
                old_hash = last_logged_url.split('#')[-1] if '#' in last_logged_url else ''
                new_hash = current_url.split('#')[-1] if '#' in current_url else ''
                nav_type = "hash_change" if old_hash != new_hash else "pushstate"
                
                extra_data = {"frame_id": event.get('frameId', 'main_frame')}
                log_url_change(current_url, "cdp_navigated_within_document", "spa_pageview", nav_type, extra_data)

        def handle_cdp_dom_content_event_fired(event):
            """Handle DOM content loaded events that might indicate SPA navigation"""
            try:
                current_url = site_page.url
                log_url_change(current_url, "cdp_dom_content", "spa_pageview", "dom_content_loaded")
            except Exception:
                pass

        # Enable comprehensive CDP navigation detection
        cdp = site_page.context.new_cdp_session(site_page)
        
        # Enable required domains
        cdp.send("Page.enable")
        cdp.send("Runtime.enable")  # For runtime events
        
        # Listen for multiple navigation events
        cdp.on("Page.frameNavigated", handle_cdp_frame_navigated)  # Full page navigation
        cdp.on("Page.navigatedWithinDocument", handle_cdp_navigated_within_document)  # SPA navigation
        cdp.on("Page.domContentEventFired", handle_cdp_dom_content_event_fired)  # DOM events
        
        
        print("🔍 [CDP] Enhanced SPA navigation detection enabled", flush=True)
        
        site_page.goto(target_url, wait_until="domcontentloaded")
        site_page.wait_for_event("close", timeout=0)

if __name__ == "__main__":
    # Parse command line arguments
    args = parse_arguments()
    
    # Set global target domain
    TARGET_DOMAIN = normalize_domain(args.domain)
    
    print("🚀 Starting unified GA4 Logger with embedded websocket server...", flush=True)
    if args.domain:
        print(f"🎯 Target domain: {TARGET_DOMAIN}", flush=True)
    
    # Start services
    if ENABLE_WEBSOCKET_SERVER:
        server_thread = start_websocket_services()
        time.sleep(2)
        print("✅ Using embedded websocket server", flush=True)
    else:
        print("⚠️  Websocket server/services are DISABLED.", flush=True)
    
    # Start output handler
    output_thread = threading.Thread(target=unified_output_handler, daemon=True)
    output_thread.start()

    # Start mitmproxy
    mitm_proc = start_mitmproxy()
    if mitm_proc is None:
        print("Failed to start mitmproxy. Exiting.", flush=True)
        exit(1)
        
    print("Waiting for mitmproxy to initialize...", flush=True)
    time.sleep(3)
    
    if mitm_proc.poll() is not None:
        print(f"❌ Mitmproxy process died with return code: {mitm_proc.returncode}", flush=True)
        exit(1)
    else:
        print("✅ Mitmproxy is running.", flush=True)
        print("🎯 GA4 events will now be captured and streamed to the overlay!", flush=True)
    
    try:
        run_browser_with_proxy()
    finally:
        print("Stopping all services...", flush=True)
        output_queue.put(None)
        websocket_message_queue.put(None)
        if websocket_server:
            websocket_server.close()
        stop_mitmproxy(mitm_proc)