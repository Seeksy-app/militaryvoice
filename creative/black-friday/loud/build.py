#!/usr/bin/env python3
"""Black Friday social creatives in the look of the /black-friday page. Drafts only.
Run: python3 build.py   (writes the .html sources here, renders PNGs with headless Chrome, makes contact-sheet.jpg)
Uses the page's own art: client/public/bf/*.webp, the logo lockup and the veteran-owned mark."""
import subprocess, pathlib
from PIL import Image
HERE = pathlib.Path(__file__).resolve().parent
ART = "../../../client/public/bf/"
LOGO = "../../../client/public/logo-lockup-dark.png"
VET = "../../../client/public/veteran-owned.png"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

CSS = """
*{margin:0;box-sizing:border-box}
body{position:relative;overflow:hidden;background:#000741;color:#fff;font-family:"General Sans",Inter,"Helvetica Neue",Arial,sans-serif}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shade{position:absolute;inset:0}
.abs{position:absolute}
.gold{background:linear-gradient(#fff4c2,#f7c548 50%,#c98a10);-webkit-background-clip:text;background-clip:text;color:transparent}
.goldfill{background:linear-gradient(#ffe9a0,#f6b93b 55%,#d28a0c)}
.glow{position:absolute;border-radius:50%;background:radial-gradient(rgba(240,167,31,.55),transparent 70%);filter:blur(34px)}
.coin{position:absolute;filter:drop-shadow(0 0 28px rgba(240,167,31,.85))}
.tag{position:absolute;filter:drop-shadow(0 14px 22px rgba(0,0,0,.6))}
.letters{position:absolute;filter:drop-shadow(0 10px 28px rgba(0,0,0,.55))}
.bar{position:absolute;border-radius:26px;padding:4px;background:linear-gradient(#ffe9a0,#f0a71f 55%,#a86a06);box-shadow:0 0 46px rgba(240,167,31,.55)}
.bar .in{height:100%;border-radius:22px;background:#020a38;display:flex;align-items:center;gap:30px;padding:0 28px}
.slab{transform:skewX(-6deg);border-radius:12px;padding:16px 26px;color:#1a1000;font-weight:900;font-style:italic;text-transform:uppercase;line-height:1.05;text-align:center;white-space:nowrap}
.mid{flex:1}.mid b{display:block;font-weight:900;font-style:italic;text-transform:uppercase;line-height:1;white-space:nowrap}
.mid span{display:block;font-weight:800;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}.mid span i{color:#f6b93b;font-weight:900}
.d{border-left:3px solid rgba(240,167,31,.5);padding-left:28px;font-weight:800;text-transform:uppercase;line-height:1.2;white-space:nowrap}.d b{display:block;font-weight:900}
.btn{position:absolute;display:flex;align-items:center;justify-content:center;gap:14px;border-radius:999px;color:#2a1800;font-weight:900;font-style:italic;text-transform:uppercase;letter-spacing:-.01em;white-space:nowrap;box-shadow:0 0 40px rgba(240,167,31,.6),inset 0 3px 0 rgba(255,255,255,.6)}
.foot{position:absolute;display:flex;align-items:center;justify-content:space-between}
.url{font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.vet{background:#fff;border-radius:50%;padding:0;overflow:hidden}
.vet img{width:100%;height:100%;display:block}
.pill{position:absolute;border:3px solid rgba(240,167,31,.7);border-radius:999px;background:rgba(240,167,31,.12);color:#f0a71f;font-weight:800;letter-spacing:.16em;text-transform:uppercase;white-space:nowrap;text-align:center}
.ico{position:absolute;filter:drop-shadow(0 0 16px rgba(240,167,31,.5))}
"""

def page(w, h, body, extra_css=""):
    return f'<!doctype html><meta charset=utf-8><style>{CSS}body{{width:{w}px;height:{h}px}}{extra_css}</style>{body}'

def bar(x, y, w, h, s):
    """The offer bar, scaled by s (1 = 1080 wide design)."""
    return f'''<div class=bar style="left:{x}px;top:{y}px;width:{w}px;height:{h}px"><div class=in style="gap:{30*s}px;padding:0 {26*s}px">
<div class="slab goldfill" style="font-size:{34*s}px;padding:{15*s}px {24*s}px">Black Friday<br>Offer</div>
<div class=mid><b style="font-size:{62*s}px">30 days free</b><span style="margin-top:{9*s}px;font-size:{24*s}px">Then just <i style="font-size:{34*s}px">$19.95</i> / month</span></div>
<div class=d style="font-size:{23*s}px">Offer ends<b style="font-size:{35*s}px">Dec 31, 2026</b></div></div></div>'''

def button(x, y, w, h, fs, text="Become a Founding Member"):
    return f'<div class="btn goldfill" style="left:{x}px;top:{y}px;width:{w}px;height:{h}px;font-size:{fs}px">{text} <span style="font-style:normal">→</span></div>'

def footer_p(y, h=90):
    return f'''<div class=foot style="left:60px;right:60px;top:{y}px;height:{h}px"><span class=url style="font-size:34px">militaryvoices.ai</span><div class=vet style="width:{h}px;height:{h}px"><img src="{VET}"></div></div>'''

def logo(x, y, w): return f'<img class=abs src="{LOGO}" style="left:{x}px;top:{y}px;width:{w}px">'

def plate(pos="0% 50%", flip=False, extra=""):
    return f'<img class=bg src="{ART}plate-wide.webp" style="object-position:{pos};{"transform:scaleX(-1);" if flip else ""}{extra}"><div class=shade style="background:radial-gradient(ellipse at 40% 45%,rgba(0,7,65,.5),rgba(0,7,65,0) 70%),linear-gradient(to bottom,rgba(0,7,65,.0) 55%,rgba(0,7,65,.6))"></div>'

CREATIVES = {}

# P1  portrait hero
CREATIVES["01-hero-portrait-1080x1350"] = (1080, 1350, page(1080, 1350, f'''{plate("0% 50%")}
{logo(60,50,190)}
<div class=pill style="left:560px;top:78px;width:460px;height:54px;line-height:48px;font-size:21px">Founding Members 2026</div>
<img class=letters src="{ART}letters.webp" style="left:20px;top:150px;width:800px">
<img class=tag src="{ART}tag.webp" style="left:700px;top:150px;width:300px;transform:rotate(5deg)">
<div class=glow style="left:600px;top:590px;width:460px;height:460px"></div>
<img class=coin src="{ART}coin.webp" style="left:625px;top:610px;width:410px">
<div class=abs style="left:60px;top:650px;width:540px;font-size:58px;font-weight:800;line-height:1.08;letter-spacing:-.02em">Scale, free for your first <span class=gold>30 days.</span></div>
<div class=abs style="left:60px;top:800px;width:520px;font-size:28px;line-height:1.35;color:rgba(255,255,255,.8)">Card needed at checkout. Cancel before day 30 and you pay nothing.</div>
{bar(55,990,970,140,.86)}
{button(150,1165,780,92,40)}
{footer_p(1262,70)}'''))

# P2  what you get
def tile(img, x, y, label, sub):
    return f'''<img class=ico src="{ART}{img}.webp" style="left:{x}px;top:{y}px;width:180px">
<div class=abs style="left:{x+200}px;top:{y+8}px;width:290px;font-size:36px;font-weight:900;line-height:1.05">{label}</div>
<div class=abs style="left:{x+200}px;top:{y+92}px;width:290px;font-size:25px;line-height:1.3;color:rgba(255,255,255,.78)">{sub}</div>'''
CREATIVES["02-what-you-get-portrait-1080x1350"] = (1080, 1350, page(1080, 1350, f'''{plate("100% 50%", flip=True)}
{logo(60,50,190)}
<div class=pill style="left:560px;top:78px;width:460px;height:54px;line-height:48px;font-size:21px">Founding Members 2026</div>
<div class=abs style="left:60px;top:190px;width:960px;font-size:84px;font-weight:900;font-style:italic;line-height:1;text-transform:uppercase;letter-spacing:-.02em"><span class=gold>What you get</span><br>as a Founding Member</div>
{tile("ico-hosting",50,470,"Free Hosting","Your show, in Apple Podcasts, Spotify and 10+ apps.")}
{tile("ico-studio",545,470,"Recording Studio","Record and go live with your guests.")}
{tile("ico-link",50,735,"Custom Bio Link","One link for your social media profiles.")}
{tile("ico-member",545,735,"Founding Member","Join in 2026 and you're in the founding group.")}
{bar(55,990,970,140,.86)}
{button(150,1165,780,92,40)}
{footer_p(1262,70)}'''))

# P3  the coin
CREATIVES["03-be-a-founding-member-portrait-1080x1350"] = (1080, 1350, page(1080, 1350, f'''{plate("60% 50%")}
{logo(60,50,190)}
<div class=abs style="left:60px;top:200px;width:960px;text-align:center;font-size:92px;font-weight:900;font-style:italic;line-height:1;text-transform:uppercase;letter-spacing:-.02em"><span class=gold>Be a Founding</span><br><span class=gold>Member</span></div>
<div class=glow style="left:210px;top:420px;width:660px;height:660px"></div>
<img class=coin src="{ART}coin.webp" style="left:250px;top:455px;width:580px">
<img class=tag src="{ART}tag.webp" style="left:770px;top:410px;width:240px;transform:rotate(6deg)">
<div class=abs style="left:60px;top:1050px;width:960px;text-align:center;font-size:32px;font-weight:700;line-height:1.3;color:rgba(255,255,255,.9)">Veteran-owned. Built for military and veteran podcasters.<br>Join in 2026 and you're part of the founding group.</div>
{button(150,1170,780,92,40)}
{footer_p(1278,62)}'''))

# P4  ends Dec 31
CREATIVES["04-ends-dec-31-portrait-1080x1350"] = (1080, 1350, page(1080, 1350, f'''{plate("0% 50%")}
{logo(60,50,190)}
<img class=letters src="{ART}letters.webp" style="left:150px;top:165px;width:660px">
<img class=tag src="{ART}tag.webp" style="left:735px;top:170px;width:250px;transform:rotate(5deg)">
<div class=bar style="left:60px;top:640px;width:960px;height:330px;border-radius:34px"><div class=in style="flex-direction:column;justify-content:center;gap:0;border-radius:30px;padding:0">
<svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#F0A71F" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 9.5h18"/><path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01"/></svg>
<div style="font-size:38px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;margin-top:6px">Offer ends</div>
<div class=gold style="font-size:128px;font-weight:900;font-style:italic;line-height:1;text-transform:uppercase;letter-spacing:-.02em">Dec 31, 2026</div></div></div>
<div class=abs style="left:60px;top:1000px;width:960px;text-align:center;font-size:44px;font-weight:900;font-style:italic;text-transform:uppercase;line-height:1.1">30 days free, then just <span class=gold style="font-size:52px">$19.95</span> / month</div>
<div class=abs style="left:60px;top:1075px;width:960px;text-align:center;font-size:26px;color:rgba(255,255,255,.75)">Card needed at checkout. Cancel before day 30 and you pay nothing.</div>
{button(150,1135,780,92,40)}
{footer_p(1262,70)}'''))

# W1  wide hero
CREATIVES["05-hero-wide-1200x627"] = (1200, 627, page(1200, 627, f'''{plate("28% 50%")}
{logo(34,22,120)}
<img class=letters src="{ART}letters.webp" style="left:100px;top:6px;height:430px">
<img class=tag src="{ART}tag.webp" style="left:680px;top:14px;height:350px;transform:rotate(4deg)">
<div class=glow style="left:880px;top:40px;width:330px;height:330px"></div>
<img class=coin src="{ART}coin.webp" style="left:895px;top:55px;height:300px">
{bar(40,448,1120,104,.82)}
<div class=foot style="left:40px;right:40px;top:566px;height:50px"><span class=url style="font-size:23px">militaryvoices.ai</span>
{button(380,0,440,50,23).replace("position:absolute","position:relative")}
<div class=vet style="width:50px;height:50px"><img src="{VET}"></div></div>'''))

# W2  wide what you get
def wtile(img, x, label):
    return f'<img class=ico src="{ART}{img}.webp" style="left:{x}px;top:140px;width:130px"><div class=abs style="left:{x-45}px;top:278px;width:220px;text-align:center;font-size:27px;font-weight:900;line-height:1.1">{label}</div>'
CREATIVES["06-what-you-get-wide-1200x627"] = (1200, 627, page(1200, 627, f'''{plate("100% 50%", flip=True)}
{logo(34,22,120)}
<div class=abs style="left:200px;top:34px;width:960px;text-align:right;font-size:42px;font-weight:900;font-style:italic;line-height:1;text-transform:uppercase;white-space:nowrap"><span class=gold>What you get</span> as a Founding Member</div>
<div class=abs style="left:200px;top:88px;width:960px;text-align:right;font-size:21px;font-weight:800;letter-spacing:.16em;color:#f0a71f;text-transform:uppercase">Founding Members 2026</div>
{wtile("ico-hosting",100,"Free Hosting")}{wtile("ico-studio",360,"Recording Studio")}{wtile("ico-link",620,"Custom Bio Link")}{wtile("ico-member",880,"Founding Member")}
{bar(40,372,1120,104,.82)}
<div class=foot style="left:40px;right:40px;top:505px;height:104px;align-items:flex-end"><span class=url style="font-size:23px;margin-bottom:12px">militaryvoices.ai</span>
{button(380,0,440,56,23).replace("position:absolute","position:relative")}
<div class=vet style="width:62px;height:62px;margin-bottom:0"><img src="{VET}"></div></div>'''))

for name, (w, h, html) in CREATIVES.items():
    f = HERE / f"{name}.html"; f.write_text(html)
    out = HERE / f"{name}.png"
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files", "--force-device-scale-factor=1",
                    "--virtual-time-budget=5000", f"--window-size={w},{h}", f"--screenshot={out}", f"file://{f}"], capture_output=True)
    print(name, Image.open(out).size)

# contact sheet
names = list(CREATIVES)
ims = [Image.open(HERE / f"{n}.png").convert("RGB") for n in names]
P = [i for i in ims if i.height > i.width]; Wd = [i for i in ims if i.width > i.height]
ph = 560; pw = round(1080 * ph / 1350)
ww = 2 * pw + 20 ; wh = round(627 * ww / 1200 / 1)  # not used
cols = 4; gap = 24
row1 = [i.resize((pw, ph)) for i in P]
w2 = 2 * pw + gap; h2 = round(627 * w2 / 1200)
row2 = [i.resize((w2, h2)) for i in Wd]
W = max(cols * pw + (cols + 1) * gap, 2 * w2 + 3 * gap); H = ph + h2 + 3 * gap
sheet = Image.new("RGB", (W, H), (20, 24, 50))
x = gap
for i in row1: sheet.paste(i, (x, gap)); x += pw + gap
x = gap
for i in row2: sheet.paste(i, (x, 2 * gap + ph)); x += w2 + gap
sheet.save(HERE / "contact-sheet.jpg", quality=88)
print("sheet", sheet.size)
