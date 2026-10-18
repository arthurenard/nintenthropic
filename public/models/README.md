# Hand and face models

MediaPipe model bundles (Apache-2.0, by Google), served as they are:

- `hand_landmarker.task` — the [hand
  landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker):
  a palm detector and a 21-point hand model.
- `face_landmarker.task` — the [face
  landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker),
  for the one game that reads an eye (Overwatch Ridge's scope).

Both are MediaPipe's 0.10-era bundles; they load unchanged in
`@mediapipe/tasks-vision` 1.0.
