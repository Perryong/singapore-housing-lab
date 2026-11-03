# The future BTO map in a real browser against a small fixture: parcels, card, filters, phone layout, failure.
import functools, http.server, json, socketserver, sys, threading
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit(print('skipped: playwright not installed (pip install playwright && playwright install chromium)'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory='.'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/web/future.html'

sq = lambda lat, lon, h=.004: [[lat - h, lon - h], [lat - h, lon + h], [lat + h, lon + h], [lat + h, lon - h]]  # noqa: E731
parcel = lambda i, lat, lon, band, horizon, announced: {  # noqa: E731
    'id': i, 'name': f'Parcel {i}', 'ring': sq(lat, lon), 'score': 50, 'band': band, 'horizon': horizon,
    'reasons': [['HDB block within 500 m', 15]], 'areaHa': 12.0, 'lu': 'RESIDENTIAL', 'gpr': '3.0',
    'announced': announced, 'source': 'https://www.ura.gov.sg/' if announced else None}
DOC = {'asOf': '2026-11-04', 'reviewed': {'growthAreas': '2026-11-04'},
       'backtest': {'n': 80, 'topDecile': .5, 'mrtOnly': .3, 'random': .06, 'inCandidates': .6, 'dropped': ['rezoned']},
       'parcels': [parcel(1, 1.42, 103.76, 'likely', 'near', True), parcel(2, 1.36, 103.90, 'possible', 'far', True),
                   parcel(3, 1.35, 103.74, 'longshot', 'far', False)]}


def open_page(b, doc=DOC, size=(1280, 800), status=200):
    page = b.new_context(viewport={'width': size[0], 'height': size[1]}).new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.route('**/web/future.json', lambda r: r.fulfill(status=status, content_type='application/json', body=json.dumps(doc)))
    page.route('https://www.onemap.gov.sg/**', lambda r: r.abort())
    page.route('https://static.cloudflareinsights.com/**', lambda r: r.abort())
    page.goto(url)
    return page


layers = lambda page: page.evaluate('__future.layers')  # noqa: E731

with sync_playwright() as p:
    b = p.chromium.launch()

    page = open_page(b)
    page.wait_for_function('window.__future && __future.ready', timeout=20000)
    assert layers(page) == 3 and not page.errors, (layers(page), page.errors)
    assert 'Backtest on the 2019 plan: 50% of 80' in page.inner_text('#note')
    page.locator('path.parcel').first.click(force=True)
    assert page.is_visible('#card') and 'An estimate from URA zoning, not an HDB announcement.' in page.inner_text('#card')
    page.click('#rail button:has-text("≤ 5 years")')
    assert layers(page) == 1
    page.click('#rail button:has-text("Announced only")')
    assert layers(page) == 2 and not page.is_visible('#empty')
    assert page.get_attribute('#rail button:has-text("Announced only")', 'aria-pressed') == 'true'

    page = open_page(b, {**DOC, 'parcels': [{**q, 'announced': False} for q in DOC['parcels']]})
    page.wait_for_function('window.__future && __future.ready', timeout=20000)
    page.click('#rail button:has-text("Announced only")')
    assert layers(page) == 0 and page.inner_text('#empty') == 'No parcels match this filter.'

    page = open_page(b, size=(390, 844))
    page.wait_for_function('window.__future && __future.ready', timeout=20000)
    assert page.is_visible('#note') and not page.is_visible('#status')
    page.locator('path.parcel').first.click(force=True)
    assert page.is_visible('#card') and not page.is_visible('#note')
    page.click('#card .x')
    assert not page.is_visible('#card') and page.is_visible('#note')

    page = open_page(b, status=500)
    page.wait_for_selector('#fail', state='visible', timeout=20000)
    assert "Couldn't load the future BTO data." in page.inner_text('#fail')
    b.close()
print('ok: future map page')
