import json, os, sys
from faster_whisper import WhisperModel

audio_path, model_path = sys.argv[1], sys.argv[2]
if not os.path.isdir(model_path):
    print(json.dumps({"error": "本地 Whisper 模型尚未下载"}, ensure_ascii=False))
    raise SystemExit(2)
model = WhisperModel(model_path, device="cpu", compute_type="int8")
segments, info = model.transcribe(audio_path, language="zh", vad_filter=True, beam_size=3)
text = "".join(segment.text for segment in segments).strip()
print(json.dumps({"text": text, "language": info.language}, ensure_ascii=False))
