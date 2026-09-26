/** The tracker's own failure, kept apart from MediaPipe so the first screen need not load it. */
export class ModelError extends Error {
  constructor(cause?: unknown) {
    super("the hand model did not load");
    this.name = "ModelError";
    this.cause = cause;
  }
}
