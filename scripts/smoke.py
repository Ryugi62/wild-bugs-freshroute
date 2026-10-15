import sys, threading, functools, http.server, os
from playwright.sync_api import sync_playwright
url=sys.argv[1] if len(sys.argv)>1 else None
srv=None
if not url:
    h=functools.partial(http.server.SimpleHTTPRequestHandler,directory=os.getcwd())
    class Q(h.func):
        def log_message(self,*a): pass
    srv=http.server.ThreadingHTTPServer(('127.0.0.1',8099),functools.partial(Q,directory=os.getcwd()))
    threading.Thread(target=srv.serve_forever,daemon=True).start(); url='http://127.0.0.1:8099/'
with sync_playwright() as p:
    b=p.chromium.launch()
    for w,hh,n in [(390,844,'m'),(1280,900,'d')]:
        pg=b.new_page(viewport={'width':w,'height':hh})
        errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' else None)
        r=pg.goto(url); pg.wait_for_function("window.__freshroute",timeout=20000)
        print(n,r.status,pg.evaluate("window.__freshroute"),errs,'scrollW',pg.evaluate("document.documentElement.scrollWidth"),w)
        pg.screenshot(path=f'shots/{n}.png',full_page=True)
        if n=='m':
            pg.select_option('#preset','closed'); pg.click('#run'); pg.wait_for_timeout(1500); print('closed',pg.inner_text('#status'))
    b.close()
if srv: srv.shutdown()
