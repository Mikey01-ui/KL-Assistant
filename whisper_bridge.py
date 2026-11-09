import sys
import os
import io
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

def get_whisper_language():
    # 1. Check environment variable
    env_lang = os.environ.get("WHISPER_LANGUAGE")
    if env_lang:
        return env_lang

    # 2. Check SQLite database setting
    try:
        app_data = os.environ.get("APPDATA")
        if app_data:
            db_path = os.path.join(app_data, "jarvis", "jarvis", "memory.db")
            if os.path.exists(db_path):
                import sqlite3
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                cursor.execute("SELECT value FROM user_profile WHERE key = 'language_mode'")
                row = cursor.fetchone()
                conn.close()
                if row:
                    mode = row[0]
                    if mode == "english":
                        return "en"
                    elif mode == "urdu":
                        return "ur"
    except Exception:
        pass

    # 3. Default to None (auto-detect)
    return None

def transcribe():
    try:
        # Read audio from stdin
        audio_bytes = sys.stdin.buffer.read()
        if not audio_bytes:
            return

        # Convert raw bytes to numpy array using soundfile
        audio_buffer = io.BytesIO(audio_bytes)
        audio_data, sample_rate = sf.read(audio_buffer)
        
        # Convert to float32 (Faster Whisper requirement)
        audio_float = audio_data.astype(np.float32)

        # Load model with cuda if available
        try:
            model = WhisperModel("small", device="cuda", compute_type="float16")
        except Exception:
            model = WhisperModel("small", device="cpu", compute_type="int8")

        # Language selection
        whisper_language = get_whisper_language()

        segments, info = model.transcribe(
            audio_float,
            beam_size=5,
            language=whisper_language,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0
        )
        
        # Combine segments
        transcription = " ".join([segment.text for segment in segments])
        print(transcription.strip())
        
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    # Supress extraneous warnings
    import warnings
    warnings.filterwarnings("ignore")
    
    transcribe()
