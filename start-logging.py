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
ENABLE_WEBSOCKET_OUTPUT = True  # Always enabled for this application
IGNORE_CERT_ERRORS = ignore_certificate_errors()
BROWSER_HEADLESS = get_browser_headless()

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

# Message buffer for late-connecting clients
message_buffer = []
MAX_BUFFER_SIZE = 50  # Keep last 50 messages

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

def send_to_websocket(message):
    """Send message to websocket clients via queue and buffer for late connections"""
    global message_buffer
    
    try:
        # Add to buffer for late-connecting clients
        message_buffer.append(message)
        
        # Keep buffer size manageable
        if len(message_buffer) > MAX_BUFFER_SIZE:
            message_buffer = message_buffer[-MAX_BUFFER_SIZE:]
        
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
                if ENABLE_WEBSOCKET_OUTPUT:
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
                        if event == 'user_consent_declined':
                            print(f"🚫 CONSENT DECLINED - User rejected all tracking", flush=True)
                            declined_cats = data.get('declined_categories', [])
                            if declined_cats:
                                print(f"   Denied: {', '.join(declined_cats)}", flush=True)
                        elif event == 'user_consent_given':
                            print(f"✅ CONSENT ACCEPTED - User granted tracking permissions", flush=True)
                            granted_cats = data.get('granted_categories', [])
                            denied_cats = data.get('denied_categories', [])
                            if granted_cats:
                                print(f"   Granted: {', '.join(granted_cats)}", flush=True)
                            if denied_cats:
                                print(f"   Denied: {', '.join(denied_cats)}", flush=True)
                        elif event.startswith('consent_'):
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
                    if line.strip().startswith('[STRUCTURED]') and ENABLE_WEBSOCKET_OUTPUT:
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

def create_ga4_logger_window(context):
    """Create a separate GA4 Logger window"""
    overlay_path = os.path.join(os.path.dirname(__file__), "ga4-logger-overlay.html")
    try:
        # Use goto() with file:// URL so relative paths work for CSS/JS
        logger_page = context.new_page()
        file_url = f"file://{os.path.abspath(overlay_path)}"
        logger_page.goto(file_url)
        logger_page.set_viewport_size({"width": 900, "height": 700})
        return logger_page
    except Exception as e:
        print(f"❌ Could not load overlay HTML: {e}", flush=True)
        return None

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
            '--disable-default-apps',
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
            '--disable-infobars'
        ]
        
        # Add certificate if available
        if cert_pem_path:
            launch_args.extend([
                f'--extra-ssl-cert-file={cert_pem_path}',
                '--ignore-urlfetcher-cert-requests'
            ])
            print("✅ Browser configured with mitmproxy certificate", flush=True)
        
        browser = p.chromium.launch(
            headless=False,
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
            overlay_page.set_viewport_size({"width": 900, "height": 700})
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


        # DataLayer, Cookie and Cookie Banner monitoring script (inject into site window)
        site_page.add_init_script("""
                // Basic test to ensure script injection is working
                console.log('[SCRIPT_INJECTION]', 'JavaScript injection successful!', new Date().toISOString());
                
                // Check frame context
                console.log('[FRAME_CHECK]', 'Is main frame:', window.self === window.top);
                console.log('[FRAME_CHECK]', 'Already injected:', !!window.dataLayerMonitoringInjected);
                
                if (window.self !== window.top || window.dataLayerMonitoringInjected) {
                    console.log('[FRAME_CHECK]', 'Skipping injection - iframe or already injected');
                    return;
                }
                window.dataLayerMonitoringInjected = true;

                // Unified DataLayer monitoring with consent tracking
                console.log('[DATALAYER_MONITOR]', 'DataLayer monitoring script loaded');
                
                window.dataLayer = window.dataLayer || [];
                let consentGranted = {marketing: false, analytics: false, storage: false};
                
                // Debug: Log initial dataLayer state
                console.log('[DATALAYER_MONITOR]', 'Initial dataLayer length:', window.dataLayer.length);
                
                const originalPush = window.dataLayer.push;
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

                // Test DataLayer monitoring with a sample event
                setTimeout(() => {
                    console.log('[DATALAYER_MONITOR]', 'Testing DataLayer push...');
                    window.dataLayer.push({
                        event: 'monitoring_test',
                        test: true,
                        timestamp: Date.now()
                    });
                }, 1000);

                // Client-side Cookie Observer
                console.log('[COOKIE_MONITOR]', 'Cookie monitoring script loaded');
                let lastCookieSnapshot = {};
                let cookieObserverActive = true;

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

                function detectCookieChanges() {
                    if (!cookieObserverActive) return;
                    
                    try {
                        const currentCookies = getCookieSnapshot();
                        const previousCookies = lastCookieSnapshot;
                        
                        // Detect new or modified cookies
                        for (const [name, value] of Object.entries(currentCookies)) {
                            if (!(name in previousCookies)) {
                                // New cookie
                                addCookieEvent('created', name, value, null);
                            } else if (previousCookies[name] !== value) {
                                // Modified cookie
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

                function isMarketingCookie(name, value) {
                    name = name.toLowerCase();
                    value = (value || '').toLowerCase();
                    
                    // Consolidated regex for marketing cookies
                    return /^(_ga|_gid|_gat|_gcl|_gac|__utm|_fb|fbp|fbc|_tt|_pin|_li|_hj|_clc|amplitude|mp_|ajs_|_mkto|__hs|_vwo|optly|gtm|adnxs|anj|criteo|cto|obuid|t_gid|ads|doubleclick|gads|facebook|tiktok|pinterest|linkedin|twitter|personalization_id|clarity|mixpanel|segment|pardot|visitor_id|marketo|hubspot|salesforce|sfdc|uuid2|outbrain|taboola|vwo|optimizely)/.test(name) ||
                           /(track|analytic|marketing|ads|pixel|beacon|conversion|affiliate|partner|retarget|audience|segment|cohort|campaign|advertisement)/.test(name + value);
                }

                // Consent checking function (uses global consentGranted from DataLayer monitoring)
                
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
                

                function addCookieEvent(action, name, newValue, oldValue) {
                    const timestamp = new Date().toLocaleTimeString();
                    const domain = window.location.hostname;
                    
                    // Check for marketing cookie violation
                    if (action === 'created' || action === 'modified') {
                        const isBannerVisible = isBannerStillVisible();
                        const isMarketing = isMarketingCookie(name, newValue);
                        const hasMarketingConsent = checkMarketingConsent();
                        
                        // Only flag as violation if banner is visible AND no marketing consent has been granted
                        if (isBannerVisible && isMarketing && !hasMarketingConsent) {
                            // Get all existing cookies for comprehensive violation reporting
                            const existingCookies = document.cookie.split(';');
                            const allMarketingCookies = [];
                            const allOtherCookies = [];
                            
                            existingCookies.forEach(cookie => {
                                const [cookieName, cookieValue] = cookie.trim().split('=').map(s => s.trim());
                                if (cookieName) {
                                    const truncatedValue = cookieValue ? (cookieValue.length > 50 ? cookieValue.substring(0, 50) + '...' : cookieValue) : null;
                                    if (isMarketingCookie(cookieName, cookieValue)) {
                                        allMarketingCookies.push({
                                            name: cookieName,
                                            value: truncatedValue,
                                            is_violating_cookie: cookieName === name
                                        });
                                    } else {
                                        allOtherCookies.push({
                                            name: cookieName,
                                            value: truncatedValue
                                        });
                                    }
                                }
                            });
                            
                            console.log('[MARKETING_COOKIE_VIOLATION]', JSON.stringify({
                                timestamp: new Date().toISOString(),
                                violation_type: 'marketing_cookie_while_banner_visible',
                                violating_cookie_name: name,
                                violating_cookie_value: newValue ? (newValue.length > 50 ? newValue.substring(0, 50) + '...' : newValue) : null,
                                action: action,
                                domain: domain,
                                url: window.location.href,
                                banner_visible: isBannerVisible,
                                marketing_consent: hasMarketingConsent,
                                severity: 'HIGH',
                                compliance_risk: 'GDPR_VIOLATION_RISK',
                                message: `Marketing cookie '${name}' was ${action} while cookie banner is visible and no marketing consent granted - potential GDPR violation`,
                                // Include comprehensive cookie context
                                all_marketing_cookies: allMarketingCookies,
                                all_other_cookies: allOtherCookies,
                                total_marketing_cookies: allMarketingCookies.length,
                                total_other_cookies: allOtherCookies.length
                            }));
                        }
                    }
                    
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
                        is_marketing_cookie: isMarketingCookie(name, newValue),
                        banner_visible: isBannerStillVisible()
                    }));
                }

                // Setup cookie monitoring
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

                // Initialize cookie monitoring
                lastCookieSnapshot = getCookieSnapshot();
                setupCookieObserver();

                // Note: SPA navigation detection is now handled by CDP (Chrome DevTools Protocol)
                // which is more reliable and doesn't require JavaScript injection

                // Cookie Banner Detection
                let cookieBannerDetected = false;
                let cookieBannerCurrentlyVisible = false;
                let cookieBannerObserver = null;
                let cookieBannerElement = null;

                function detectCookieBanner() {
                    if (cookieBannerDetected) return;

                    // Consolidated banner detection - essential selectors only
                    const bannerSelectors = [
                        // Generic patterns (cover 90% of cases)
                        '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
                        '[id*="privacy" i]', '[class*="privacy" i]', '[id*="gdpr" i]', '[class*="gdpr" i]',
                        
                        // Major CMP providers (consolidated)
                        '#onetrust-banner-sdk', '#CybotCookiebotDialog', '#usercentrics-cmp', '#BorlabsCookieBox',
                        '#truste-consent-track', '.qc-cmp-ui', '#cmpbox', '#iubenda-cs-banner', '#cookiescript_injected', 
                        '#didomi-notice', '.cc-window', '#cookieConsent', '[role="dialog"][aria-label*="cookie" i]'
                    ];

                    // Simplified text patterns
                    const cookieTextPattern = /(cookies?|privacy|consent|gdpr|accept.*cookie|we use cookie|personalized ads|manage.*cookie)/i;

                    let foundBanner = null;
                    let detectionMethod = '';

                    // Method 1: Check for elements with cookie-related selectors
                    for (const selector of bannerSelectors) {
                        try {
                            const elements = document.querySelectorAll(selector);
                            for (const element of elements) {
                                if (element.offsetWidth > 0 && element.offsetHeight > 0) {
                                    // Element is visible
                                    const rect = element.getBoundingClientRect();
                                    if (rect.width > 200 && rect.height > 50) { // Reasonable banner size
                                        foundBanner = element;
                                        detectionMethod = `selector: ${selector}`;
                                        break;
                                    }
                                }
                            }
                            if (foundBanner) break;
                        } catch (e) {
                            // Skip invalid selectors
                        }
                    }

                    // Method 2: Text-based detection for elements with cookie-related content
                    if (!foundBanner) {
                        const allElements = document.querySelectorAll('div, section, aside, header, footer, nav, main');
                        for (const element of allElements) {
                            if (element.offsetWidth > 0 && element.offsetHeight > 0) {
                                const text = element.textContent || '';
                                const rect = element.getBoundingClientRect();
                                
                                // Check if element contains cookie-related text and has reasonable size
                                if (text.length > 10 && rect.width > 200 && rect.height > 50) {
                                    if (cookieTextPattern.test(text)) {
                                        // Additional checks to avoid false positives
                                        if (text.length < 2000 && // Not too long (likely not main content)
                                            (rect.top < 100 || rect.bottom > window.innerHeight - 100 || // Top or bottom positioned
                                             element.style.position === 'fixed' || 
                                             element.style.position === 'absolute' ||
                                             getComputedStyle(element).position === 'fixed' ||
                                             getComputedStyle(element).position === 'absolute')) {
                                            foundBanner = element;
                                            detectionMethod = 'text pattern';
                                            break;
                                        }
                                    }
                                    if (foundBanner) break;
                                }
                            }
                        }
                    }

                    // Enhanced visibility check - only detect banners that are actually visible
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

                    if (foundBanner && !cookieBannerDetected && isElementTrulyVisible(foundBanner)) {
                        cookieBannerDetected = true;
                        cookieBannerElement = foundBanner;
                        cookieBannerCurrentlyVisible = true;
                        
                        const bannerInfo = {
                            tag: foundBanner.tagName.toLowerCase(),
                            id: foundBanner.id || '',
                            classes: Array.from(foundBanner.classList).join(' '),
                            text_preview: (foundBanner.textContent || '').substring(0, 200),
                            position: getComputedStyle(foundBanner).position,
                            z_index: getComputedStyle(foundBanner).zIndex,
                            detection_method: detectionMethod,
                            bounding_rect: {
                                top: foundBanner.getBoundingClientRect().top,
                                left: foundBanner.getBoundingClientRect().left,
                                width: foundBanner.getBoundingClientRect().width,
                                height: foundBanner.getBoundingClientRect().height
                            },
                            visible: isElementTrulyVisible(foundBanner),
                            url: window.location.href,
                            timestamp: new Date().toISOString()
                        };

                        console.log('[COOKIE_BANNER_DETECTED]', JSON.stringify(bannerInfo));
                        
                        // Check for existing marketing cookies when banner is detected
                        setTimeout(() => {
                            const existingCookies = document.cookie.split(';');
                            const marketingCookies = [];
                            
                            existingCookies.forEach(cookie => {
                                const [name, value] = cookie.trim().split('=').map(s => s.trim());
                                if (name && isMarketingCookie(name, value)) {
                                    marketingCookies.push({
                                        name: name,
                                        value: value ? (value.length > 50 ? value.substring(0, 50) + '...' : value) : null
                                    });
                                }
                            });
                            
                            if (marketingCookies.length > 0) {
                                console.log('[MARKETING_COOKIES_ALREADY_SET]', JSON.stringify({
                                    timestamp: new Date().toISOString(),
                                    url: window.location.href,
                                    domain: window.location.hostname,
                                    marketing_cookies: marketingCookies,
                                    cookie_count: marketingCookies.length,
                                    banner_just_detected: true,
                                    severity: 'MEDIUM',
                                    compliance_risk: 'GDPR_PRELOAD_VIOLATION',
                                    message: `${marketingCookies.length} marketing cookie(s) were already set before cookie banner appeared - potential GDPR violation`
                                }));
                            }
                        }, 100); // Small delay to ensure banner detection is complete
                        
                        // Also log buttons within the banner
                        const buttons = foundBanner.querySelectorAll('button, a, [role="button"]');
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
                                buttons: buttonInfo
                            }));
                        }
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

                // Initialize cookie banner detection
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', setupCookieBannerObserver);
                } else {
                    setupCookieBannerObserver();
                }

                console.log('[DATALAYER_MONITOR]', 'DataLayer monitoring injected.');
                console.log('[COOKIE_MONITOR]', 'Client-side cookie observer initialized.');
            """)

        def handle_console(msg):
            try:
                text = msg.text
                if text.startswith('[DATALAYER_EVENT]'):
                    event_data = json.loads(text.replace('[DATALAYER_EVENT] ', ''))
                    event_name = event_data.get('event', 'unknown')
                    data_field = event_data.get('data', {})
                    if event_name == 'unknown' and isinstance(data_field, dict) and data_field.get('0') == 'consent':
                        structured_log = create_structured_log(
                            "consent", f"consent_{data_field.get('1', 'unknown')}",
                            data_field.get('2', {}),
                            {"source": "datalayer", "raw_event": event_data}
                        )
                        event_name = f"consent_{data_field.get('1', 'unknown')}"
                        data_field_2 = data_field.get('2', {})
                
                        if event_name == 'consent_update':
                            # Check if all consent categories are denied
                            consent_categories = [
                                'ad_storage', 'analytics_storage', 'ad_personalization', 
                                'ad_user_data', 'functionality_storage', 'personalization_storage', 
                                'security_storage'
                            ]
                            
                            all_denied = True
                            any_consent_found = False
                            
                            for category in consent_categories:
                                if category in data_field_2:
                                    any_consent_found = True
                                    if data_field_2[category] != 'denied':
                                        all_denied = False
                                        break
                            
                            if any_consent_found and all_denied:
                                # All consent categories are denied - user declined consent
                                structured_log = create_structured_log(
                                    "consent", "user_consent_declined",
                                    {
                                        "consent_status": "declined",
                                        "all_categories_denied": True,
                                        "categories": data_field_2,
                                        "declined_categories": consent_categories,
                                        "url": "detected_from_datalayer"
                                    },
                                    {"source": "datalayer", "timestamp_string": event_data.get('timestamp', '')}
                                )
                            elif any_consent_found:
                                # Check if any categories are granted (consent accepted)
                                granted_categories = []
                                denied_categories = []
                                
                                for category in consent_categories:
                                    if category in data_field_2:
                                        if data_field_2[category] == 'granted':
                                            granted_categories.append(category)
                                        elif data_field_2[category] == 'denied':
                                            denied_categories.append(category)
                                
                                if granted_categories:
                                    # User accepted some or all consent
                                    structured_log = create_structured_log(
                                        "consent", "user_consent_given",
                                        {
                                            "consent_status": "accepted",
                                            "granted_categories": granted_categories,
                                            "denied_categories": denied_categories,
                                            "categories": data_field_2,
                                            "url": "detected_from_datalayer"
                                        },
                                        {"source": "datalayer", "timestamp_string": event_data.get('timestamp', '')}
                                    )
                                else:
                                    # Regular consent update with no clear accept/deny
                                    structured_log = create_structured_log(
                                        "datalayer", event_name, {"data_layer_data": data_field_2},
                                        {"source": "datalayer", "timestamp_string": event_data.get('timestamp', '')}
                                    )
                        
                    else:
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
                elif text.startswith('[COOKIE_BANNER_DETECTED]'):
                    banner_data = json.loads(text.replace('[COOKIE_BANNER_DETECTED] ', ''))
                    structured_log = create_structured_log(
                        "cookie_banner", "banner_detected",
                        {
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
                            "url": banner_data.get('url')
                        },
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
                            "url": button_data.get('url')
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
                elif text.startswith('[MARKETING_COOKIE_VIOLATION]'):
                    violation_data = json.loads(text.replace('[MARKETING_COOKIE_VIOLATION] ', ''))
                    structured_log = create_structured_log(
                        "violation", "marketing_cookie_while_banner_visible",
                        {
                            "violation_type": violation_data.get('violation_type'),
                            "violating_cookie_name": violation_data.get('violating_cookie_name'),
                            "violating_cookie_value": violation_data.get('violating_cookie_value'),
                            "action": violation_data.get('action'),
                            "domain": violation_data.get('domain'),
                            "url": violation_data.get('url'),
                            "severity": violation_data.get('severity'),
                            "compliance_risk": violation_data.get('compliance_risk'),
                            "message": violation_data.get('message'),
                            # Include comprehensive cookie context
                            "all_marketing_cookies": violation_data.get('all_marketing_cookies'),
                            "all_other_cookies": violation_data.get('all_other_cookies'),
                            "total_marketing_cookies": violation_data.get('total_marketing_cookies'),
                            "total_other_cookies": violation_data.get('total_other_cookies'),
                            # Keep legacy field for backward compatibility
                            "cookie_name": violation_data.get('violating_cookie_name'),
                            "cookie_value": violation_data.get('violating_cookie_value')
                        },
                        {
                            "source": "compliance_monitor",
                            "timestamp": violation_data.get('timestamp')
                        }
                    )
                    output_queue.put(structured_log)
                elif text.startswith('[MARKETING_COOKIES_ALREADY_SET]'):
                    preload_data = json.loads(text.replace('[MARKETING_COOKIES_ALREADY_SET] ', ''))
                    structured_log = create_structured_log(
                        "violation", "marketing_cookies_preloaded",
                        {
                            "violation_type": "marketing_cookies_before_banner",
                            "domain": preload_data.get('domain'),
                            "url": preload_data.get('url'),
                            "marketing_cookies": preload_data.get('marketing_cookies'),
                            "cookie_count": preload_data.get('cookie_count'),
                            "severity": preload_data.get('severity'),
                            "compliance_risk": preload_data.get('compliance_risk'),
                            "message": preload_data.get('message'),
                            "banner_just_detected": preload_data.get('banner_just_detected')
                        },
                        {
                            "source": "compliance_monitor",
                            "timestamp": preload_data.get('timestamp')
                        }
                    )
                    output_queue.put(structured_log)
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
            except (json.JSONDecodeError, KeyError):
                if ('[DATALAYER_EVENT]' in text or '[DATALAYER_MONITOR]' in text or 
                    '[COOKIE_EVENT]' in text or '[COOKIE_MONITOR]' in text or
                    '[COOKIE_BANNER_DETECTED]' in text or '[COOKIE_BANNER_BUTTONS]' in text or 
                    '[COOKIE_BANNER_MONITOR]' in text or '[MARKETING_COOKIE_VIOLATION]' in text or 
                    '[MARKETING_COOKIES_ALREADY_SET]' in text or '[COOKIE_BANNER_HIDDEN]' in text or 
                    '[SCRIPT_INJECTION]' in text or '[FRAME_CHECK]' in text):
                    output_queue.put(f"CLIENT: {text}")

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
                extra_data = {
                    "referrer": None,
                    "title": None,
                    "description": None,
                    "frame_id": frame.get('id', 'main_frame')
                }
                log_url_change(current_url, "cdp_frame_navigated", "url_change", None, extra_data)

        def handle_cdp_history_entry_added(event):
            """Handle when new history entries are added (pushState/replaceState)"""
            entry = event.get('entry', {})
            current_url = entry.get('url', '')
            extra_data = {"title": entry.get('title', '')}
            log_url_change(current_url, "cdp_history_entry", "spa_pageview", "history_entry", extra_data)

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