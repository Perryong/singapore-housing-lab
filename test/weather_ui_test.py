# The weather page in a real browser against mocked NEA responses: pacing, layers, pins, and each failure the page must survive.
import base64, datetime as dt, functools, http.server, json, socketserver, sys, threading, time
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit(print('skipped: playwright not installed (pip install playwright && playwright install chromium)'))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory='.'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/web/weather.html'

SGT = dt.timezone(dt.timedelta(hours=8))
STATIONS = [{'id': 'A', 'name': 'Gauge A', 'location': {'latitude': 1.35, 'longitude': 103.8}}, {'id': 'B', 'name': 'Gauge B', 'location': {'latitude': 1.4, 'longitude': 103.9}}]
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==')

def payloads(age_min, at=None):
    ts = at or (dt.datetime.now(SGT) - dt.timedelta(minutes=age_min)).isoformat()
    feed = lambda a, b: {'stations': STATIONS, 'readings': [{'timestamp': ts, 'data': [{'stationId': 'A', 'value': a}, {'stationId': 'B', 'value': b}]}]}
    return {
        'wind-speed': feed(10, 12), 'wind-direction': feed(90, 100), 'rainfall': feed(1.5, 0), 'air-temperature': feed(27, 28), 'relative-humidity': feed(74, 80),
        'two-hr-forecast': {'area_metadata': [{'name': 'Bishan', 'label_location': {'latitude': 1.35, 'longitude': 103.84}}], 'items': [{'forecasts': [{'area': 'Bishan', 'forecast': 'Cloudy'}]}]},
        'weather-radar-images/70km': {'boundaryBox': {'upperLeft': {'longitude': 103.3, 'latitude': 2}, 'lowerRight': {'longitude': 104.6, 'latitude': 0.7}}, 'records': [{'timestamp': ts, 'image': {'url': 'https://radar.test/frame.png'}}]},
    }

def open_page(b, age_min=0, broken=(), reduced=False, expired=None):
    page = b.new_context(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce' if reduced else 'no-preference').new_page()
    page.calls, page.errors = [], []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    data = payloads(age_min)
    def nea(route):
        path, _, query = route.request.url.split('/real-time/api/')[1].partition('?')
        page.calls.append((time.monotonic(), path, query))
        if path in broken: return route.fulfill(status=500, body='{}')
        # a past moment answers with that moment's time
        when = query.removeprefix('date=')
        body = payloads(0, at=when + '+08:00')[path] if when else data[path]
        if when and 'radar' in path: body = {**body, 'records': [{**body['records'][0], 'image': {'url': 'https://radar.test/' + when + '.png'}}]}
        route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps({'code': 0, 'data': body}))
    page.route('https://api-open.data.gov.sg/**', nea)
    page.images = []
    def image(route):
        page.images.append(route.request.url)
        # one link has expired by the time it's fetched: the page must ask NEA for a fresh one
        if expired and route.request.url.endswith(expired) and page.images.count(route.request.url) == 1: return route.fulfill(status=403, headers={'access-control-allow-origin': '*'}, body='expired')
        route.fulfill(status=200, content_type='image/png', headers={'access-control-allow-origin': '*'}, body=PNG)
    page.route('https://radar.test/**', image)
    page.route('https://www.onemap.gov.sg/**', lambda r: r.abort())
    page.route('https://static.cloudflareinsights.com/**', lambda r: r.abort())
    page.goto(url)
    return page

def wait_loaded(page):
    page.wait_for_function('window.__wx && __wx.settled()', timeout=30000)

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    now = dt.datetime.now(SGT); last_slot = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0).strftime('%Y-%m-%dT%H:%M:%S')
    ok, old, no_radar, down, still, stale_link = open_page(b), open_page(b, age_min=30), open_page(b, broken=['weather-radar-images/70km']), open_page(b, broken=list(payloads(0))), open_page(b, reduced=True), open_page(b, expired=last_slot + '.png')
    for page in (ok, old, no_radar, down, still, stale_link): wait_loaded(page)

    # pacing: radar first, all 7 feeds, never over NEA's limit
    assert ok.calls[0][1] == 'weather-radar-images/70km', ok.calls[0]
    live_calls = [c for c in ok.calls if not c[2]]
    assert len(live_calls) == 7, live_calls

    # opening state: wind and radar on, live status, credit and honest wording
    assert ok.get_attribute('[data-l=wind]', 'aria-pressed') == 'true' and ok.get_attribute('[data-l=rain]', 'aria-pressed') == 'true'
    assert ok.inner_text('#status').startswith('Live'), ok.inner_text('#status')
    assert 'NEA via data.gov.sg' in ok.inner_text('.leaflet-control-attribution')
    assert 'Measured at NEA stations and estimated between them.' in ok.inner_text('#note')
    assert ok.evaluate('__wx.radarOn()') and ok.evaluate('__wx.fieldKind()') == 'wind'
    assert ok.evaluate('__wx.dots()') == 2                                  # a dot wherever a real measurement exists
    frames = ok.evaluate('__wx.frames()'); ok.wait_for_timeout(600)
    assert ok.evaluate('__wx.frames()') > frames, 'wind trails not moving'

    # layers: temperature replaces the colour field, trails stay, and toggling back restores it
    ok.click('[data-l=temp]')
    assert ok.evaluate('__wx.fieldKind()') == 'temp' and '°C' in ok.inner_text('#legend')
    ok.click('[data-l=hum]')
    assert ok.evaluate('__wx.fieldKind()') == 'hum' and ok.get_attribute('[data-l=temp]', 'aria-pressed') == 'false'
    ok.click('[data-l=hum]')
    assert ok.evaluate('__wx.fieldKind()') == 'wind'
    ok.click('[data-l=wind]')
    assert ok.evaluate('__wx.fieldKind()') is None
    frames = ok.evaluate('__wx.frames()'); ok.wait_for_timeout(300)
    assert ok.evaluate('__wx.frames()') == frames, 'trails should stop with wind off'
    ok.click('[data-l=wind]'); ok.click('[data-l=rain]')
    assert not ok.evaluate('__wx.radarOn()')
    ok.click('[data-l=rain]')

    # pins: every project, with readings and a link to its 3D view, by mouse and by keyboard
    assert ok.locator('.pin').count() == len(json.load(open('projects/index.json')))
    pin = ok.locator('.pin[title="Kim Keat Crest"]')
    pin.dispatch_event('click')
    card = ok.inner_text('#card')
    assert 'Kim Keat Crest' in card and '18 mm/h' in card and '27.0 °C' in card and 'Bishan: Cloudy' in card, card
    assert ok.get_attribute('#card a', 'href') == './?p=kim-keat-crest'
    ok.keyboard.press('Escape')
    assert ok.is_hidden('#card')
    pin.focus(); ok.keyboard.press('Enter')
    assert ok.is_visible('#card')
    ok.click('#card button')
    assert ok.is_hidden('#card')

    # timeline: 12 past radar frames arrive in the background, one call each, still within the limit
    ok.wait_for_function('__wx.framesReady() === 12', timeout=60000)
    past = [c for c in ok.calls if c[2]]
    assert len(past) == 12 and all('radar' in c[1] for c in past), past
    stamps = sorted(c[2] for c in past)
    assert all(s.endswith((':00:00', ':15:00', ':30:00', ':45:00')) for s in stamps), stamps
    times = [c[0] for c in ok.calls]
    assert all(sum(a <= t < a + 10 for t in times) <= 6 for a in times), 'over 6 calls in 10 s'
    assert ok.input_value('#scrub') == '12' and ok.is_hidden('#toNow')
    credit, bar, note = (ok.locator(s).bounding_box() for s in ('.leaflet-control-attribution', '#time', '#note'))
    assert credit['y'] + credit['height'] <= bar['y'], 'credit hidden behind the timeline'

    # moving back: Replay is unmistakable, radar shows at once, readings load only for the moment you stop on
    before = len(ok.calls)
    ok.fill('#scrub', '4')
    assert ok.inner_text('#status').startswith('Replay ·'), ok.inner_text('#status')
    assert 'live' not in (ok.get_attribute('#status', 'class') or '')
    assert ok.evaluate('__wx.radarOn()') and ok.evaluate('__wx.radarUrl()').startswith('blob:')   # kept, so an expired link can't blank it
    assert ok.is_visible('#toNow')
    ok.wait_for_function('__wx.momentLoaded()', timeout=30000)
    fresh = [c for c in ok.calls[before:] if c[2]]
    assert sorted(c[1] for c in fresh) == sorted(['wind-speed', 'wind-direction', 'rainfall', 'air-temperature', 'relative-humidity']), fresh
    assert len({c[2] for c in fresh}) == 1
    assert ok.evaluate('__wx.fieldKind()') == 'wind' and ok.evaluate('__wx.dots()') == 2
    pin.dispatch_event('click')
    assert 'Bishan: Cloudy' not in ok.inner_text('#card'), 'a live forecast must not show on a past moment'
    ok.keyboard.press('Escape')

    # a moment already loaded makes no new calls
    n = len(ok.calls); ok.fill('#scrub', '5'); ok.wait_for_function('__wx.momentLoaded()', timeout=30000); ok.fill('#scrub', '4'); ok.wait_for_timeout(700)
    assert len([c for c in ok.calls[n:] if c[2].endswith(fresh[0][2][-8:])]) == 0, 'reloaded a known moment'

    # Play runs to the end and lands on Live, without loading station data on the way
    n = len(ok.calls); ok.fill('#scrub', '10'); ok.click('#play')
    assert ok.get_attribute('#play', 'aria-label') == 'Pause'
    ok.wait_for_function("document.querySelector('#status').textContent.startsWith('Live ·')", timeout=15000)
    assert ok.input_value('#scrub') == '12' and ok.get_attribute('#play', 'aria-label') == 'Play'
    assert ok.is_hidden('#toNow')

    # back to now: live values return immediately
    ok.fill('#scrub', '0'); ok.click('#toNow')
    assert ok.inner_text('#status').startswith('Live ·') and ok.input_value('#scrub') == '12'

    # hidden tab: no calls, and it catches up on return
    n = len(ok.calls)
    ok.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); __wx.expire(); __wx.tick()")
    ok.wait_for_timeout(2500)
    assert len(ok.calls) == n, 'called NEA while hidden'
    frames = ok.evaluate('__wx.frames()'); ok.wait_for_timeout(300)
    assert ok.evaluate('__wx.frames()') == frames, 'trails should pause while hidden'
    ok.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'))")
    ok.wait_for_timeout(2500)
    assert len(ok.calls) > n, 'did not refresh on return'

    # old readings say so
    assert old.inner_text('#status') == 'Readings 30 min old', old.inner_text('#status')

    # an expired radar link gets a fresh one from NEA, and the frame still arrives
    stale_link.wait_for_function('__wx.framesReady() === 12', timeout=60000)
    assert stale_link.images.count('https://radar.test/' + last_slot + '.png') == 2, stale_link.images

    # radar down: wet gauges stand in, and the other layers keep working
    assert not no_radar.evaluate('__wx.radarOn()') and no_radar.evaluate('__wx.gauges()') == 1
    assert no_radar.inner_text('[data-l=rain]') == 'Rain (gauges)'
    assert no_radar.evaluate('__wx.fieldKind()') == 'wind' and no_radar.inner_text('#status').startswith('Live')

    # everything down: the page says so and doesn't crash
    assert 'unavailable' in down.inner_text('#status'), down.inner_text('#status')
    assert 'unavailable' in down.inner_text('[data-l=wind]') and 'unavailable' in down.inner_text('[data-l=temp]')
    down.locator('.pin').first.dispatch_event('click')
    assert '–' in down.inner_text('#card')

    # reduced motion: static arrows, no animation
    still.wait_for_timeout(300)
    assert still.evaluate('__wx.frames()') == 0 and still.evaluate('__wx.arrows()') == 2

    for page in (ok, old, no_radar, down, still, stale_link): assert not page.errors, page.errors
    # phone: the credit stays readable, clear of the note and an open card
    phone = b.new_context(viewport={'width': 375, 'height': 812}).new_page()
    phone.route('https://api-open.data.gov.sg/**', lambda r: r.abort()); phone.route('https://www.onemap.gov.sg/**', lambda r: r.abort()); phone.route('https://static.cloudflareinsights.com/**', lambda r: r.abort())
    phone.goto(url); phone.wait_for_function('window.__wx'); phone.wait_for_selector('.pin')
    phone.locator('.pin').first.dispatch_event('click')
    credit, note, card = (phone.locator(s).bounding_box() for s in ('.leaflet-control-attribution', '#note', '#card'))
    assert card['y'] + card['height'] <= credit['y'] and credit['y'] + credit['height'] <= note['y'], (card, credit, note)
    assert phone.evaluate('document.documentElement.scrollWidth <= innerWidth')
    b.close()
print('ok')
