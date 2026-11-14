# The 3D floor plan's own time slider drives the app's one clock, and its caption follows the sun.
import functools, http.server, socketserver, sys, threading
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit(print('skipped: playwright not installed (pip install playwright && playwright install chromium)'))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory='.'))
threading.Thread(target=srv.serve_forever, daemon=True).start()

SET = "([sel, v]) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input')); }"
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = b.new_context(viewport={'width': 1280, 'height': 900}).new_page()
    errors = []; page.on('pageerror', lambda e: errors.append(str(e)))
    for host in ('https://api-open.data.gov.sg/**', 'https://www.onemap.gov.sg/**', 'https://static.cloudflareinsights.com/**'):
        page.route(host, lambda r: r.abort())
    page.goto(f'http://127.0.0.1:{srv.server_address[1]}/web/?p=bishan-terraces')
    page.wait_for_selector('#loading', state='detached', timeout=60000)
    page.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
    page.evaluate("document.querySelector('#tbody tr[data-s=\"308\"]').click()")
    page.click('#unitCard button[data-a="layout"]')
    page.wait_for_function('window.__plan3dViewers === 1', timeout=60000)

    assert page.is_visible('#planTime')
    page.evaluate(SET, ['#planTime', 600])                       # the pop-up slider moves the main clock
    assert page.input_value('#time') == '600'
    line = page.inner_text('#planSunLine'); assert line.startswith('10:00 am'), line
    page.evaluate(SET, ['#time', 1320])                          # and the main clock moves the pop-up slider
    assert page.input_value('#planTime') == '1320'
    assert page.inner_text('#planSunLine') == '10:00 pm · sun is down'
    assert page.evaluate('__plan3dSun.direct') is False
    for t in range(420, 1141, 60):                               # sun patches only while the caption says the sun is on these windows
        page.evaluate(SET, ['#planTime', t]); line = page.inner_text('#planSunLine')
        assert page.evaluate('__plan3dSun.direct') == ('sun from' in line), (t, line)
    page.set_viewport_size({'width': 375, 'height': 760})        # a long caption wraps below the slider instead of squeezing it
    page.evaluate("document.querySelector('#planSunLine').textContent = '4:30 pm · shaded by a neighbouring HDB block'")
    assert page.evaluate("document.querySelector('#planTime').offsetWidth") >= 160
    page.click('#view2d'); assert page.is_hidden('#planTime')
    assert not errors, errors
    b.close()
print('ok: floor-plan sun slider')
