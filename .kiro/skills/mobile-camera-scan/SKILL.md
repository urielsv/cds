---
name: mobile-camera-scan
description: Use when implementing or debugging barcode scanning, camera capture, getUserMedia, or the SKU/EAN/UPC reader in MyCDs — especially when scanning fails on iPhone or iOS Safari, when the camera preview is black, or when deciding between the native BarcodeDetector API and a WebAssembly decoder.
---

# Barcode scanning that works on an iPhone

## Do not trust the native API

The obvious implementation is the [Barcode Detection
API](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API).
Do not build on it as the primary path. WebKit's implementation has been broken
since iOS 18 ([WebKit bug 281848](https://bugs.webkit.org/show_bug.cgi?id=281848)),
and this app is used mainly from iPhones.

Critically, `'BarcodeDetector' in window` can be **true** while detection never
returns a result. A feature check alone yields a scanner that shows a camera feed
and silently never scans — the worst possible failure, because it looks like it is
working.

So:

- **Primary path: `zxing-wasm`.** Works across WebKit, Blink and Gecko.
- Native `BarcodeDetector` only as an opportunistic fast path, and only after a
  runtime self-test: decode a known barcode image at startup and confirm the
  expected value comes back. If the self-test fails or times out, fall back to WASM
  permanently for that session.

## Formats

Restrict the decoder to what appears on a CD case: EAN-13, UPC-A, EAN-8, and
ITF-14 for outer packaging. Scanning for every supported symbology is markedly
slower per frame, and speed is what makes scanning feel good.

## Camera setup

Request the rear camera and a resolution high enough to resolve bars, but no
higher — oversized frames cost decode time:

```ts
await navigator.mediaDevices.getUserMedia({
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
  audio: false,
});
```

Requirements and gotchas:

- **Secure context required.** `https` or `localhost`. A LAN IP over plain HTTP
  will not get camera access, which is the usual reason "it works on my laptop but
  not on my phone".
- On iOS the video element needs `playsInline` and `muted`, or it will try to go
  fullscreen or refuse to play. A black preview on iPhone is almost always this.
- `getUserMedia` must be triggered by a user gesture. Do not request the camera on
  page load; put it behind a "Scan" button.
- Always stop every track when the scanner closes, on unmount, and when the page is
  hidden. A camera light left on is both a bug and a privacy problem. Listen for
  `visibilitychange`.

## Decode loop

Do not decode every frame. Sample at a fixed interval — a few times a second is
plenty and leaves the main thread free. Drive it from
`requestVideoFrameCallback` where available, falling back to a timer, and skip a
tick if the previous decode has not finished.

Downscale the frame and, if the guide box is a fixed region, crop to it before
decoding. Less pixel data is faster and more accurate.

Require the **same value from two consecutive successful decodes** before
accepting it. Single-frame reads produce transposed digits on glossy jewel cases.
Then stop the camera immediately and hand off — leaving it running while the
network request happens wastes battery and invites a duplicate scan.

## Feedback

Scanning is a physical act and needs to feel responsive:

- Show the live preview with a clear guide box. Do not hide the camera behind an
  overlay.
- On a successful read: `navigator.vibrate()` where supported, a brief visual
  confirmation, and the decoded digits shown as text so the user can sanity-check
  them.
- Do not animate a "scanning" indicator that implies progress toward a known end.
  There is no progress; there is only found or not found.

## Always provide a way out

The camera is a convenience and it will fail — scratched barcode, no barcode at
all, a promo disc, bad light, a denied permission. Every one of these must have a
route forward:

- **Manual entry.** A numeric field that takes the digits directly. This is the
  true fallback and must always be present, not buried.
- **Decode from a still photo.** `<input type="file" accept="image/*" capture>`
  then run the same decoder over the image. This often succeeds where the live
  feed struggles, because the user can steady the shot.
- **Name search.** Skip the barcode entirely.

If permission is denied, say what happened and how to undo it, and move straight
to manual entry. Never leave the user on a dead screen. Do not re-prompt for
permission in a loop.

## Testing

- Unit-test the decode-and-confirm logic with fixture images; no camera needed.
- The camera path needs a real device on HTTPS. A desktop browser with a webcam
  does not exercise the iOS bugs that matter here.
- Test with a genuinely scratched or glossy case, and in poor light.

## Checklist

- [ ] `zxing-wasm` is the primary decoder
- [ ] Native API gated behind a runtime self-test, not a feature check
- [ ] Formats limited to CD-relevant symbologies
- [ ] `playsInline` + `muted` on the video element
- [ ] Camera requested from a user gesture, in a secure context
- [ ] Tracks stopped on close, unmount and `visibilitychange`
- [ ] Decode throttled, frames cropped/downscaled
- [ ] Two consecutive matching reads required
- [ ] Haptic + visual + textual confirmation
- [ ] Manual entry, photo decode and name search all reachable
