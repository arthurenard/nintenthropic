/**
 * The kitchen's wall clock tells the time: the real time, on the player's
 * own clock. The hands' angles are a pure function of a Date, so they are
 * tested with made-up ones.
 */

const TAU = Math.PI * 2;

/** The hands' angles in radians, clockwise from twelve. */
export interface ClockAngles {
  hour: number;
  minute: number;
  second: number;
}

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** Where the hands stand at `date`: the hour hand creeps with the minutes, the second hand ticks once a second with a quick settle. */
export function clockAngles(date: Date): ClockAngles {
  const seconds = date.getSeconds() + date.getMilliseconds() / 1000;
  const minutes = date.getMinutes() + seconds / 60;
  const hours = (date.getHours() % 12) + minutes / 60;
  const whole = Math.floor(seconds);
  // It sits on the second that has just struck, having come from the one before in the first moments of it.
  const ticked = whole - 1 + smooth((seconds - whole) / 0.14);
  return { hour: (hours / 12) * TAU, minute: (minutes / 60) * TAU, second: (ticked / 60) * TAU };
}
