// Umami custom events (PRD §12). A no-op when the script is blocked or absent. No personal data.

type Props = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Props) => void };
  }
}

export function track(name: string, data?: Props): void {
  try {
    window.umami?.track(name.slice(0, 50), data);
  } catch {
    // analytics must never break the app
  }
}

/** Coordinates are rounded to 0.1° before they are sent. */
export const round1 = (v: number) => Math.round(v * 10) / 10;
