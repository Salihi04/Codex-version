export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return `${formatDate(value)} · ${formatTime(value)}`;
}

export function isUpcoming(value: string): boolean {
  return new Date(value).getTime() > Date.now();
}
