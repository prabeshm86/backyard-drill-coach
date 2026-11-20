# Backyard Drill Coach

A soccer training page for kids. The webcam tracks the player and the ball, a blue "ghost" player demonstrates each drill next to them, and touches are counted automatically.

Drills: Toe Taps, Tick-Tocks, Juggling. Timed rounds (30/45/60 s), stars, and a saved best score per drill.

**Ball tracking (body drills):** an AI detector (EfficientDet-Lite2) looks at a zoomed-in crop around the player's feet, then around the ball once found. A color lock follows the ball between AI checks, and a One-Euro filter keeps the ring steady without lag. If "Ball found" stays red, **tap the ball on screen** to lock on. Colored balls are followed by color; white/gray balls by shape (a ball-sized round patch with speckled panels), which can lose the ball when it crosses white socks or shoes, so a bright single-color ball (orange, yellow) tracks best. **Record test clip** saves 15 s of camera video; **Play a clip** (or `?clip=file.webm`) runs the tracker on it. Logic lives in `ball-tracker.js`.

Tracking runs fully in the browser with [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (pose landmarker + EfficientDet "sports ball" detector). No video leaves the computer.

## Target Wall (prototype)

`wall.html` turns a wall into a kick-at-the-targets game, like a one-wall version of an interactive soccer arena.

**Setup:** a projector shows the page on a wall (or a big rebound net with a screen). A webcam stands behind the player, pointed at the wall, and sees the whole projected picture.

1. Open http://localhost:8765/wall.html, mirror the laptop display to the projector, press **Fullscreen**.
2. Press **Calibrate** and click the 4 yellow circles as they appear in the camera picture. This is saved in the browser.
3. Kick the ball at the wall. A cyan dot shows where the camera sees it.
4. Press **Start** (or Space). Hit targets for 100 points, plus up to 100 for speed and 50 for a bullseye. Targets move after 5 seconds.

**How hits are detected:** the ball tracker finds the ball each frame; an impact is when a fast-moving ball reverses, nearly stops, or stops getting smaller. That point is mapped to the wall through the 4-corner calibration.

**Testing without a projector:** click anywhere on the wall to fake a hit.

**Known limits:** a normal 30 fps webcam blurs hard kicks, so soft-to-medium kicks work best. A 60–120 fps camera or a 2D LiDAR sensor would make it reliable for real shots.

## Run

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765 in Chrome and allow the camera. Pick the camera from the camera menu in the app (built-in, USB webcam, or an iPhone via Continuity Camera; turn off Center Stage so it doesn't crop out the feet). The choice is remembered, and Target Wall keeps a separate calibration for each camera. Place the laptop 2–3 big steps away so the whole body and the ball are visible.
