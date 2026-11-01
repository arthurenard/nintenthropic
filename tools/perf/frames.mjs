// Counts the VideoFrames a page leaves open: the camera's frames cut for the tracking workers (src/tracking/tracker.ts) must
// each be closed by the worker that is handed it, or the camera stalls after a handful (a frame garbage collected unclosed is
// only a console warning, once the collector gets to it: too late and too rare to count on).
//
//   const frames = await watchFrames(page);       before page.goto
//   ... the page runs ...
//   console.log(await frames.open());              frames left open
//
// On the page, every VideoFrame made is remembered, and the ones neither closed nor handed to a worker (a handed frame is
// detached, its format gone) are counted at the end. In each worker, every frame it is handed is looked at once the message
// has been dealt with (the reading is synchronous): one still open is counted. Checked against a worker that leaves its frames
// open (a few hundred counted, none without).

export async function watchFrames(page) {
  await page.addInitScript(() => {
    const Original = window.VideoFrame;
    if (!Original) return;
    const made = [];
    window.VideoFrame = class extends Original {
      constructor(...args) {
        super(...args);
        made.push(this);
      }
    };
    window.__openFrames = () => made.filter((frame) => frame.format !== null).length;
  });
  let inWorkers = 0;
  page.on("console", (message) => {
    if (message.text() === "open-videoframe") inWorkers++;
  });
  page.on("worker", (worker) => {
    worker.on("console", (message) => {
      if (message.text() === "open-videoframe") inWorkers++;
    });
    // The listener is added before the worker's own handler is set; its check waits for the handler to be done.
    void worker
      .evaluate(() => {
        self.addEventListener("message", (event) => {
          const image = event.data && event.data.image;
          if (!image || !("format" in image)) return;
          setTimeout(() => {
            if (image.format !== null) console.log("open-videoframe");
          }, 0);
        });
      })
      .catch(() => {});
  });
  return {
    async open() {
      const here = await page.evaluate(() => (window.__openFrames ? window.__openFrames() : 0)).catch(() => 0);
      return here + inWorkers;
    },
  };
}
