#!/usr/bin/env python3
"""
Simple Python Script for https://www.bechtle.com
Based on HAR analysis from 20250804_224238
"""

import requests
import json
import time

class BechtleClient:
    def __init__(self):
        self.session = requests.Session()
        self.base_url = "https://www.bechtle.com"
        
        # Set headers
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
        })
    
    def get_main_page(self):
        """Get main page content"""
        try:
            response = self.session.get(self.base_url)
            response.raise_for_status()
            return response.text
        except Exception as e:
            print(f"Error getting main page: {e}")
            return None
    
    def test_api_endpoints(self):
        """Test discovered API endpoints"""
        endpoints = [{'url': 'https://www.bechtle.com/api/bechtle-public/bootstrap?country=de&language=de', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/api/bens/maintenance', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/api/bens/locale-recommendation', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/shop/cart/miniCart/UPDATE', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://api.usercentrics.eu/settings/FdEA6sZb6/latest/languages.json', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/shop/cmshtml/htmldata', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/shop/my-account/avatar/getAvatarURL', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/gateway/api/session/messages', 'method': 'GET', 'status': 200, 'content_type': 'text/plain; charset=UTF-8'}, {'url': 'https://api.usercentrics.eu/settings/FdEA6sZb6/latest/de.json', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://api.usercentrics.eu/translations/translations-de.json', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/api/bechtle-public/translations?language=de&nameSpace=productRecommendations&nameSpace=common', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/api/bechtle-public/translations?language=de&nameSpace=common&nameSpace=fastActionMenu', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/bechtlecommercewebservices/v2/bechtle-de/communication/data?fields=DEFAULT&lang=de', 'method': 'GET', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/api/bechtle-public/components/recommendations?language=de&country=de', 'method': 'POST', 'status': 200, 'content_type': 'application/json'}, {'url': 'https://www.bechtle.com/api/bechtle-public/components/recommendations?language=de&country=de', 'method': 'POST', 'status': 204, 'content_type': 'x-unknown'}]
        
        print(f"Testing {len(endpoints)} API endpoints...")
        
        results = []
        for i, endpoint in enumerate(endpoints, 1):
            print(f"{i}/{len(endpoints)} Testing: {endpoint['method']} {endpoint['url']}")
            
            try:
                if endpoint['method'].upper() == 'GET':
                    response = self.session.get(endpoint['url'], timeout=10)
                else:
                    response = self.session.post(endpoint['url'], timeout=10)
                
                result = {
                    'url': endpoint['url'],
                    'method': endpoint['method'],
                    'status_code': response.status_code,
                    'response_time': response.elapsed.total_seconds(),
                    'success': response.status_code < 400
                }
                
                if response.status_code < 400:
                    print(f"✅ Success ({response.status_code}) - {response.elapsed.total_seconds():.2f}s")
                else:
                    print(f"❌ Failed ({response.status_code}) - {response.elapsed.total_seconds():.2f}s")
                
                results.append(result)
                
            except Exception as e:
                print(f"❌ Error: {e}")
                results.append({
                    'url': endpoint['url'],
                    'method': endpoint['method'],
                    'error': str(e),
                    'success': False
                })
            
            time.sleep(0.5)  # Rate limiting
        
        return results
    
    def analyze_tracking(self):
        """Analyze tracking scripts"""
        tracking_scripts = [{'url': 'https://www.googletagmanager.com/gtm.js?id=GTM-MKN6XL6&gtm_auth=b-bxiTj956pwFavt4luE9g&gtm_preview=env-1&gtm_cookies_win=x', 'method': 'GET', 'status': 200}, {'url': 'https://www.googletagmanager.com/gtag/js?id=DC-11109278&cx=c&gtm=45He57v0v865816244za200&tag_exp=101509157~103116026~103200004~103233427~104684208~104684211~105087538~105087540~105103161~105103163', 'method': 'GET', 'status': 200}, {'url': 'https://www.googletagmanager.com/gtag/js?id=G-BZPFMFYT5K&cx=c&gtm=45He57v0v865816244za200&tag_exp=101509157~103116026~103200004~103233427~104684208~104684211~105087538~105087540~105103161~105103163', 'method': 'GET', 'status': 200}, {'url': 'https://pagead2.googlesyndication.com/ccm/collect?tid=DC-11109278&en=page_view&dl=https%3A%2F%2Fwww.bechtle.com%2F&scrsrc=www.googletagmanager.com&frm=0&rnd=712441024.1754340161&navt=n&npa=1&gdid=dOThhZD&_tu=CA&gtm=45fe57v0v9181774044z8865816244za200zb865816244zd865816244&gcs=G100&gcd=13p3pPp2p5l1&dma_cps=-&dma=1&tag_exp=101509157~103116026~103200004~103233427~104527906~104528501~104573694~104684208~104684211~104948813~105033763~105033765~105087538~105087540~105103161~105103163&tft=1754340160579&tfd=1125&apve=1&apvf=sb', 'method': 'POST', 'status': 200}, {'url': 'https://tagging.bechtle.com/g/collect?v=2&tid=G-BZPFMFYT5K&gtm=45je57v0v880460134z8865816244za200zb865816244zd865816244&_p=1754340159926&gcs=G100&gcd=13p3pPp2p5l1&npa=1&dma_cps=-&dma=1&tag_exp=101509157~103116026~103200004~103233427~104527906~104528500~104684208~104684211~104948813~105087538~105087540~105103161~105103163~105113532&cid=2030974510.1754340161&ecid=1447063937&ul=en-us&sr=1280x720&_fplc=0&ur=DE-HH&uaa=arm&uab=64&uafvl=Not%253BA%253DBrand%3B99.0.0.0%7CHeadlessChrome%3B139.0.7258.5%7CChromium%3B139.0.7258.5&uamb=0&uam=&uap=macOS&uapv=15.5.0&uaw=0&are=1&frm=0&pscdl=denied&sst.rnd=712441024.1754340161&sst.etld=google.de&sst.gcsub=region1&sst.adr=1&sst.tft=1754340159926&sst.lpc=106808336&sst.navt=n&sst.ude=0&_s=1&sid=1754340160&sct=1&seg=0&dl=https%3A%2F%2Fwww.bechtle.com%2F&dt=Bechtle%20AG%20%7C%20Der%20IT-Zukunftspartner&_tu=DA&en=page_view&_fv=2&_nsi=1&_ss=1&_c=1&ep.shop_country=DE&ep.shop_language=de&ep.pagetype=home&ep.intern=extern&ep.context=anonymous&ep.vid=871986ef155344e598a51179b4a38fc3&ep.dy_pagetype=HOMEPAGE&ep.locale=de_DE&ep.referrer=&ep.dy_session=optout-session-id&ep.dy_user=optout-user-id&ep.sst_event_category=page_view&ep.dy_user_agent=optout-useragent&ep.portfolio_type=no_portfolio&ep.show_dynamic_content=true&ep.event_id=4df38512-cd72-4605-9b2c-6b1c11143128&ep.linkedin_consent_name=LinkedIn%20Insight%20Tag&ep.linkedin_consent_status=false&ep.consent_status_facebook=false&ep.consent_name_facebook=Facebook%20Pixel&ep.host_name=www.bechtle.com&ep.gads_consent_status=false&ep.gads_consent_name=Google%20Ads%20Remarketing&epn.linkedin_timestamp=1754340160538&ep.dy_categories=&up.user_procurement=public&tfd=1186&richsstsse', 'method': 'GET', 'status': 200}]
        print(f"Found {len(tracking_scripts)} tracking scripts:")
        
        for script in tracking_scripts:
            print(f"  {script['method']} {script['url']} (Status: {script['status']})")
    
    def generate_report(self):
        """Generate analysis report"""
        report = {
            'timestamp': '20250804_224238',
            'target_url': 'https://www.bechtle.com',
            'total_requests': 113,
            'domains_found': 9,
            'tracking_domains': 3,
            'api_endpoints': 15,
            'cookies_detected': 3,
            'avg_response_time': 57.59 if analysis.get('response_times') else 0
        }
        
        return report

def main():
    """Main execution function"""
    print("🚀 Starting Bechtle Client...")
    
    client = BechtleClient()
    
    # Get main page
    print("📄 Getting main page...")
    main_content = client.get_main_page()
    if main_content:
        print(f"✅ Main page loaded ({len(main_content)} characters)")
    
    # Analyze tracking
    client.analyze_tracking()
    
    # Test API endpoints
    results = client.test_api_endpoints()
    
    # Generate report
    report = client.generate_report()
    print("\n📊 Analysis Report:")
    print(json.dumps(report, indent=2))
    
    # Save results
    with open('bechtle_results.json', 'w') as f:
        json.dump({
            'report': report,
            'api_results': results
        }, f, indent=2)
    print("\n💾 Results saved to: bechtle_results.json")

if __name__ == "__main__":
    main()
