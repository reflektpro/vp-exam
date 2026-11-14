# Набор примитивов для схем вопросов (SVG без внешних ресурсов, стиль — как у схемы строя su-h01…h06).
import math
BG = '#f4f1e8'; INK = '#333'; SOL = '#4a6b3a'; ROAD = '#9a9a92'; WALK = '#d9d2bf'; GRASS = '#cfdcb4'; BLD = '#d9cfb4'
CARC = ['#3b6ea5', '#b0413e', '#c99a2e', '#7a5c99', '#2f7f7a', '#8a5a3c']
def esc(s): return str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
class Svg:
    def __init__(s, W=480, H=320, bg=BG):
        s.W, s.H, s.el, s.zones = W, H, [], []
        s.el.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="{bg}"/>')
    def add(s, x): s.el.append(x); return s
    def rect(s, x, y, w, h, fill='none', stroke=INK, sw=2, rx=0, dash=None, op=None):
        d = f' stroke-dasharray="{dash}"' if dash else ''; o = f' opacity="{op}"' if op else ''
        return s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{d}{o}/>')
    def line(s, x1, y1, x2, y2, stroke=INK, sw=2, dash=None):
        d = f' stroke-dasharray="{dash}"' if dash else ''
        return s.add(f'<path d="M{x1} {y1} L{x2} {y2}" stroke="{stroke}" stroke-width="{sw}" fill="none"{d}/>')
    def path(s, d, stroke=INK, sw=2, fill='none', dash=None):
        dd = f' stroke-dasharray="{dash}"' if dash else ''
        return s.add(f'<path d="{d}" stroke="{stroke}" stroke-width="{sw}" fill="{fill}"{dd}/>')
    def text(s, x, y, t, size=14, anchor='middle', fill='#222', bold=False):
        b = ' font-weight="bold"' if bold else ''
        return s.add(f'<text x="{x}" y="{y}" font-family="Arial, sans-serif" font-size="{size}" text-anchor="{anchor}" fill="{fill}"{b}>{esc(t)}</text>')
    def arrow(s, x1, y1, x2, y2, stroke=INK, sw=3, head=10):
        a = math.atan2(y2 - y1, x2 - x1); hx, hy = x2 - head * math.cos(a), y2 - head * math.sin(a)
        l = (hx + head * 0.6 * math.sin(a), hy - head * 0.6 * math.cos(a)); r = (hx - head * 0.6 * math.sin(a), hy + head * 0.6 * math.cos(a))
        s.line(x1, y1, round(hx, 1), round(hy, 1), stroke, sw)
        return s.add(f'<path d="M{x2} {y2} L{l[0]:.1f} {l[1]:.1f} L{r[0]:.1f} {r[1]:.1f} Z" fill="{stroke}"/>')
    def soldier(s, x, y, ang=0, r=13, fill=SOL, ring=False):
        g = f'<g transform="translate({x} {y}) rotate({ang})"><circle cx="0" cy="0" r="{r}" fill="{fill}" stroke="#222" stroke-width="2"/><path d="M-6 -{r-5} L0 -{r+3} L6 -{r-5}" stroke="#fff" stroke-width="2" fill="none"/></g>'
        if ring: g += f'<circle cx="{x}" cy="{y}" r="{r+6}" fill="none" stroke="#b0413e" stroke-width="3"/>'
        return s.add(g)
    def empty(s, x, y, r=13): return s.add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="#999" stroke-width="2" stroke-dasharray="4 3"/>')
    def car(s, x, y, ang=0, color=CARC[0], w=22, h=40, tag=None, beacon=False, blink=None, truck=False):
        # (x,y) — центр; ang — куда направлен перед машины (0 — вверх); лобовое стекло — тёмная полоса у переднего края
        body = f'<rect x="{-w/2}" y="{-h/2}" width="{w}" height="{h}" rx="5" fill="{color}" stroke="#222" stroke-width="2"/>'
        if truck: body += f'<rect x="{-w/2}" y="{-h/2}" width="{w}" height="{h*0.3:.0f}" rx="4" fill="#3a3a3a" stroke="#222" stroke-width="2"/><rect x="{-w/2+3}" y="{-h/2+h*0.3+3:.0f}" width="{w-6}" height="{h*0.7-6:.0f}" fill="none" stroke="#222" stroke-width="1"/>'
        else: body += f'<rect x="{-w/2+3}" y="{-h/2+6}" width="{w-6}" height="7" rx="2" fill="#2b2b2b"/>'
        if beacon: body += f'<rect x="{-w/2+2}" y="{-2}" width="{w/2-2}" height="6" fill="#1f4fd1"/><rect x="0" y="-2" width="{w/2-2}" height="6" fill="#d12f2f"/>'
        if blink: # 'l' / 'r' — включённый указатель поворота
            bx = -w/2 - 4 if blink == 'l' else w/2 - 2
            body += f'<rect x="{bx}" y="{-h/2+1}" width="6" height="6" fill="#ff9f1a" stroke="#222" stroke-width="1"/><rect x="{bx}" y="{h/2-7}" width="6" height="6" fill="#ff9f1a" stroke="#222" stroke-width="1"/>'
        s.add(f'<g transform="translate({x} {y}) rotate({ang})">{body}</g>')
        if tag: s.text(x, y + 5, tag, 12, fill='#fff', bold=True)
        return s
    def person(s, x, y, fill='#555'):
        return s.add(f'<circle cx="{x}" cy="{y}" r="6" fill="{fill}" stroke="#222" stroke-width="1.5"/>')
    def zone(s, x, y, w, h, label, correct=False):
        x, y = max(0, x), max(0, y); w = min(w, s.W - x); h = min(h, s.H - y)
        s.zones.append({'x': round(x / s.W * 100, 1), 'y': round(y / s.H * 100, 1), 'w': round(w / s.W * 100, 1), 'h': round(h / s.H * 100, 1), 'label': label, '_c': correct})
        return s
    def svg(s):
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s.W} {s.H}" width="{s.W}" height="{s.H}">' + ''.join(s.el) + '</svg>'
    def hz(s, correct_labels=None, correct_idx=None):
        out = []
        for i, z in enumerate(s.zones):
            c = (correct_idx is not None and i in correct_idx) or (correct_labels is not None and z['label'] in correct_labels)
            out.append({k: v for k, v in z.items() if k != '_c'} | {'correct': bool(c)})
        assert any(z['correct'] for z in out), 'нет правильной зоны'
        return out
