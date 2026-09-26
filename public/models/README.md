# Hand and face models

MediaPipe model bundles (Apache-2.0, Google), served as they are:

- `hand_landmarker.task` — the hand landmarker (a palm detector and a
  21-point hand model). It is the lighter half of the desktop's
  `gesture_recognizer.task`, which bundles it with a gesture classifier Handy
  does not use.
- `face_landmarker.task` — the face landmarker, for the games that read an
  eye (Overwatch Ridge's scope).

Both are the 0.10-era bundles the desktop app cached; they load unchanged in
`@mediapipe/tasks-vision` 1.0.
