export function formatDate(d) {
  return `${pad(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${pad(formatTimezone(d.getTimezoneOffset()))}`;
}

function formatTimezone(tz) {
  if (tz == 0) return 'Z';
  const abs = Math.abs(tz);
  return `${tz < 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function pad(s) {
  return s.toString().padStart(2, '0');
}

export function now() {
  return formatDate(new Date());
}

export const noopLogger = new Proxy({}, {
  get() {
    return () => { };
  },
});
