// Minimal stroke icons for the bottom navigation. Kept plain and consistent.
const common = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function MapIcon() {
  return (
    <svg {...common}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </svg>
  );
}

export function ChartIcon() {
  return (
    <svg {...common}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M20 20H3" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg {...common}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RouteIcon() {
  return (
    <svg {...common}>
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 19h6a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h6" />
    </svg>
  );
}

export function BookIcon() {
  return (
    <svg {...common}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}

export function GearIcon() {
  // A real cog (toothed ring), not spokes — spokes read as a sun.
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Small inline icons that replace emoji used as controls: without a colour
// emoji font (Windows browsers, minimal Linux) the emoji drew as nothing.
// `size` in CSS pixels; each inherits the text colour.

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size} strokeWidth={2.2}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.4-4.4" />
    </svg>
  );
}

export function StarIcon({ size = 15 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size} fill="currentColor" strokeWidth={1.2}>
      <path d="M12 3.2 14.7 8.8l6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
    </svg>
  );
}

export function CityIcon({ size = 15 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size} strokeWidth={2}>
      <path d="M3 21h18" />
      <path d="M5 21V8l6-3.5V21" />
      <path d="M11 10.5h8V21" />
      <path d="M8 10v.01M8 14v.01M15 14v.01M15 17.5v.01" />
    </svg>
  );
}

export function MonumentIcon({ size = 15 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size} strokeWidth={2}>
      <path d="M12 3 3.5 8h17Z" />
      <path d="M6 11v6M10 11v6M14 11v6M18 11v6" />
      <path d="M4 20.5h16" />
    </svg>
  );
}

export function PlaneIcon({ size = 15 }: { size?: number }) {
  return (
    <svg {...common} width={size} height={size} fill="currentColor" strokeWidth={1}>
      <path d="M12 2.5c.9 0 1.4 1 1.4 2.4v4.5l7.1 4.2v2l-7.1-2.2v4.3l2 1.5v1.6L12 19.8l-3.4 1v-1.6l2-1.5v-4.3l-7.1 2.2v-2l7.1-4.2V4.9c0-1.4.5-2.4 1.4-2.4Z" />
    </svg>
  );
}
