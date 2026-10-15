"""Demo video builder (adapted from the author's earlier hackathon builder, disclosed in README).
narration.json -> edge-tts audio (video_kit/tts_edge.py, word boundaries) -> timeline.json -> Playwright records the LIVE deployed app -> ffmpeg mux.
Run: python3 build.py   (from video/; needs the author's local video_kit for tts + gate checks)"""
import json, os, subprocess, sys, time, shutil
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out"); TMP = os.path.join(OUT, "_tmp")
URL = "https://wild-bugs-ten.vercel.app/"
W, H, CH, FPS = 1280, 720, 576, 30
GAPS = [0.5, 0.45, 0.4, 0.55, 0.45, 0.5, 0.4, 0.6, 0.45, 0.5, 0.55]
FFMPEG = shutil.which("ffmpeg")
NAME = "freshroute-demo"
EV = json.load(open(os.path.join(HERE, "..", "eval-results.json")))["summary"]


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode())


def split_cues(text, maxc=42):
    if len(text) <= maxc: return [text]
    mid = len(text) / 2
    for i in sorted((m.end() for m in __import__("re").finditer(r"[,:] ", text)), key=lambda x: abs(x - mid)):
        a, b = text[:i].strip(), text[i:].strip()
        if len(a) <= maxc and len(b) <= maxc: return [a, b]
    words = text.split(); n = -(-len(text) // maxc); target = len(text) / n; cues, cur = [], ""
    for w in words:
        nxt = (cur + " " + w).strip()
        if cur and (len(nxt) > maxc or (len(cues) < n - 1 and len(cur) >= target * 0.8 and len(nxt) > target)):
            cues.append(cur); cur = w
        else: cur = nxt
    if cur: cues.append(cur)
    return cues


def plan():
    lines = json.load(open(f"{HERE}/narration.json", encoding="utf-8"))["lines"]
    t, sents, cues, mp3 = 0.3, [], [], []
    for i, ln in enumerate(lines):
        w = json.load(open(f"{HERE}/audio/{ln['id']}.words.json", encoding="utf-8"))
        w0, w1 = w[0]["start"], w[-1]["end"]
        T = t - w0 if i == 0 else t
        start, end = round(T + w0, 3), round(T + w1, 3)
        sents.append({"id": ln["id"], "start": start, "end": end, "text": ln["sub"], "pause_before": 0.0, "emphasis": False})
        parts = split_cues(ln["sub"]); tot = sum(len(p.replace(" ", "")) for p in parts); c0 = start
        for k, p in enumerate(parts):
            c1 = end if k == len(parts) - 1 else round(max(c0 + (end - start) * len(p.replace(" ", "")) / tot, c0 + 0.95), 3)
            cues.append({"start": c0, "end": round(c1 - (0.1 if k < len(parts) - 1 else 0), 3), "lines": [p]}); c0 = c1
        mp3.append((f"{HERE}/audio/{ln['id']}.mp3", T))
        if i < len(GAPS):
            nw0 = json.load(open(f"{HERE}/audio/{lines[i+1]['id']}.words.json", encoding="utf-8"))[0]["start"]
            t = end + GAPS[i] - nw0
    return lines, sents, cues, mp3


SW = EV["sweep"]; HL = EV["headline"]
FACTS = [
    "Held-out data: 30 seeds, never used while building",
    f"Rule breaks by the plan: {EV['S4_violations']['planSeedsWithViolations']} of 30 datasets",
    f"Net vs strongest of 4 baselines: {SW[0]['upliftPct']:+.1f}% / {SW[1]['upliftPct']:+.1f}% / {SW[2]['upliftPct']:+.1f}%",
    f"(elasticity 0.5 / 1.0 / 1.5), never worse in {round(HL['neverLoseRate']*30)} of 30",
    f"Really spoiled 0 kg. Unsold stock {HL['planUnsoldRate']*100:.1f}% vs {HL['bestBaseUnsoldRate']*100:.1f}%",
]
END = ["FreshRoute", "Wild Bugs · PS 03", "Synthetic data. Assumptions and tests are public."]


def card(page, rows, title):
    html = "<body style='margin:0;font-family:-apple-system,Helvetica;background:#fff;color:#191F28'><div style='padding:48px 80px'>" \
           f"<div style='font-size:38px;font-weight:700;color:#1B64DA;margin-bottom:24px'>{title}</div>" + "".join(
        f"<div id='r{i}' style='font-size:32px;line-height:1.5;margin:12px 0;opacity:0'>{r}</div>" for i, r in enumerate(rows)) + "</div></body>"
    page.set_content(html)


def js(p, code): return p.evaluate(code)
ACTIONS = {
    "s04": lambda p: js(p, "document.getElementById('kpis').scrollIntoView({behavior:'smooth',block:'start'})"),
    "s05": lambda p: js(p, "document.querySelectorAll('.kpi .verdict').forEach(e=>e.style.outline='3px solid #1B64DA')"),
    "s06": lambda p: js(p, "document.getElementById('ships').scrollIntoView({behavior:'smooth',block:'start'})"),
    "s07": lambda p: (p.select_option('#elast', '1.5'), js(p, "document.getElementById('run').click()"), p.wait_for_timeout(900), js(p, "document.getElementById('discs').scrollIntoView({behavior:'smooth',block:'start'})")),
    "s08": lambda p: (js(p, "window.scrollTo({top:0,behavior:'smooth'})"), p.wait_for_timeout(700), p.select_option('#elast', '0.5'), p.select_option('#preset', 'closed'), js(p, "document.getElementById('run').click()")),
    "s09": lambda p: js(p, "document.getElementById('status').style.outline='3px solid #1B64DA'"),
    "s10": lambda p: js(p, "document.getElementById('stress').scrollIntoView({behavior:'smooth',block:'center'})"),
}


def record(sents):
    os.makedirs(TMP, exist_ok=True)
    for f in os.listdir(TMP):
        if f.endswith(".webm"): os.remove(f"{TMP}/{f}")
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        ctx = b.new_context(viewport={"width": W, "height": CH}, record_video_dir=TMP, record_video_size={"width": W, "height": CH})
        page = ctx.new_page(); page.goto(URL, wait_until="networkidle"); page.wait_for_function("window.__freshroute"); page.evaluate("document.body.style.zoom=1.25;document.querySelector('.cta').style.display='none'"); page.wait_for_timeout(400)
        t0 = time.monotonic()
        for s in sents:
            tgt = max(s["start"] - 0.3, 0)
            while time.monotonic() - t0 < tgt: time.sleep(0.01)
            if s["id"] in ACTIONS: ACTIONS[s["id"]](page)
            if s["id"] == "s11":
                card(page, FACTS, "Measured on held-out datasets")
                for i in range(len(FACTS)):
                    page.evaluate(f"document.getElementById('r{i}').style.opacity=1"); page.wait_for_timeout(700 if i < len(FACTS) - 1 else 200)
            if s["id"] == "s12":
                card(page, END, "Thank you"); [page.evaluate(f"document.getElementById('r{i}').style.opacity=1") for i in range(3)]
        end = sents[-1]["end"] + 0.8
        while time.monotonic() - t0 < end: time.sleep(0.01)
        vid = page.video.path(); ctx.close(); b.close()
    return vid


def srt(cues):
    f = lambda x: "%02d:%02d:%02d,%03d" % (x // 3600, x % 3600 // 60, x % 60, int(round((x % 1) * 1000)) % 1000)
    return "\n".join(f"{i+1}\n{f(c['start'])} --> {f(c['end'])}\n{c['lines'][0]}\n" for i, c in enumerate(cues))


def ass(cues):
    hd = ("[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n[V4+ Styles]\n"
          "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
          "Style: D,Helvetica Neue,44,&H00281F19,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,1,0,0,0,100,100,0,0,1,0,0,2,40,40,50,1\n[Events]\n"
          "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n")
    f = lambda x: "%d:%02d:%05.2f" % (x // 3600, x % 3600 // 60, x % 60)
    return hd + "".join(f"Dialogue: 0,{f(c['start'])},{f(c['end'])},D,,0,0,0,,{c['lines'][0]}\n" for c in cues)


def main():
    lines, sents, cues, mp3 = plan()
    os.makedirs(OUT, exist_ok=True)
    total = sents[-1]["end"] + 0.8
    vid = record(sents)
    vd = dur(vid); ss = max(vd - total, 0)
    inputs, flt = [], []
    for k, (p, T) in enumerate(mp3):
        inputs += ["-i", p]; flt.append(f"[{k+1}:a]adelay={int(T*1000)}|{int(T*1000)}[a{k}]")
    flt.append("".join(f"[a{k}]" for k in range(len(mp3))) + f"amix=inputs={len(mp3)}:normalize=0,volume={VOL}dB,alimiter=limit=0.8:level=0[aout]")
    open(f"{TMP}/subs.ass", "w", encoding="utf-8").write(ass(cues))
    cmd = [FFMPEG, "-y", "-ss", f"{ss:.3f}", "-i", vid] + inputs + ["-filter_complex", f"[0:v]fps={FPS},pad={W}:{H}:0:0:white,subtitles={TMP}/subs.ass[v];" + ";".join(flt),
           "-map", "[v]", "-map", "[aout]", "-t", f"{total:.3f}", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-c:a", "aac", "-b:a", "160k", f"{OUT}/{NAME}.mp4"]
    subprocess.run(cmd, check=True, capture_output=True)
    open(f"{OUT}/{NAME}.srt", "w", encoding="utf-8").write(srt(cues))
    open(f"{OUT}/narration.txt", "w", encoding="utf-8").write("\n".join(l["sub"] for l in lines) + "\n")
    screen = ["FreshRoute", "Pick a day to plan", "Ship in this order", "Discount only where it pays", "If things go wrong", "Net revenue after all costs", "Measured on held-out datasets", "Thank you"] + FACTS + END
    tl = {"fps": FPS, "lang": "en", "layout": {"content": [0, 0, 1280, CH], "subtitle_band": [0, CH, 1280, H]}, "sentences": sents, "cues": cues, "cuts": [], "screen_text": screen}
    json.dump(tl, open(f"{HERE}/timeline.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("ok", round(total, 1), "s; trim", round(ss, 2))


VOL = float(os.environ.get("VOL_DB", "0"))
if __name__ == "__main__":
    main()
