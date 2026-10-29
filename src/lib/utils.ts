import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(ms: number, withMs = true) {
  const neg = ms < 0;
  const t = Math.abs(ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  const base = `${neg ? "-" : ""}${m}:${String(s).padStart(2, "0")}`;
  return withMs ? `${base}.${String(cs).padStart(2, "0")}` : base;
}
