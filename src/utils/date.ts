export function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}
