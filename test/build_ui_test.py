# The BTO build page in a real browser: it loads, scrubs, fits any window, and says so when there is nothing to build.
import functools, http.server, socketserver, sys, threading
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit(print('skipped: playwright not installed (pip install playwright && playwright install chromium)'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory='.'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{srv.server_address[1]}/web/build.html'
NO_LAYOUT = "This project's blocks aren't released yet"


pages = []


def open_page(b, p='kim-keat-crest', size=(1600, 900), no_model=False, init=None, pin_only=False):
    while pages: pages.pop().close()                                       # one render loop at a time, or software GL starves
    page = b.new_context(viewport={'width': size[0], 'height': size[1]}).new_page()
    page.errors = []
    page.on('pageerror', lambda e: page.errors.append(str(e)))
    page.route('https://www.onemap.gov.sg/**', lambda r: r.abort())
    page.route('https://static.cloudflareinsights.com/**', lambda r: r.abort())
    if no_model:
        page.route('**/projects/*/model.glb', lambda r: r.fulfill(status=404, body='missing'))
    if pin_only:
        page.route('**/projects/*/project.json', strip_layout)
    if init:
        page.add_init_script(init)
    page.goto(f'{base}?p={p}')
    pages.append(page)
    return page


def strip_layout(route):
    # a project as it is before HDB releases its site plan: placed by pin only, no blocks or stacks
    r = route.fetch(); P = r.json()
    P.update(stacks=[], blocks={}); P.pop('plan', None)
    route.fulfill(response=r, json=P)


def seek(page, t):
    page.evaluate(f"(() => {{ const s = document.querySelector('#scrub'); s.value = {t}; s.dispatchEvent(new Event('input')); }})()")
    page.wait_for_timeout(150)


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

    page = open_page(b)
    page.wait_for_function('window.__build && __build.ready', timeout=60000)
    assert not page.errors, page.errors
    seek(page, 10)
    assert page.evaluate('__build.step') > 0
    assert 'BLK ' in page.inner_text('#active') and 'TYPICAL FLOORS' in page.inner_text('#timeline .cur')
    lines_at_10 = page.locator('#log div').count()
    seek(page, 2)
    assert lines_at_10 <= 7 and page.evaluate('__build.step') == 0
    assert page.locator('#log div').count() == 0, 'log rebuilds when scrubbing back to before the floors'
    page.click('#strip .st[data-stage="3"]')
    page.wait_for_timeout(150)
    assert abs(page.evaluate('__build.t') - 17.8) < 0.3, page.evaluate('__build.t')
    assert not page.errors, page.errors

    page = open_page(b, size=(1280, 800))
    page.wait_for_function('window.__build && __build.ready', timeout=60000)
    assert page.evaluate('document.scrollingElement.scrollHeight <= innerHeight && document.scrollingElement.scrollWidth <= innerWidth')
    box = page.evaluate("(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; })()")
    assert box[0] >= -1 and box[1] >= -1 and box[2] <= 1281 and box[3] <= 801, box

    page = open_page(b, no_model=True)
    page.wait_for_function(f'document.body.innerText.includes("{NO_LAYOUT}")', timeout=30000)
    page = open_page(b, p='bedok-bayshore-ii-oct-2026', pin_only=True)
    page.wait_for_function(f'document.body.innerText.includes("{NO_LAYOUT}")', timeout=30000)

    # capture refused: say so, keep playing
    page = open_page(b, init='navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new Error("denied"))')
    page.wait_for_function('window.__build && __build.ready', timeout=60000)
    page.click('#rebuild'); page.click('#record')
    page.wait_for_function('document.querySelector("#msg").innerText.includes("Recording needs permission to capture this tab.")', timeout=10000)
    t0 = page.evaluate('__build.t')
    page.wait_for_function(f'__build.t > {t0}', timeout=15000)                 # playback carries on

    # capture granted (stubbed with the page's own canvas, since a real tab share needs a person): the sequence records and downloads
    page = open_page(b, init='navigator.mediaDevices.getDisplayMedia = async () => document.querySelector("#view canvas").captureStream(30)')
    page.wait_for_function('window.__build && __build.ready', timeout=60000)
    page.click('#speed')                                                     # ×2: the 25 s sequence records in 12.5 s
    with page.expect_download(timeout=60000) as dl:
        page.click('#record')
        page.wait_for_function('!document.querySelector("#recDot").hidden', timeout=10000)
    name = dl.value.suggested_filename
    assert name in ('kim-keat-crest-build.mp4', 'kim-keat-crest-build.webm'), name
    assert __import__('os').path.getsize(dl.value.path()) > 10_000
    assert page.evaluate('document.querySelector("#recDot").hidden')

    # pausing mid-recording ends it (and downloads what was recorded); while recording, Record reads Stop and stops it
    stub = 'navigator.mediaDevices.getDisplayMedia = async () => document.querySelector("#view canvas").captureStream(30)'
    page = open_page(b, init=stub)
    page.wait_for_function('window.__build && __build.ready', timeout=60000)
    with page.expect_download(timeout=30000):
        page.click('#record')
        page.wait_for_function('!document.querySelector("#recDot").hidden', timeout=10000)
        assert 'Stop' in page.inner_text('#record')
        page.click('#play')                                                      # pause
    page.wait_for_function('document.querySelector("#recDot").hidden', timeout=10000)
    assert 'Record' in page.inner_text('#record')
    with page.expect_download(timeout=30000):
        page.click('#record')
        page.wait_for_function('!document.querySelector("#recDot").hidden', timeout=10000)
        page.click('#record')                                                    # Stop
    page.wait_for_function('document.querySelector("#recDot").hidden', timeout=10000)

    # a project whose stacks name their block by number still builds; no made-up scale or method on the drawing
    page = open_page(b, p='thomson-reserve')
    page.wait_for_function('window.__build && __build.ready', timeout=60000)
    seek(page, 10)
    assert not page.errors and 'BLK ' in page.inner_text('#active'), page.errors
    assert '1:600' not in page.inner_text('#stage'), 'no scale on a perspective drawing'
    assert 'precast' not in (page.inner_text('#titleSpec') + page.inner_text('#active')).lower(), 'no construction method the data does not give'

    page = open_page(b, size=(800, 900))
    assert 'BTO Build is made for desktop recording.' in page.inner_text('body')
    b.close()
print('ok: build page')
