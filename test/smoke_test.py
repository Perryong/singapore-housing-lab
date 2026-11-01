# The app in a real browser: it loads, a unit can be picked, and after "Clear selection" the same unit can be
# clicked again (hidden selection meshes must not swallow clicks; three.js raycasting ignores .visible).
import functools, http.server, socketserver, sys, threading
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit(print('skipped: playwright not installed (pip install playwright && playwright install chromium)'))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
handler = functools.partial(Quiet, directory='.')
srv = socketserver.TCPServer(('127.0.0.1', 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/web/?p=kim-keat-crest'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = b.new_page(viewport={'width': 1280, 'height': 800})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_selector('#loading', state='detached', timeout=60000)      # model.glb loaded and painted

    page.click('#tbody tr')                                                  # pick a stack from the table
    while page.is_enabled('#unitCard button[data-a="up"]'):                  # top floor: nothing stands in front of it
        page.click('#unitCard button[data-a="up"]')
    no = page.text_content('#unitCard .unit-no')
    assert no and no.startswith('#'), no
    page.wait_for_timeout(2500)                                              # camera eases onto the flat; clearing stops it
    page.click('#unitCard button[data-a="clear"]')
    assert page.query_selector('#unitCard .unit-no') is None

    # The hidden selection box encloses the cleared flat, so any ray to that flat crosses the box first: before the
    # fix the flat could never be hovered or clicked. Scan down the canvas centre for its tooltip, then click there.
    box = page.query_selector('#stage canvas').bounding_box()
    cx, cy, spot = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, None
    for dy in range(-200, 201, 8):
        page.mouse.move(cx, cy + dy); page.wait_for_timeout(40)
        if (page.text_content('#tip') or '').startswith(no + ' '):
            spot = cy + dy; break
    assert spot is not None, f'{no} cannot be hovered after clearing the selection'
    page.mouse.click(cx, spot)
    again = page.text_content('#unitCard .unit-no') if page.query_selector('#unitCard .unit-no') else None
    assert again == no, f'clicking {no} after clearing selected {again}'

    # Window view: from a selected unit, floor buttons move the eye one storey, exit restores the view, Esc also leaves
    page.click('#tbody tr'); home = None
    page.click('#unitCard button[data-a="view"]')
    assert page.is_visible('#winBar') and 'simulated' in page.text_content('#winText')
    eye = page.evaluate('__cam()')
    if page.is_enabled('#winDown'): page.click('#winDown'); low = page.evaluate('__cam()'); assert abs(eye[1] - low[1] - 2.8) < 0.5, (eye, low); page.click('#winUp')
    page.click('#winExit'); assert not page.is_visible('#winBar')
    assert page.evaluate('__cam()') != eye
    page.click('#unitCard button[data-a="view"]'); page.keyboard.press('Escape'); assert not page.is_visible('#winBar')
    page.click('#unitCard button[data-a="clear"]')

    # Resale nearby turns off again, on projects with and without other modes, and the camera goes back
    def on(sel): return page.get_attribute(sel, 'aria-pressed') == 'true'
    def resale_is(state, why):
        assert on('#modes .mode[data-m=resale]') == state and page.is_visible('#resalePanel') == state \
            and page.is_visible('#resaleBack') == state, why
    CAM = '([g, d, far]) => { const v = Math.hypot(...__cam().map((x, i) => x - g[i])); return far ? v > d : v < d; }'
    def cam(goal, d, far=False):                                                 # software rendering runs at ~1 fps
        page.wait_for_function(CAM, arg=[goal, d, far], timeout=90000)
    def visit(u):                                                                # a fresh page: the old one's render loop slows CI
        global page
        page.close(); page = b.new_page(viewport={'width': 1280, 'height': 800})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(u, wait_until='domcontentloaded', timeout=90000)
        page.wait_for_selector('#loading', state='detached', timeout=90000)
    for slug, off in (('kim-keat-crest', '#modes .mode[data-m=resale]'), ('tengah-oct-2026', '#resaleOff')):
        visit(url.replace('kim-keat-crest', slug))
        before = page.evaluate('__cam()')
        resale_is(False, f'{slug}: starts off')
        page.click('#modes .mode[data-m=resale]')
        resale_is(True, f'{slug}: on')
        cam(before, 20, far=True)
        page.click(off)
        resale_is(False, f'{slug}: {off} turns it off')
        cam(before, 5)
    visit(url)
    # Phone: nothing, such as the sticky header, may cover the window view controls
    page.close(); page = b.new_page(viewport={'width': 375, 'height': 812})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url, wait_until='domcontentloaded', timeout=90000)
    page.wait_for_selector('#loading', state='detached', timeout=90000)
    page.click('#tbody tr'); page.click('#unitCard button[data-a="view"]')
    page.wait_for_function('''() => ['winUp', 'winDown', 'winExit'].every(i => {
        const e = document.getElementById(i), r = e.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === e; })''', timeout=60000)   # after the smooth scroll
    visit(url)
    page.click('#modes .mode[data-m=resale]'); page.click('#modes .mode[data-m=pm]')
    assert on('#modes .mode[data-m=pm]') and not page.is_visible('#resalePanel')  # another mode still leaves resale
    assert page.is_visible('#tableWrap')
    assert not errors, errors
    b.close()
srv.shutdown()
print('ok', no)
