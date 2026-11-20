# Backyard Drill Coach

A soccer training page for kids. The webcam tracks the player and the ball, a blue "ghost" player demonstrates each drill next to them, and touches are counted automatically.

Drills: Toe Taps, Tick-Tocks, Juggling. Timed rounds (30/45/60 s), stars, and a saved best score per drill.

Tracking runs fully in the browser with [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (pose landmarker + EfficientDet "sports ball" detector). No video leaves the computer.

## Run

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765 in Chrome and allow the camera. Place the laptop 2–3 big steps away so the whole body and the ball are visible.
