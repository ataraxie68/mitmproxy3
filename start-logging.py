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
ENABLE_DATALAYER_LOGGING = True  # Always enabled for this application
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
                        print(f"Consent: {event}", flush=True)
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

        # URL change detection for the site window
        def handle_framenavigated(frame):
            global last_logged_url
            if frame == site_page.main_frame:
                current_url = frame.url
                if current_url != last_logged_url:
                    # Get additional details for a richer log
                    try:
                        referrer = site_page.evaluate('document.referrer')
                    except Exception:
                        referrer = None

                    try:
                        title = site_page.title()
                    except Exception:
                        title = None
                    
                    try:
                        description_element = site_page.query_selector('meta[name="description"]')
                        description = description_element.get_attribute('content') if description_element else None
                    except Exception:
                        description = None

                    data = {
                        "to_url": current_url,
                        "from_url": last_logged_url,
                        "url": current_url,  # Keep for backward compatibility
                        "previous_url": last_logged_url, # Keep for backward compatibility
                        "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "referrer": referrer,
                        "title": title,
                        "description": description,
                        "frame_id": frame.name or "main_frame",
                        "timestamp": time.time()
                    }
                    
                    structured_log = create_structured_log(
                        "url_change", "page_navigation",
                        data,
                        {"source": "playwright"}
                    )
                    output_queue.put(structured_log)
                    last_logged_url = current_url

        site_page.on("framenavigated", handle_framenavigated)

        if ENABLE_DATALAYER_LOGGING:
            # DataLayer and Cookie monitoring script (inject into site window)
            site_page.add_init_script("""
                if (window.self !== window.top || window.dataLayerMonitoringInjected) return;
                window.dataLayerMonitoringInjected = true;

                // DataLayer monitoring
                window.dataLayer = window.dataLayer || [];
                window.dataLayer.push = (function(original_push) {
                    return function(...args) {
                        args.forEach(data => {
                            if (typeof data === 'object' && data !== null) {
                                console.log('[DATALAYER_EVENT]', JSON.stringify({
                                    timestamp: new Date().toLocaleTimeString(),
                                    event: data.event || 'unknown',
                                    data: data
                                }));
                            }
                        });
                        return original_push.apply(window.dataLayer, args);
                    };
                })(window.dataLayer.push);

                // Client-side Cookie Observer
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

                function addCookieEvent(action, name, newValue, oldValue) {
                    const timestamp = new Date().toLocaleTimeString();
                    const domain = window.location.hostname;
                    
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
                        url: window.location.href
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
                        else:
                            structured_log = create_structured_log(
                                "datalayer", event_name, data_field,
                                {"source": "datalayer", "timestamp_string": event_data.get('timestamp', '')}
                            )
                        output_queue.put(structured_log)
                    elif text.startswith('[COOKIE_EVENT]'):
                        cookie_data = json.loads(text.replace('[COOKIE_EVENT] ', ''))
                        action = cookie_data.get('action', 'unknown')
                        structured_log = create_structured_log(
                            "cookie", f"cookie_{action}",
                            {
                                "cookie_name": cookie_data.get('cookie_name'),
                                "action": action,
                                "new_value": cookie_data.get('new_value'),
                                "old_value": cookie_data.get('old_value'),
                                "domain": cookie_data.get('domain'),
                                "path": cookie_data.get('path'),
                                "host": cookie_data.get('host'),
                                "cookie_type": "client_side"
                            },
                            {
                                "source": "client_observer",
                                "timestamp": cookie_data.get('timestamp'),
                                "url": cookie_data.get('url')
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
                except (json.JSONDecodeError, KeyError):
                    if '[DATALAYER_EVENT]' in text or '[DATALAYER_MONITOR]' in text or '[COOKIE_EVENT]' in text or '[COOKIE_MONITOR]' in text:
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