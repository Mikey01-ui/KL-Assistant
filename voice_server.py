import sys
import os
import time
import threading
import warnings

# ── Suppress noisy HF / ctranslate2 warnings ──────────────────────
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
warnings.filterwarnings("ignore")

import logging
logging.getLogger("faster_whisper").setLevel(logging.ERROR)
logging.getLogger("ctranslate2").setLevel(logging.ERROR)
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

import pyaudio
from RealtimeSTT import AudioToTextRecorder
import torch
import atexit

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

# Global event for controlling listening state
is_listening = threading.Event()
recorder_instance = None

def stdin_thread():
    global recorder_instance
    for line in sys.stdin:
        cmd = line.strip().upper()
        if cmd == "START":
            is_listening.set()
            print("STATUS:listening", flush=True)
        elif cmd == "STOP":
            is_listening.clear()
            if recorder_instance and hasattr(recorder_instance, 'is_recording') and recorder_instance.is_recording:
                try:
                    recorder_instance.stop()
                except Exception:
                    pass
            print("STATUS:ready", flush=True)
        elif cmd in ("EXIT", "QUIT"):
            os._exit(0)

def main():
    global recorder_instance
    print("STATUS:initializing", flush=True)

    try:
        device_index = None
        
        # Verify microphone availability using PyAudio
        try:
            p = pyaudio.PyAudio()
            try:
                try:
                    default_device = p.get_default_input_device_info()
                    device_name = default_device.get('name', 'Default Microphone')
                    print(f"STATUS:using_device_{device_name}", flush=True)
                except IOError:
                    device_count = p.get_device_count()
                    input_device_indices = [i for i in range(device_count) if p.get_device_info_by_index(i).get('maxInputChannels', 0) > 0]
                    if not input_device_indices:
                        print("STATUS:error_no_microphone", flush=True)
                        sys.exit(1)
                    else:
                        device_index = input_device_indices[0]
                        device_info = p.get_device_info_by_index(device_index)
                        device_name = device_info.get('name', f'Device #{device_index}')
                        print(f"STATUS:using_device_{device_name}", flush=True)
            finally:
                p.terminate()
        except Exception as e:
            print(f"STATUS:error_checking_devices {str(e)}", flush=True)

        # ── Detect CUDA availability ──────────────────────────────
        if torch.cuda.is_available():
            device = "cuda"
            compute_type = "float16"
            print(f"STATUS:gpu_detected_{torch.cuda.get_device_name(0)}", flush=True)
        else:
            device = "cpu"
            compute_type = "int8"
            print("STATUS:gpu_not_available_using_cpu", flush=True)

        def on_rec_start():
            if is_listening.is_set():
                print("STATUS:recording", flush=True)

        def on_rec_stop():
            if is_listening.is_set():
                print("STATUS:processing", flush=True)

        recorder_config = {
            "model": "tiny",
            "language": get_whisper_language(),
            "device": device,
            "compute_type": compute_type,
            "silero_sensitivity": 0.4,
            "post_speech_silence_duration": 0.6,
            "min_length_of_recording": 0.4,
            "min_gap_between_recordings": 0.3,
            "pre_recording_buffer_duration": 0.5,
            "on_recording_start": on_rec_start,
            "on_recording_stop": on_rec_stop,
            "spinner": False,
            "use_extended_logging": False
        }
        if device_index is not None:
            recorder_config["input_device_index"] = device_index

        recorder = AudioToTextRecorder(**recorder_config)
        recorder_instance = recorder

        def cleanup():
            try:
                recorder.shutdown()
            except Exception:
                pass
        atexit.register(cleanup)

        # Start stdin listener thread
        st = threading.Thread(target=stdin_thread, daemon=True)
        st.start()

        print("STATUS:ready", flush=True)

        while True:
            try:
                if not is_listening.is_set():
                    time.sleep(0.05)
                    continue

                text = recorder.text()
                if text:
                    trimmed = text.strip()
                    if trimmed:
                        print(f"TEXT:{trimmed}", flush=True)
                        if is_listening.is_set():
                            print("STATUS:listening", flush=True)
            except Exception as e:
                print(f"STATUS:error {str(e)}", flush=True)
                time.sleep(1)

    except Exception as e:
        print(f"STATUS:error {str(e)}", flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
