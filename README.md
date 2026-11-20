# Backyard Drill Coach

A soccer training page for kids. The webcam tracks the player and the ball, a blue "ghost" player demonstrates each drill next to them, and touches are counted automatically.

Drills: Toe Taps, Tick-Tocks, Juggling. Timed rounds (30/45/60 s), stars, and a saved best score per drill.

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

Then open http://localhost:8765 in Chrome and allow the camera. Place the laptop 2–3 big steps away so the whole body and the ball are visible.
