# Wind and rain in a project's 3D view against mocked NEA responses: the sun stays untouched until asked, and leaving live weather returns you where you were.
import datetime as dt, functools, http.server, json, socketserver, sys, threading, time
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit(print('skipped: playwright not installed (pip install playwright && playwright install chromium)'))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory='.'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/web/'

SGT = dt.timezone(dt.timedelta(hours=8))
STATIONS = [{'id': 'A', 'name': 'Toa Payoh North', 'location': {'latitude': 1.35, 'longitude': 103.85}}]

def payloads(age_min, rain):
    ts = (dt.datetime.now(SGT) - dt.timedelta(minutes=age_min)).isoformat()
    feed = lambda v: {'stations': STATIONS, 'readings': [{'timestamp': ts, 'data': [{'stationId': 'A', 'value': v}]}]}
    return {'wind-speed': feed(10), 'wind-direction': feed(20), 'rainfall': feed(rain),
            'two-hr-forecast': {'area_metadata': [{'name': 'Bishan', 'label_location': {'latitude': 1.35, 'longitude': 103.84}}], 'items': [{'forecasts': [{'area': 'Bishan', 'forecast': 'Thundery Showers'}]}]}}

def open_page(b, slug='bishan-terraces', age_min=0, rain=1.5, broken=False, reduced=False, ready=True):
    page = b.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce' if reduced else 'no-preference').new_page()
    page.calls, page.errors = [], []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    data = payloads(age_min, rain)
    def nea(route):
        path = route.request.url.split('/real-time/api/')[1].split('?')[0]
        page.calls.append((time.monotonic(), path))
        if broken: return route.fulfill(status=500, body='{}')
        route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'code': 0, 'data': data[path]}))
    page.route('https://api-open.data.gov.sg/**', nea)
    page.route('https://www.onemap.gov.sg/**', lambda r: r.abort())
    page.route('https://static.cloudflareinsights.com/**', lambda r: r.abort())
    page.goto(f'{base}?p={slug}')
    page.wait_for_function('window.__wxView', timeout=60000)
    if ready: page.wait_for_selector('#loading', state='detached', timeout=60000)
    page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
    return page

pressed = lambda page, sel: page.get_attribute(sel, 'aria-pressed') == 'true'
fx = lambda page: page.evaluate('__wxView.fx()')
state = lambda page: page.evaluate('__wxView.state()')
wait_live = lambda page: page.wait_for_function("__wxView.state().lv && Object.keys(__wxView.state().feeds).length === 4", timeout=30000)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = open_page(b)

    # opening a project changes nothing: sun on, weather off, not a single weather call or effect
    assert pressed(page, '[data-wx=sim]') and not pressed(page, '[data-wx=live]')
    assert not pressed(page, '[data-wl=wind]') and not pressed(page, '[data-wl=rain]')
    assert page.is_hidden('#wxScenario') and page.is_hidden('#wxLive')
    assert page.evaluate('__wxView.mode()') == 'now' and fx(page) is None
    page.wait_for_timeout(500)
    assert page.calls == [], page.calls

    # Rain on: scenario opens, colours follow, and the table ranks by it
    page.click('[data-wl=rain]')
    assert page.is_visible('#wxScenario') and page.evaluate('__wxView.mode()') == 'rain'
    assert pressed(page, '#modes .mode[data-m=rain]') and not pressed(page, '#modes .mode[data-m=now]')
    assert fx(page)['rain'] and not fx(page)['wind']
    assert 'driest first' in page.inner_text('#tableTitle') and page.is_visible('#thWx') and page.is_hidden('#sort')
    assert page.evaluate("(() => { const w = document.querySelector('#tableWrap'); return w.scrollWidth <= w.clientWidth; })()"), 'table clipped'
    assert page.locator('#tableWrap th', has_text='Price').is_visible() and not page.locator('#tableWrap th', has_text='AM').is_visible()
    assert 'Rain reaches facade' in page.inner_text('#legend') and 'not a wind-tunnel test' in page.inner_text('#legend')
    assert 'not a forecast' in page.inner_text('#wxScenario')
    assert page.calls == [], 'a scenario must not call NEA'

    # the model answers differently per scenario, on real stacks
    assert page.evaluate('__wxView.unit(306, 20).rainSt') == 'lit' and page.evaluate('__wxView.unit(302, 20).rainSt') != 'lit'
    page.click('[data-sc=squall]')
    assert page.evaluate('__wxView.unit(306, 20).rainSt') != 'lit' and page.evaluate('__wxView.unit(302, 20).rainSt') == 'lit'
    assert pressed(page, '[data-sc=squall]') and page.inner_text('#wxFromV') == 'W' and page.inner_text('#wxUV') == '15 m/s'

    # sliders mean a custom scenario; no rain stops the rain but keeps the panel
    page.fill('#wxMm', '0')
    assert not pressed(page, '[data-sc=squall]') and state(page)['mmh'] == 0
    assert not fx(page)['rain'] and page.evaluate('__wxView.unit(306, 20).rainSt') == 'dry'
    page.click('[data-sc=surge]')

    # the unit card explains it, in words that don't overclaim
    page.evaluate("document.querySelector('#tbody tr[data-s=\"306\"]').click()")
    card = page.inner_text('#unitCard')
    assert 'Rain reaches this facade' in card and "Doesn't mean it enters the window" in card, card
    assert 'Morning sun' in card                                         # the sun figures stay
    page.click('#unitCard button[data-a=clear]')

    # Wind too, then both off: back to sun colours and the normal table
    page.click('[data-wl=wind]')
    assert fx(page)['wind'] and fx(page)['rain'] and page.evaluate('__wxView.mode()') == 'wind'
    assert 'windiest first' in page.inner_text('#tableTitle')
    page.click('[data-wl=wind]')
    assert page.evaluate('__wxView.mode()') == 'rain'
    page.click('[data-wl=rain]')
    assert page.evaluate('__wxView.mode()') == 'now' and page.is_hidden('#wxScenario') and page.is_hidden('#thWx') and page.is_visible('#sort')
    assert page.locator('#tableWrap th', has_text='AM').is_visible()
    assert not fx(page)['rain'] and not fx(page)['wind']

    # choosing the colour mode directly brings the scenario with it
    page.click('#modes .mode[data-m=rain]')
    assert pressed(page, '[data-wl=rain]') and page.is_visible('#wxScenario')
    page.click('#modes .mode[data-m=pm]')
    page.click('[data-wl=rain]')

    # Live weather: remembers where you were, follows the clock, shows real values
    page.click('#time')                                                  # leave "Now"
    page.evaluate("const t = document.querySelector('#time'); t.value = 600; t.dispatchEvent(new Event('input'))")
    page.evaluate("const d = document.querySelector('#date'); d.value = '2026-06-21'; d.dispatchEvent(new Event('change'))")
    before = page.evaluate('__wxView.cur()')
    assert before['min'] == 600 and before['m'] == 6 and not page.evaluate('__wxView.isLive()')
    page.click('[data-wx=live]')
    assert pressed(page, '[data-wx=live]') and page.evaluate('__wxView.isLive()')
    assert page.is_visible('#wxLive') and page.is_hidden('#wxScenario') and page.is_disabled('[data-wl=rain]')
    wait_live(page)
    text = page.inner_text('#wxLive')
    assert '5.1 m/s from the NNE' in text and '18 mm/h' in text and 'Bishan: Thundery Showers' in text and 'nearest gauge Toa Payoh North' in text, text
    assert page.get_attribute('#wxLive a', 'href') == 'weather.html'
    assert fx(page)['wind'] and fx(page)['rain']
    times = [t for t, _ in page.calls]
    assert all(sum(a <= t < a + 10 for t in times) <= 6 for a in times), 'over 6 calls in 10 s'

    # Sun simulation is the off button: stops calling, restores date, time and layers
    page.click('[data-wx=sim]')
    after = page.evaluate('__wxView.cur()')
    assert (after['min'], after['m'], after['d'], after['y']) == (before['min'], before['m'], before['d'], before['y']), after
    assert not page.evaluate('__wxView.isLive()') and page.input_value('#date') == '2026-06-21'
    assert page.is_hidden('#wxLive') and not pressed(page, '[data-wl=rain]') and not fx(page)['rain'] and not fx(page)['wind']
    n = len(page.calls); page.evaluate('__wxView.tick()'); page.wait_for_timeout(2200)
    assert len(page.calls) == n, 'still calling NEA after switching off'

    # moving the clock while live leaves live weather but keeps the time just chosen
    page.click('[data-wx=live]'); wait_live(page)
    page.evaluate("const t = document.querySelector('#time'); t.value = 900; t.dispatchEvent(new Event('input'))")
    assert not pressed(page, '[data-wx=live]') and page.evaluate('__wxView.cur().min') == 900
    assert not fx(page)['rain'] and page.is_hidden('#wxLive')

    # a scenario stays intact through all of that
    page.click('[data-wl=rain]')
    assert state(page)['from'] == 20 and state(page)['U'] == 10 and state(page)['mmh'] == 25
    page.click('[data-wl=rain]')
    assert not page.errors, page.errors
    page.close()

    # old readings: labelled, and effects removed
    old = open_page(b, age_min=30, ready=False)
    old.click('[data-wx=live]'); wait_live(old)
    assert 'Readings 30 min old' in old.inner_text('#wxLive'), old.inner_text('#wxLive')
    assert fx(old) is None, fx(old)                                      # never even built
    assert not old.errors, old.errors
    old.close()

    # NEA down: says so, the sun view still works, and it never flips back on its own
    down = open_page(b, broken=True, ready=False)
    down.click('[data-wx=live]')
    down.wait_for_function("document.querySelector('#wxLive').textContent.includes('unavailable')", timeout=30000)
    assert pressed(down, '[data-wx=live]')
    down.click('[data-wx=sim]')
    assert pressed(down, '[data-wx=sim]')
    assert not down.errors, down.errors
    down.close()

    # a site with no layout: effects and readout, no unit colours
    site = open_page(b, slug='tengah-oct-2026', ready=False)
    site.click('[data-wl=rain]')
    assert fx(site)['rain'] and site.evaluate('__wxView.mode()') == 'now'
    assert site.is_hidden('#modes .mode[data-m=rain]')
    assert not site.errors, site.errors
    site.close()

    # reduced motion: no particles, a static arrow, the colours still work
    still = open_page(b, reduced=True, ready=False)
    still.click('[data-wl=wind]'); still.click('[data-wl=rain]')
    f = fx(still)
    assert not f['rain'] and not f['wind'] and f['arrow'], f
    assert not still.errors, still.errors

    b.close()
print('ok')
