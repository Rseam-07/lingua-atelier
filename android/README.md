# Lingua Android native Whisper (beta)

This companion runs whisper.cpp **on the same Android phone** as Obsidian.
It requires no computer, Python, Termux or command-line setup for users.

1. Install the beta APK and open **Lingua 本机识别**.
2. Choose multilingual Small Q5_1 (182 MiB), Base Q5_1 (57 MiB), or Tiny Q5_1 (31 MiB).
3. Click Download, then Load. Downloads support resume and SHA-256 verification. An optional, explicitly selected hf-mirror.com source uses the same pinned revision and hashes.
4. Use the ten-second microphone test to see transcription and actual processing time. Audio is saved before recognition; export the Markdown test report if needed.
5. Click **连接 Obsidian** with Lingua Atelier 0.9.0+ enabled. Confirm the text-processing option and complete setup in the plugin. Translation, summaries and maps remain in Obsidian; this APK provides local speech inference and its test screen.

The first build uses native multi-threaded **CPU** inference, with ARM NEON on arm64. GPU / Vulkan / Qualcomm NPU are **not enabled**. Desktop, emulator and synthetic tests are not Xiaomi 17 Pro Max accuracy, battery or thermal benchmarks. Long classes and lock-screen capture need physical-device validation. The phone still needs adequate microphone placement.

## Data and lifecycle

- Models are saved in private app storage and stay resident independently of the Obsidian text worker. Nothing is downloaded until the user clicks Download.
- The visible foreground service listens **only on 127.0.0.1:8179**. Authenticated WAV requests never leave the phone. It does not expose LAN access.
- Pairing starts only from a user click, lasts two minutes and can be consumed once. The URL carries a temporary code, not the durable bearer token. Tokens live in Android private preferences and Obsidian SecretStorage.
- The notification provides a Stop action. Obsidian recording remains a foreground WebView operation; this companion does not add lock-screen microphone recording to Obsidian.
- Test audio and test Markdown remain in this app's private `recordings` directory. Normal classroom recordings and notes remain in the Obsidian vault. Export a test report before uninstalling; uninstalling Android apps removes their private models and test recordings.
- The downloadable APK is a debug-signed test build, not an app-store release. CI builds do not yet have a persistent production signing identity; retain/export test data before replacing builds with different certificates. Production distribution needs the publisher's own signing key in repository secrets, never in source.

## Build and validation

Java 17, Gradle 8.11.1, Android SDK 35, NDK 27.2.12479018 and CMake 3.22.1:

```sh
gradle -p android :app:assembleDebug :app:testDebugUnitTest
```

Both arm64-v8a (phones) and x86_64 (emulator verification) are compiled. The Android workflow runs real Tiny Q5_1 inference twice in one resident JNI context using whisper.cpp's public JFK sample. Unit tests cover malformed WAVs, sample format and one-time pairing. No private classroom audio is included in source or test artifacts.

Upstream: [whisper.cpp 1.8.3](https://github.com/ggml-org/whisper.cpp/tree/v1.8.3), fixed commit `2eeeba56e9edd762b4b38467bab96c2517163158`, MIT. The Android JNI integration follows its documented C API and official Android examples. [NanoHTTPD 2.3.1](https://github.com/NanoHttpd/nanohttpd), BSD-3-Clause. Whisper checkpoints are downloaded from [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp), fixed revision `5359861c739e955e79d9a303bcbc70fb988958b1`.
