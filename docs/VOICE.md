# Narration voice (optional, free, local)

The public demo video is narrated with **Kokoro-82M** (voice `af_heart`), an open model that runs locally on the CPU with no account or API key. The model is Apache-2.0; the `kokoro-onnx` wrapper is MIT.

## Reproduce

```bash
mkdir kokoro && cd kokoro
# model files (int8 model ~88 MB, voices ~26 MB)
gh release download model-files-v1.0 -R thewh1teagle/kokoro-onnx -p kokoro-v1.0.int8.onnx -p voices-v1.0.bin -D .
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python kokoro-onnx soundfile
.venv/bin/python ../scripts/narrate_kokoro.py af_heart 1.0     # writes narr/n0.wav ... n7.wav
```

The script prints each clip's length against its time slot in the video and warns if one is too long. It respells a few terms for pronunciation only (NHTSA, MCP, HTTP, "Alexa+"); the on-screen text is unchanged.

Mix the clips into a recording (each clip starts half a second after its shot begins; see `START` in the script):

```bash
ffmpeg -i recordings/recall-radar-demo-captions.mp4 -i narr/n0.wav ... -i narr/n7.wav \
  -filter_complex "[1:a]adelay=500|500[a0];[2:a]adelay=15500|15500[a1];...;[a0][a1]...amix=inputs=8:normalize=0,apad,loudnorm=I=-16:TP=-1.5[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 160k -t 170 recall-radar-demo-voice-captions.mp4
```

## Known issue (macOS, Apple Silicon)
`espeakng-loader` 0.2.x ships a `libespeak-ng.dylib` with the data path of the machine that built it, so synthesis aborts with *"Error processing file '/Users/runner/work/... /phontab'"*. We worked around it in the throwaway environment by (1) symlinking the installed `espeak-ng-data` folder to a short path, (2) replacing that one baked path string in the local copy of the dylib with the short path (padded with NULs), and (3) re-signing it ad hoc (`codesign --force -s -`). Nothing outside the environment is modified, apart from the symlink.

## Credits
Kokoro-82M by hexgrad (Apache-2.0); `kokoro-onnx` by thewh1teagle (MIT); eSpeak NG (GPL-3.0, used as a separate library for phonemes only).
