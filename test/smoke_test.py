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
    assert not errors, errors
    b.close()
srv.shutdown()
print('ok', no)
