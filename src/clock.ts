/** The clock. Library code reads the time only through one of these. */
export interface Clock {
  now(): Date;
}

/** The production clock: the system time. */
export const systemClock: Clock = { now: () => new Date() };
