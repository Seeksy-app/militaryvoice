"""Where the speakers are, and who is talking when.

  python3 focus.py <video> <startSec> <endSec> <words.json> <out.json>

Samples the clip's frames, finds the faces, groups them into the panels of
the picture (a two-person remote recording is two boxes side by side), and
maps each diarised speaker to a panel by watching which panel moves while
they talk. Writes a timeline the renderer cuts to. Everything in it can be
edited by hand and re-rendered: that is the post edit.
"""
import sys, json
import cv2, numpy as np

video, start, end, words_path, out_path = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4], sys.argv[5]
words = [w for w in json.load(open(words_path)) if start <= w["start"] and w["end"] <= end + 0.3]
cap = cv2.VideoCapture(video)
W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
cascade = cv2.CascadeClassifier("/root/mv-prep/haar.xml")

def frame_at(t, width=640):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, f = cap.read()
    if not ok: return None
    s = width / f.shape[1]
    return cv2.resize(f, (width, int(f.shape[0] * s))), s

# ---- faces, on a dozen frames spread across the clip ----
boxes = []
for i in range(12):
    t = start + (end - start) * (i + 0.5) / 12
    r = frame_at(t)
    if r is None: continue
    f, s = r
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
    for (x, y, w, h) in cascade.detectMultiScale(g, 1.1, 5, minSize=(28, 28)):
        boxes.append((x / s, y / s, w / s, h / s))
# ---- panels: cluster by centre x; two clusters if they sit well apart ----
panels = []
if boxes:
    xs = sorted(b[0] + b[2] / 2 for b in boxes)
    gaps = [(xs[i + 1] - xs[i], i) for i in range(len(xs) - 1)]
    split = None
    if gaps:
        g, i = max(gaps)
        if g > W * 0.22 and 2 <= i + 1 <= len(xs) - 2: split = (xs[i] + xs[i + 1]) / 2
    groups = [[b for b in boxes if (b[0] + b[2] / 2) < split], [b for b in boxes if (b[0] + b[2] / 2) >= split]] if split else [boxes]
    for gb in groups:
        if not gb: continue
        cx = float(np.median([b[0] + b[2] / 2 for b in gb])); cy = float(np.median([b[1] + b[3] / 2 for b in gb]))
        fw = float(np.median([b[2] for b in gb])); fh = float(np.median([b[3] for b in gb]))
        panels.append({"cx": cx, "cy": cy, "faceW": fw, "faceH": fh, "n": len(gb)})
    panels.sort(key=lambda p: p["cx"])
if not panels:
    panels = [{"cx": W / 2, "cy": H / 2, "faceW": W / 6, "faceH": H / 4, "n": 0}]

# ---- who talks from which panel: motion in the lower face while they speak ----
speakers = sorted({w["speaker"] for w in words})
mapping = {}
if len(panels) >= 2 and speakers:
    energy = {s: [0.0] * len(panels) for s in speakers}
    counts = {s: 0 for s in speakers}
    prev = None; prev_t = None
    t = start
    while t < end:
        r = frame_at(t, 480)
        if r is None: break
        f, s = r
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
        spk = next((w["speaker"] for w in words if w["start"] - 0.15 <= t <= w["end"] + 0.15), None)
        if prev is not None and spk is not None:
            d = np.abs(g - prev)
            for pi, p in enumerate(panels):
                x0 = int(max(0, (p["cx"] - p["faceW"] * 0.6) * s)); x1 = int(min(f.shape[1], (p["cx"] + p["faceW"] * 0.6) * s))
                y0 = int(max(0, (p["cy"]) * s)); y1 = int(min(f.shape[0], (p["cy"] + p["faceH"] * 0.9) * s))
                if x1 > x0 and y1 > y0: energy[spk][pi] += float(d[y0:y1, x0:x1].mean())
            counts[spk] += 1
        prev = g; t += 0.25
    for s in speakers:
        e = energy[s]
        mapping[s] = int(np.argmax(e)) if counts[s] else 0
else:
    for s in speakers: mapping[s] = 0

# ---- the timeline: who's on, with a minimum hold so it doesn't flicker ----
timeline = []
for w in words:
    p = mapping.get(w["speaker"], 0)
    if timeline and timeline[-1]["panel"] == p:
        timeline[-1]["end"] = w["end"]
    else:
        timeline.append({"start": w["start"], "end": w["end"], "panel": p})
HOLD = 1.6
merged = []
for seg in timeline:
    if merged and (seg["end"] - seg["start"]) < HOLD:
        merged[-1]["end"] = seg["end"]  # too short to cut to: stay where we are
    else:
        merged.append(dict(seg))
# fill the gaps and pin to the clip's edges, in clip-relative seconds
tl = []
cur = start
for seg in merged:
    tl.append({"start": round(cur - start, 2), "end": round(seg["end"] - start, 2), "panel": seg["panel"]})
    cur = seg["end"]
if tl: tl[-1]["end"] = round(end - start, 2)
else: tl = [{"start": 0, "end": round(end - start, 2), "panel": 0}]
json.dump({"frame": [W, H], "panels": panels, "speakers": mapping, "timeline": tl, "stacked": len(panels) >= 2}, open(out_path, "w"), indent=1)
print(json.dumps({"panels": len(panels), "speakers": mapping, "cuts": len(tl)}))
# OpenCV can leave worker threads that keep the interpreter alive after the
# file is written, so a 34-second clip once sat "running" for an hour and a half.
# The work is done; leave without waiting for them.
import os
sys.stdout.flush()
os._exit(0)
