"""Headless browser check of the built game: python3 tests/ui.py [phone|desk] [live|replay|watch|shift|whatif] [fake Toronto time, e.g. 2026-10-14T08:05]
Screenshots go to shots/<mode>_<view>_*.png; page errors are printed at the end."""
import asyncio, json, sys
from playwright.async_api import async_playwright

import os; URL = 'file://' + os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'out', 'gridlock.html'))
VIEW = sys.argv[1] if len(sys.argv) > 1 else 'desk'
MODE = sys.argv[2] if len(sys.argv) > 2 else 'live'
FAKE = sys.argv[3] if len(sys.argv) > 3 else None
W, H = (390, 844) if VIEW == 'phone' else (1280, 800)
BTN = {'live': '#goLive', 'replay': '#goReplay', 'whatif': '#goWhat'}[MODE]
TAG = f'shots/{MODE}_{VIEW}'

FLY = """([x, y, h]) => { const c = __gl.cam; c.x = x; c.y = y; c.h = h; __gl.DIR.auto = false; }"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=1)
        if FAKE:  # shift the page clock (Toronto time, EDT) so the sim starts at a chosen moment
            await ctx.add_init_script(f"(() => {{ const off = Date.parse('{FAKE}:00-04:00') - Date.now(); const now = Date.now; Date.now = () => now() + off; }})()")
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        await pg.goto(URL); await pg.wait_for_timeout(4000)
        print('liveStat:', await pg.evaluate("document.getElementById('liveStat').textContent"))
        await pg.screenshot(path=f'{TAG}_0start.png', timeout=180000)
        await pg.click(BTN)
        await pg.wait_for_function("document.getElementById('start').hidden", timeout=300000)
        await pg.wait_for_timeout(5000)
        print('info', json.dumps(await pg.evaluate("__gl.cmd('liveInfo')"))[:600])
        print('world', await pg.evaluate("""JSON.stringify({ src: __gl.LV.src, statSrc: __gl.LV.statSrc, err: __gl.LV.err, ws: __gl.LV.ws && Object.fromEntries(Object.entries(__gl.LV.ws).map(([k, v]) => [k, v.length])),
            wl: __gl.LV.wl && { day: __gl.LV.wl.day, schools: __gl.LV.wl.schools.length, worship: __gl.LV.wl.worship.length, sites: __gl.LV.wl.sites.length, gates: __gl.LV.wl.gates, spots: __gl.LV.wl.spots.length },
            hud: document.getElementById('clkd').textContent, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent).slice(0, 6) })"""))
        await pg.evaluate("__gl.DIR.auto = false")
        await pg.screenshot(path=f'{TAG}_1overview.png', timeout=180000)
        for btn in ('incBtn', 'statBtn'):  # the two dropdowns from the top bar
            await pg.click('#' + btn); await pg.wait_for_timeout(800); await pg.screenshot(path=f'{TAG}_1{btn}.png', timeout=180000)
        await pg.click('#statBtn')
        spots = {
            'towers': "(() => { const t = __gl.LV.ws.towers.slice().sort((a, b) => b[2] - a[2])[0]; return [t[0], t[1], 900]; })()",
            'school': "(() => { const q = __gl.LV.wl.schools[0]; const s = __gl.LV.ws.schools[q ? q[0] : 0]; return [s.x, s.y, 170]; })()",
            'crossing': "(() => { const g = __gl.LV.wl.gates[0]; const c = __gl.LV.ws.crossings[g !== undefined ? g : 0]; return [c[0], c[1], 260]; })()",
            'crane': "(() => { const s = __gl.LV.ws.sites.find(s => s.crane) || __gl.LV.ws.sites[0]; return [s.x, s.y, 330]; })()",
            'spot': "(() => { const i = __gl.LV.wl.spots[0]; const s = __gl.LV.ws.spots[i || 0]; return [s.x, s.y, 120]; })()",
            'worship': "(() => { const i = __gl.LV.wl.worship[0]; const w = __gl.LV.ws.worship[i || 0]; return [w.x, w.y, 160]; })()",
        }
        for name, js in spots.items():
            try:
                await pg.evaluate(FLY, await pg.evaluate(js)); await pg.wait_for_timeout(3500)
                await pg.screenshot(path=f'{TAG}_2{name}.png', timeout=180000)
            except Exception as e:  # noqa: BLE001
                print('view', name, 'failed:', str(e)[:200])
        sheets = [("school", "__gl.LV.wl.schools.length ? __gl.LV.wl.schools[0][0] : 0"), ("worship", "0"), ("site", "__gl.LV.ws.sites.findIndex(s => s.crane)"), ("spot", "0"),
                  ("tower", "0"), ("zone", "(__gl.LV.zones.find(z => z.src === 'cut' && z.on) || __gl.LV.zones[0]).id"), ("live", "0")]
        for k, idx in sheets:
            await pg.evaluate(f"__gl.select({{ k: '{k}', id: {idx} }})"); await pg.wait_for_timeout(1500)
            print('sheet', k, (await pg.evaluate("document.getElementById('sheet').innerText"))[:300].replace('\n', ' | '))
            await pg.screenshot(path=f'{TAG}_3sheet_{k}.png', timeout=180000)
        print('ERRORS', json.dumps(errs[:20], indent=1))
        await b.close()

asyncio.run(main())
