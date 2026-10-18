"""
Generates the demo narration (one wav per shot) from docs/DEMO_SCRIPT.md with the local, free Kokoro-82M voice.
See docs/VOICE.md for setup. Usage (from the folder holding the model files and a venv with kokoro-onnx):

    python narrate_kokoro.py <voice=af_heart> <speed=1.0>

Reads the script from REPO/docs/DEMO_SCRIPT.md (REPO = parent of this file's folder) and writes ./narr/n<shot>.wav.
"""
import os, re, sys, soundfile as sf
from kokoro_onnx import Kokoro, EspeakConfig
base = os.path.abspath(".venv/lib/python3.12/site-packages/espeakng_loader")
k = Kokoro("kokoro-v1.0.int8.onnx", "voices-v1.0.bin", espeak_config=EspeakConfig(lib_path=base + "/libespeak-ng.dylib", data_path=base))
VOICE = sys.argv[1] if len(sys.argv) > 1 else "af_heart"
SPEED = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
START = {0: 0, 1: 15, 2: 35, 3: 65, 4: 90, 5: 115, 6: 135, 7: 158}; END = 170
def window(n): return (START[n + 1] if n < 7 else END) - START[n] - 0.5
# pronunciation only; the on-screen words are unchanged
SUBS = [("NHTSA", "N H T S A"), ("MCP", "M C P"), ("HTTP", "H T T P"), ("Alexa+'s", "Alexa plus"), ("Alexa+", "Alexa plus")]
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
md = open(os.path.join(REPO, "docs", "DEMO_SCRIPT.md")).read()
os.makedirs("narr", exist_ok=True)
ok = True
for line in md.splitlines():
    m = re.match(r"^\| \*\*(\d)\*\* \|", line)
    if not m: continue
    n = int(m.group(1))
    text = re.sub(r"[*“”\"`]", "", [c.strip() for c in line.strip().strip("|").split("|")][-1])
    for a, b in SUBS: text = text.replace(a, b)
    audio, sr = k.create(text, voice=VOICE, speed=SPEED, lang="en-us")
    dur = len(audio) / sr
    sf.write(f"narr/n{n}.wav", audio, sr)
    flag = "" if dur <= window(n) else "  <-- TOO LONG"
    ok &= dur <= window(n)
    print(f"shot {n}: {dur:5.1f}s in {window(n):4.1f}s window{flag}")
print("ALL FIT" if ok else "SOME TOO LONG")
