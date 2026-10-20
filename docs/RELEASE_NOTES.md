Lingua Atelier 0.7.0 public beta

- Foreign-language learning workspace, currently supporting Chinese, English and French: recording, bilingual captions, grounded notes, Markmap, Markdown, SRT and Canvas.
- Removed developer-machine paths; shared plugin bundle can load without Node on mobile.
- Optional desktop setup: Apple Silicon / MLX; experimental Windows x64 and Intel / Transformers.
- Phone/tablet can connect to a user-owned authenticated speech service. Per-install connection token; separate sharing port.
- Explicit installers, pinned model revisions and UV checksums. No bundled keys, private notes, recordings or weights.
- API credentials stored in Obsidian SecretStorage. Each user configures their own text provider.

Status: Mac prototype tested; Windows and mobile hardware acceptance is still pending. Mobile background and lock-screen recording, CPU realtime latency, and automatic transcription accuracy are not guaranteed. Desktop speech dependencies must be installed separately; Obsidian/BRAT only install the plugin files.

See README and QUICKSTART before installing. This is an Obsidian plugin, not a standalone mobile app or a shared editing service.
