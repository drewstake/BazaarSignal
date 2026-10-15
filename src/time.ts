// Display fixed EST (UTC−5) year-round, independent of the viewer's timezone.
// This only formats timestamps; stored times and scheduling remain unchanged.
const formatter = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "Etc/GMT+5",
    hour12: true,
  });
const time = formatter({ hour: "numeric", minute: "2-digit" });
const date = formatter({ month: "short", day: "numeric" });
const dateTime = formatter({
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const fullDateTime = formatter({
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export const formatEstTime = (at: number) => `${time.format(at)} EST`;
export const formatEstDate = (at: number) => date.format(at);
export const formatEstDateTime = (at: number) => `${dateTime.format(at)} EST`;
export const formatEstFullDateTime = (at: number) =>
  `${fullDateTime.format(at)} EST`;
