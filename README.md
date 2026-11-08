# NightcoreMaker — Community Revival (v1.1)

An **unofficial original-code remake** of the old NightcoreMaker.com concept. No recovered original source, branding assets, backend, or archived user songs are included.

## Features

- Upload and decode an audio file in the browser (MP3, WAV, M4A, etc., depending on browser support).
- Classic nightcore conversion: speed **and musical pitch shift together** (0.65x–1.75x), with presets.
- Audio preview, waveform, volume, demo melody, and real PCM **WAV download**.
- Optional server-backed, public latest-creations feed (up to **40 tracks**, automatic expiry after **24 hours**).
- Share only after confirming you hold the public distribution rights. Public uploads contain the **original audio file plus speed metadata**. Visitors hear the nightcore result at the saved speed setting and can export a converted WAV.
- Optional **Classic view** toggle with a simplified nostalgia-inspired layout; not claimed to reproduce archived screenshots.
- Responsive UI with no paid services, API keys, or build system. Node.js server uses **no npm dependencies**.

## Run locally

Install Node.js 20 or newer, unzip the project, and run:

```sh
cd nightcoremaker-revival
npm start
```

Open **http://127.0.0.1:3000** in a browser. No `npm install` needed.

You can also open `public/index.html` directly to try local conversion and WAV download, but community publishing will be unavailable without the server.

For other devices on your local network, set `HOST=0.0.0.0` before starting and use the computer's LAN IP address. **Do not expose the sample server to the public internet without the improvements below.**

## Testing

```sh
npm test
```

## How publishing works

The source track (not an already exported WAV) is uploaded to `/api/tracks` with its saved speed. The server stores it in the `data/` folder, and serves the public `/api/tracks` list. Each entry is automatically deleted after 24 hours or when more than 40 newer tracks take its place. This is a demo-sized implementation; items are cleaned up when requests arrive or when the server restarts (not by a separate clock worker). Metadata persists between restarts.

- 20 MB maximum uploaded source audio.
- 12-minute maximum source audio in the browser.
- 10 attempted uploads/hour/IP in the example server.
- Simple signature checks and randomized filenames.

**Important before public launch:** add verified user accounts or robust abuse controls, admin moderation and reporting tools, DMCA/copyright notice-and-takedown process, TLS, quotas, backups, virus scanning, secure object storage, a privacy policy, accessibility testing, and reliable upload rate limiting behind a trusted proxy. This prototype is not designed to meet these production obligations. Do not upload copyrighted commercial tracks without distribution permission.

## About the reconstruction

The old NightcoreMaker.com existed by 2018 and was mentioned as a simple upload-to-nightcore MP3 converter. A March 2022 Nightcore community comment warned about impending closure. The original HTML/CSS and static assets could not be retrieved in the available session, so the nostalgic look is a **new artistic interpretation**, not a pixel-accurate replica. The public recent-songs gallery, 24-hour lifetime and hosting donations were described by a user who used the original site. No historical claim about the old site's exact code or styling is made.

See `ARCHIVE_RESEARCH.md` and `RECONSTRUCTION_NOTES.md` for historical references, confirmed-vs-remembered features, visual-design limitations and screenshot comparison guidance.

## Repository structure

```text
public/index.html     Website
public/styles.css     Responsive styling
public/app.js         Web Audio converter, WAV download, gallery UI
public/favicon.svg    Original favicon artwork
server.js             Node HTTP server, uploads, 24h gallery
ARCHIVE_RESEARCH.md   Historical evidence vs memories
RECONSTRUCTION_NOTES.md   Archive research and screenshot recovery checklist
LICENSE               MIT license for this new implementation
```
