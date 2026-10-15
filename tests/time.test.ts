import { expect, it } from "vitest";
import {
  formatEstDate,
  formatEstDateTime,
  formatEstFullDateTime,
  formatEstTime,
} from "../src/time";

it.each([
  [
    "2026-07-14T15:03:08Z",
    "Jul 14",
    "10:03 AM EST",
    "Jul 14, 2026, 10:03:08 AM EST",
  ],
  [
    "2026-12-14T15:03:08Z",
    "Dec 14",
    "10:03 AM EST",
    "Dec 14, 2026, 10:03:08 AM EST",
  ],
  [
    "2027-01-01T02:03:08Z",
    "Dec 31",
    "9:03 PM EST",
    "Dec 31, 2026, 9:03:08 PM EST",
  ],
])(
  "formats %s in fixed EST, including daylight saving and date rollover",
  (input, date, time, full) => {
    const at = Date.parse(input);
    expect(formatEstTime(at)).toBe(time);
    expect(formatEstDate(at)).toBe(date);
    expect(formatEstDateTime(at)).toBe(`${date}, ${time}`);
    expect(formatEstFullDateTime(at)).toBe(full);
  },
);
