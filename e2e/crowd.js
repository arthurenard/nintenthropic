// A camera's picture of 1 to 4 players holding their fists like a wheel, for the tracker's benches (e2e/tracker.html and
// e2e/trackrace.html, ?players=N): each player two fists, the photo of fixtures/hand.jpg (the left one mirrored), as big as
// they are in the game's camera (?fist= says how big, in picture widths), a hand-span and a half apart, turning gently
// the way a wheel does. Each call to the painter draws the next frame.
//
//   ?players=N    1 to 4 players side by side ("seats": ?slots=M with M > N leaves the last seats empty)
//   ?size=WxH     the picture (default: 1280x720, or 1920x1080 for three or four, as the game asks the camera)
//   ?fist=f       a fist's width in picture widths (default: 1/7, 1/10, 1/16, 1/20 for one to four players)

/** A fist's width over the picture's, by players on the camera: one at arm's length, four a metre and a half back. */
const FIST = { 1: 1 / 7, 2: 1 / 10, 3: 1 / 16, 4: 1 / 20 };

export function crowdPainter(canvas, image, params) {
  const players = Math.max(1, Math.min(4, Number(params.get("players"))));
  const slots = Math.max(players, Number(params.get("slots") ?? 0) || players);
  const [w, h] = (params.get("size") ?? (slots >= 3 ? "1920x1080" : "1280x720")).split("x").map(Number);
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d");
  // A room behind them: the photo, blurred and dimmed, stretched across.
  const room = new OffscreenCanvas(w, h);
  const r = room.getContext("2d");
  r.filter = "blur(24px) brightness(0.7)";
  r.drawImage(image, -40, -40, w + 80, h + 80);
  // The photo, so big that its fist is a fist's width (the fist is 250 of its 427 pixels), and its mirror for the other hand.
  const fist = Number(params.get("fist") ?? FIST[slots]) * w;
  const scale = fist / 250;
  let frame = 0;
  return () => {
    context.drawImage(room, 0, 0);
    const t = frame++ / 30;
    for (let i = 0; i < players; i++) {
      const cx = ((i + 0.5) / slots) * w;
      const cy = 0.6 * h;
      const angle = 0.2 * Math.sin(t * 1.3 + i * 1.7);
      const half = 1.75 * fist;
      for (const side of [-1, 1]) {
        context.save();
        context.translate(cx + side * half * Math.cos(angle), cy + side * half * Math.sin(angle));
        context.rotate(angle);
        if (side < 0 && params.get("mirror") !== "0") context.scale(-1, 1);
        context.drawImage(image, (-image.width / 2) * scale, (-image.height / 2) * scale, image.width * scale, image.height * scale);
        context.restore();
      }
    }
  };
}
