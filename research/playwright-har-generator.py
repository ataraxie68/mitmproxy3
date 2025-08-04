#!/usr/bin/env python3
"""
Playwright HAR Generator with Python Script Generation
Captures HAR files and generates Python scripts for www.bechtle.com
"""

import asyncio
import json
import os
import time
from datetime import datetime
from playwright.async_api import async_playwright
import argparse

class PlaywrightHARGenerator:
    def __init__(self, target_url="https://www.bechtle.com", output_dir="har_outputs"):
        self.target_url = target_url
        self.output_dir = output_dir
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.har_data = None
        
        # Create output directory
        os.makedirs(output_dir, exist_ok=True)
        
    async def capture_har(self, headless=False, wait_time=10):
        """Capture HAR data from the target website"""
        print(f"🎯 Starting HAR capture for: {self.target_url}")
        print(f"⏱️  Waiting {wait_time} seconds for page load...")
        
        async with async_playwright() as p:
            # Launch browser with HAR recording
            browser = await p.chromium.launch(
                headless=headless,
                args=[
                    '--ignore-certificate-errors',
                    '--ignore-ssl-errors',
                    '--disable-web-security',
                    '--allow-running-insecure-content'
                ]
            )
            
            # Create context with HAR recording
            context = await browser.new_context(
                ignore_https_errors=True,
                record_har_path=f"{self.output_dir}/bechtle_{self.timestamp}.har",
                record_har_omit_content=False
            )
            
            # Create page and navigate
            page = await context.new_page()
            
            # Set viewport
            await page.set_viewport_size({"width": 1280, "height": 720})
            
            # Navigate to target URL
            await page.goto(self.target_url, wait_until="networkidle")
            
            # Wait for additional time to capture dynamic content
            await page.wait_for_timeout(wait_time * 1000)
            
            # Close context to finalize HAR
            await context.close()
            await browser.close()
            
            print(f"✅ HAR capture completed: bechtle_{self.timestamp}.har")
            
    def load_har_data(self, har_file_path):
        """Load HAR data from file"""
        try:
            with open(har_file_path, 'r', encoding='utf-8') as f:
                self.har_data = json.load(f)
            print(f"📖 Loaded HAR data: {len(self.har_data.get('log', {}).get('entries', []))} entries")
            return True
        except Exception as e:
            print(f"❌ Error loading HAR file: {e}")
            return False
    
    def analyze_har_data(self):
        """Analyze HAR data and extract useful information"""
        if not self.har_data:
            print("❌ No HAR data loaded")
            return None
            
        analysis = {
            'total_requests': 0,
            'domains': set(),
            'tracking_domains': set(),
            'api_endpoints': [],
            'tracking_scripts': [],
            'cookies': set(),
            'headers': {},
            'response_times': [],
            'status_codes': {},
            'content_types': {}
        }
        
        entries = self.har_data.get('log', {}).get('entries', [])
        analysis['total_requests'] = len(entries)
        
        tracking_keywords = [
            'google', 'facebook', 'linkedin', 'twitter', 'analytics', 
            'tracking', 'pixel', 'tag', 'gtm', 'gtag', 'fbq', 'twq',
            'doubleclick', 'ads', 'marketing', 'beacon', 'collect'
        ]
        
        for entry in entries:
            request = entry.get('request', {})
            response = entry.get('response', {})
            
            # Extract URL and domain
            url = request.get('url', '')
            domain = self.extract_domain(url)
            analysis['domains'].add(domain)
            
            # Check for tracking domains
            if any(keyword in domain.lower() for keyword in tracking_keywords):
                analysis['tracking_domains'].add(domain)
            
            # Extract API endpoints
            if '/api/' in url or url.endswith('.json') or 'application/json' in response.get('content', {}).get('mimeType', ''):
                analysis['api_endpoints'].append({
                    'url': url,
                    'method': request.get('method', ''),
                    'status': response.get('status', ''),
                    'content_type': response.get('content', {}).get('mimeType', '')
                })
            
            # Extract tracking scripts
            if any(keyword in url.lower() for keyword in ['gtm', 'gtag', 'analytics', 'pixel']):
                analysis['tracking_scripts'].append({
                    'url': url,
                    'method': request.get('method', ''),
                    'status': response.get('status', '')
                })
            
            # Extract cookies
            cookies = request.get('cookies', [])
            for cookie in cookies:
                analysis['cookies'].add(f"{cookie.get('name', '')}={cookie.get('value', '')}")
            
            # Analyze headers
            headers = request.get('headers', [])
            for header in headers:
                name = header.get('name', '').lower()
                value = header.get('value', '')
                if name not in analysis['headers']:
                    analysis['headers'][name] = set()
                analysis['headers'][name].add(value)
            
            # Response times and status codes
            time_ms = entry.get('time', 0)
            analysis['response_times'].append(time_ms)
            
            status = response.get('status', 0)
            analysis['status_codes'][status] = analysis['status_codes'].get(status, 0) + 1
            
            content_type = response.get('content', {}).get('mimeType', '')
            if content_type:
                analysis['content_types'][content_type] = analysis['content_types'].get(content_type, 0) + 1
        
        # Convert sets to lists for JSON serialization
        analysis['domains'] = list(analysis['domains'])
        analysis['tracking_domains'] = list(analysis['tracking_domains'])
        analysis['cookies'] = list(analysis['cookies'])
        for header in analysis['headers']:
            analysis['headers'][header] = list(analysis['headers'][header])
        
        return analysis
    
    def extract_domain(self, url):
        """Extract domain from URL"""
        try:
            from urllib.parse import urlparse
            return urlparse(url).netloc
        except:
            return url
    
    def _format_cookies(self, analysis):
        """Format cookies for Python script"""
        cookies = analysis.get('cookies', [])
        if not cookies:
            return "            # No cookies detected"
        
        cookie_lines = []
        for cookie in cookies[:10]:  # Limit to first 10 cookies
            if '=' in cookie:
                name, value = cookie.split('=', 1)
                cookie_lines.append("            '{}': '{}',".format(name, value))
        
        return '\n'.join(cookie_lines) if cookie_lines else "            # No cookies detected"
    
    def generate_python_script(self, analysis, script_name=None):
        """Generate Python script based on HAR analysis"""
        if not script_name:
            script_name = f"bechtle_script_{self.timestamp}.py"
        
        script_content = f'''#!/usr/bin/env python3
"""
Generated Python Script for {self.target_url}
Based on HAR analysis from {self.timestamp}
"""

import requests
import json
import time
from urllib.parse import urlparse

class BechtleAPIClient:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "{self.target_url}"
        
        # Set common headers based on HAR analysis
        self.session.headers.update({{
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        }})
        
        # Common cookies from HAR analysis
        self.cookies = {{
{self._format_cookies(analysis)}
        }}
        
        # Tracking domains detected
        self.tracking_domains = {analysis.get('tracking_domains', [])}
        
        # API endpoints discovered
        self.api_endpoints = {analysis.get('api_endpoints', [])}
    
    def _format_cookies(self, analysis):
        """Format cookies for Python script"""
        cookies = analysis.get('cookies', [])
        if not cookies:
            return "            # No cookies detected"
        
        cookie_lines = []
        for cookie in cookies[:10]:  # Limit to first 10 cookies
            if '=' in cookie:
                name, value = cookie.split('=', 1)
                cookie_lines.append("            '{}': '{}',".format(name, value))
        
        return '\\n'.join(cookie_lines) if cookie_lines else "            # No cookies detected"
    
    def get_main_page(self):
        """Get main page content"""
        try:
            response = self.session.get(self.base_url, cookies=self.cookies)
            response.raise_for_status()
            return response.text
        except Exception as e:
            print(f"Error getting main page: {{e}}")
            return None
    
    def call_api_endpoint(self, endpoint_url, method='GET', data=None):
        """Call discovered API endpoint"""
        try:
            if method.upper() == 'GET':
                response = self.session.get(endpoint_url, cookies=self.cookies)
            else:
                response = self.session.post(endpoint_url, json=data, cookies=self.cookies)
            
            response.raise_for_status()
            return response.json() if 'application/json' in response.headers.get('content-type', '') else response.text
        except Exception as e:
            print(f"Error calling API endpoint {{endpoint_url}}: {{e}}")
            return None
    
    def analyze_tracking(self):
        """Analyze tracking scripts and pixels"""
        print("🔍 Analyzing tracking scripts...")
        for script in {analysis.get('tracking_scripts', [])}:
            print(f"📊 Tracking: {{script['method']}} {{script['url']}} (Status: {{script['status']}})")
    
    def generate_report(self):
        """Generate analysis report"""
        report = {{
            'timestamp': '{self.timestamp}',
            'target_url': '{self.target_url}',
            'total_requests': {analysis.get('total_requests', 0)},
            'domains_found': {len(analysis.get('domains', []))},
            'tracking_domains': {len(analysis.get('tracking_domains', []))},
            'api_endpoints': {len(analysis.get('api_endpoints', []))},
            'cookies_detected': {len(analysis.get('cookies', []))},
            'avg_response_time': {sum(analysis.get('response_times', [0])) / max(len(analysis.get('response_times', [1])), 1):.2f} if analysis.get('response_times') else 0,
            'status_codes': {analysis.get('status_codes', {})},
            'content_types': {analysis.get('content_types', {})}
        }}
        
        return report

def main():
    """Main execution function"""
    print("🚀 Starting Bechtle API Client...")
    
    client = BechtleAPIClient()
    
    # Get main page
    print("📄 Getting main page...")
    main_content = client.get_main_page()
    if main_content:
        print(f"✅ Main page loaded ({{len(main_content)}} characters)")
    
    # Analyze tracking
    client.analyze_tracking()
    
    # Generate report
    report = client.generate_report()
    print("\\n📊 Analysis Report:")
    print(json.dumps(report, indent=2))
    
    # Save report
    with open('bechtle_analysis_report.json', 'w') as f:
        json.dump(report, f, indent=2)
    print("\\n💾 Report saved to: bechtle_analysis_report.json")

if __name__ == "__main__":
    main()
'''
        
        script_path = os.path.join(self.output_dir, script_name)
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(script_content)
        
        print(f"📝 Generated Python script: {script_path}")
        return script_path
    
    def generate_requests_script(self, analysis, script_name=None):
        """Generate a requests-based script for API testing"""
        if not script_name:
            script_name = f"bechtle_requests_{self.timestamp}.py"
        
        script_content = f'''#!/usr/bin/env python3
"""
Requests-based API testing script for {self.target_url}
Generated from HAR analysis
"""

import requests
import json
import time
from urllib.parse import urlparse

def test_api_endpoints():
    """Test discovered API endpoints"""
    session = requests.Session()
    
    # Set headers
    session.headers.update({{
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
    }})
    
    # API endpoints to test
    endpoints = {analysis.get('api_endpoints', [])}
    
    print(f"🧪 Testing {{len(endpoints)}} API endpoints...")
    
    results = []
    for i, endpoint in enumerate(endpoints, 1):
        print(f"\\n{{i}}/{{len(endpoints)}} Testing: {{endpoint['method']}} {{endpoint['url']}}")
        
        try:
            if endpoint['method'].upper() == 'GET':
                response = session.get(endpoint['url'], timeout=10)
            else:
                response = session.post(endpoint['url'], timeout=10)
            
            result = {{
                'url': endpoint['url'],
                'method': endpoint['method'],
                'status_code': response.status_code,
                'response_time': response.elapsed.total_seconds(),
                'content_type': response.headers.get('content-type', ''),
                'content_length': len(response.content),
                'success': response.status_code < 400
            }}
            
            if response.status_code < 400:
                print(f"✅ Success ({{response.status_code}}) - {{response.elapsed.total_seconds():.2f}}s")
            else:
                print(f"❌ Failed ({{response.status_code}}) - {{response.elapsed.total_seconds():.2f}}s")
            
            results.append(result)
            
        except Exception as e:
            print(f"❌ Error: {{e}}")
            results.append({{
                'url': endpoint['url'],
                'method': endpoint['method'],
                'error': str(e),
                'success': False
            }})
        
        time.sleep(0.5)  # Rate limiting
    
    # Save results
    results_file = f"api_test_results_{{self.timestamp}}.json"
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\\n💾 Results saved to: {{results_file}}")
    
    # Summary
    successful = sum(1 for r in results if r.get('success', False))
    print(f"\\n📊 Summary: {{successful}}/{{len(results)}} endpoints successful")
    
    return results

if __name__ == "__main__":
    test_api_endpoints()
'''
        
        script_path = os.path.join(self.output_dir, script_name)
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(script_content)
        
        print(f"📝 Generated requests script: {script_path}")
        return script_path

async def main():
    """Main function"""
    parser = argparse.ArgumentParser(description="Playwright HAR Generator for www.bechtle.com")
    parser.add_argument("--url", default="https://www.bechtle.com", help="Target URL")
    parser.add_argument("--output-dir", default="har_outputs", help="Output directory")
    parser.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    parser.add_argument("--wait-time", type=int, default=10, help="Wait time in seconds after page load")
    parser.add_argument("--no-har", action="store_true", help="Skip HAR capture (use existing file)")
    parser.add_argument("--har-file", help="Use existing HAR file instead of capturing")
    
    args = parser.parse_args()
    
    generator = PlaywrightHARGenerator(args.url, args.output_dir)
    
    # Capture HAR if not skipped
    if not args.no_har and not args.har_file:
        await generator.capture_har(headless=args.headless, wait_time=args.wait_time)
        har_file = f"{args.output_dir}/bechtle_{generator.timestamp}.har"
    elif args.har_file:
        har_file = args.har_file
    else:
        har_file = f"{args.output_dir}/bechtle_{generator.timestamp}.har"
    
    # Load and analyze HAR data
    if generator.load_har_data(har_file):
        analysis = generator.analyze_har_data()
        
        if analysis:
            print(f"\n📊 HAR Analysis Results:")
            print(f"Total Requests: {analysis['total_requests']}")
            print(f"Domains Found: {len(analysis['domains'])}")
            print(f"Tracking Domains: {len(analysis['tracking_domains'])}")
            print(f"API Endpoints: {len(analysis['api_endpoints'])}")
            print(f"Cookies Detected: {len(analysis['cookies'])}")
            
            # Save analysis
            analysis_file = f"{args.output_dir}/analysis_{generator.timestamp}.json"
            with open(analysis_file, 'w') as f:
                json.dump(analysis, f, indent=2)
            print(f"💾 Analysis saved to: {analysis_file}")
            
            # Generate Python scripts
            generator.generate_python_script(analysis)
            generator.generate_requests_script(analysis)
            
            print(f"\n🎉 All files generated in: {args.output_dir}")
        else:
            print("❌ Failed to analyze HAR data")
    else:
        print("❌ Failed to load HAR data")

if __name__ == "__main__":
    asyncio.run(main()) 