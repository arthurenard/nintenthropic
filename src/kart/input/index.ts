/**
 * Grip Prix's input (docs/GRIP_PRIX.md, "Input"): how a player drives. The
 * app builds one DriverControl per local player from these.
 */
export { wheelControl, type WheelControl, type WheelControlOptions } from "./control";
export { gamepadControl } from "./gamepad";
export { keyboardControl } from "./keyboard";
export { MODE_COLOURS, WheelPreview, type PreviewColumn, type PreviewExtras, type PreviewSize, type WheelPreviewOptions } from "./preview";
export { STEERING_LOCK, WHEEL, WheelReader, halfSeat, seatZone, shapeSteer, type Seat, type Steering } from "./wheel";
