# Avatar sticker pipeline

Stickers load from `public/stickers/<avatar_id>/<action>.webp`, or from `$NEXT_PUBLIC_R2_PUBLIC_URL/stickers/<avatar_id>/<action>.webp` when that variable is set.
If a file is missing, the chat shows the built-in clay character instead, so stickers work before any clip is rendered.

- Avatar ids: `cyber_monk`, `street_artist`, `cozy_bear`, `neon_bot`.
- Action names: `peek`, `wave`, `heart_burst`, `laugh`, `angry_stomp`, `sleepy`, `duo_run`, `knock`.

## Export from Blender or Mixamo

Render 2–3 s at 24 fps with a transparent background (Film → Transparent, RGBA PNG), framed square.

## Convert to a looping animated WebP under 200 KB

From a PNG sequence (`frame_0001.png` …):

```bash
ffmpeg -framerate 24 -i frame_%04d.png -vf "fps=15,scale=256:256:flags=lanczos" -c:v libwebp -lossless 0 -q:v 60 -compression_level 6 -loop 0 -an wave.webp
```

From a transparent `.mov` (ProRes 4444 or HEVC with alpha):

```bash
ffmpeg -i wave.mov -vf "fps=15,scale=256:256:flags=lanczos,format=yuva420p" -c:v libwebp -lossless 0 -q:v 60 -compression_level 6 -loop 0 -an wave.webp
```

If the file is over 200 KB, lower `-q:v` (try 45) or `fps` (try 12) first, then the size (try 200).

Copy the file into `public/stickers/<avatar_id>/<action>.webp`, or upload it to R2 at `stickers/<avatar_id>/<action>.webp`.
