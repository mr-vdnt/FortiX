# Adding & Recording Tutorial Videos in FortiX Learning Center

This guide explains how operators and engineering teams record, caption, validate, and publish instructional videos inside **FortiX Learning Center** (`/learning-center`).

---

## 1. Architecture & Supported Video Providers

FortiX Learning Center is intentionally built as a lightweight, security-hardened module inside the existing FortiX Control Plane rather than a standalone streaming platform.

All video sources are validated server-side by `src/learning/video-validator.ts`. Arbitrary `<iframe>` HTML, `javascript:`/`data:` URIs, path traversal sequences, embedded credentials, and private/loopback SSRF hosts are rejected automatically.

| `videoProvider` | Expected `videoReference` Format | Playback Renderer | Notes |
| --- | --- | --- | --- |
| `self_hosted` | `/learning/videos/<slug>.webm` or `.mp4` | Native HTML5 `<video>` | Served from `public/learning/videos/` with HTTP byte-range seeking and `X-Content-Type-Options: nosniff`. |
| `https_allowlist` | `https://<allowed-cdn>/<path>.mp4` or `.webm` | Native HTML5 `<video>` | Origin **must** be listed in `LEARNING_ALLOWED_VIDEO_ORIGINS` (comma-separated HTTPS origins, e.g., S3/CloudFront or Cloudflare R2). |
| `youtube_nocookie` | 11-character ID (e.g., `dQw4w9WgXcQ`) | Sandboxed privacy-enhanced `youtube-nocookie.com` embed | Never pass a full URL or `<iframe>` tag—FortiX constructs the safe embed URL from the validated 11-character video ID. |
| `none` | `null` | Graceful Written-Guide Panel | Displays an honest *"Video recording not yet uploaded"* notice above the live step-by-step FortiX instructions. |

---

## 2. Recommended Recording Standards (3–8 Minute Narrated Walkthroughs)

When recording narrated studio tutorials to replace automated silent UI captures or populate `none` curriculum modules:

1. **Resolution & Aspect Ratio**: Record at `1280×720` (720p) or `1920×1080` (1080p), `16:9` aspect ratio, `30 fps`.
2. **Scope & Length**: Keep each tutorial focused on **one workflow** (`3–8 minutes`). Avoid covering every menu in a single video.
3. **Environment Hygiene**:
   - Use a dedicated demo workspace (`admin@fortix.io` or a fresh test account)—never expose real customer emails, production upstream URLs, or live `ftx_` secret keys that remain active after recording.
   - Confirm the top-right workspace indicator reads `OPERATIONAL` before starting capture.
4. **Encoding Command (`ffmpeg`)**:
   - **WebM (VP9 + Opus, compact web delivery)**:
     ```bash
     ffmpeg -i raw-capture.mov \
       -vf "scale=1280:720" -r 30 \
       -c:v libvpx-vp9 -b:v 900k -crf 32 \
       -c:a libopus -b:a 96k \
       public/learning/videos/my-tutorial-slug.webm
     ```
   - **MP4 (H.264 + AAC, faststart metadata at front of file)**:
     ```bash
     ffmpeg -i raw-capture.mov \
       -vf "scale=1280:720" -r 30 \
       -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
       -c:a aac -b:a 128k -movflags +faststart \
       public/learning/videos/my-tutorial-slug.mp4
     ```
5. **Measure Exact Duration**:
   ```bash
   ffprobe -v error -show_entries format=duration \
     -of default=noprint_wrappers=1:nokey=1 \
     public/learning/videos/my-tutorial-slug.webm
   ```
   Round to the nearest integer second and set `durationSeconds` to that value so the 90% completion threshold and playback scrubber align accurately.

---

## 3. Adding WebVTT Captions (`.vtt`)

Every recorded tutorial should include synchronized English captions stored under `public/learning/captions/<slug>.vtt`:

```vtt
WEBVTT

00:00.000 --> 00:06.500
Open FortiX Security Policies to attach WAF and SSRF controls to your route.

00:06.500 --> 00:14.000
Click Configure Route Policy, select /api/v1/products, and set a 60 RPM quota.
```

FortiX serves `.vtt` files with `Content-Type: text/vtt; charset=utf-8` and renders captions through both the native HTML5 `<track kind="captions">` element and the accessible high-contrast caption overlay (`CC` button or `C` shortcut).

---

## 4. Publishing via the Admin UI or API

### Option A — In-App Admin Tutorial Manager (Recommended)
1. Sign in as an operator with `role = 'ADMIN'`.
2. Open **Learning Center** (`/learning-center`) from the left sidebar.
3. Click **Add Tutorial** (or click the **Edit** pencil icon on an existing curriculum row).
4. Set:
   - **Video Provider**: `self_hosted`
   - **Video Reference**: `/learning/videos/<your-file>.webm`
   - **WebVTT Captions Path**: `/learning/captions/<your-file>.vtt`
   - **Duration (seconds)**: Exact duration of the encoded file
   - **Video Source Disclosure Note**: e.g., `Narrated 5m 20s FortiX workflow capture with English captions.`
   - Check **Published to workspace users** and click **Save Changes**.

### Option B — External CDN Hosting (`https_allowlist`)
1. Upload the `.mp4` or `.webm` asset to your HTTPS object store / CDN (e.g., `https://media.fortix.example.com/tutorials/waf-setup.mp4`).
2. Add the origin to `.env`:
   ```env
   LEARNING_ALLOWED_VIDEO_ORIGINS=https://media.fortix.example.com
   ```
3. Restart the FortiX server and set `videoProvider = "https_allowlist"` with the full HTTPS asset URL.

### Option C — Automated Silent UI Walkthrough Refresh
To regenerate the 5 baseline silent UI walkthrough captures directly from the live running FortiX app on `http://localhost:3000`:
```bash
npx tsx scripts/record-learning-walkthroughs.ts
```
