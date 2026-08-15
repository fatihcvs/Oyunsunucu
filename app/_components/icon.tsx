import type { ReactNode } from "react";

export type IconName =
  | "activity" | "arrow" | "bell" | "bolt" | "check" | "clock"
  | "close" | "copy" | "cpu" | "database" | "download" | "gamepad"
  | "globe" | "hardDrive" | "headset" | "home" | "layers" | "lock"
  | "menu" | "minus" | "play" | "plus" | "power" | "refresh"
  | "rocket" | "server" | "settings" | "shield" | "spark"
  | "terminal" | "users" | "wallet";

const ICON_SHAPES: Record<IconName, ReactNode> = {
    activity: <path d="M3 12h4l2.5-7 5 14L17 12h4" />,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
    cpu: <><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M19 9h3m-3 6h3M2 9h3m-3 6h3"/></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    gamepad: <><path d="M8 8h8a5 5 0 0 1 4.6 6.9l-1 2.4a2.3 2.3 0 0 1-3.7.8L14 16h-4l-1.9 2.1a2.3 2.3 0 0 1-3.7-.8l-1-2.4A5 5 0 0 1 8 8Z"/><path d="M8 11v4m-2-2h4m6.5-1h.01M18 14h.01"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
    hardDrive: <><path d="M4 6h16l2 7H2l2-7Z"/><path d="M2 13v5h20v-5M17 16h.01"/></>,
    headset: <><path d="M4 14v-2a8 8 0 0 1 16 0v2M18 19c0 1.1-.9 2-2 2h-3"/><path d="M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2v-2Zm16 0a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2v-2Z"/></>,
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
    minus: <path d="M5 12h14"/>,
    play: <path d="m9 7 8 5-8 5V7Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    power: <><path d="M12 2v10"/><path d="M18.4 6.6a8 8 0 1 1-12.8 0"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 10a7 7 0 0 0-12-3L4 11m16 2-2.5 4a7 7 0 0 1-12-3"/></>,
    rocket: <><path d="M14 5c3-3 6-3 6-3s0 3-3 6l-4 4-5-1-1-5 4-4 3 3Z"/><path d="M8 11 4 15m2 2-3 3m10-8-1 5 5-1"/></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6m-6 10h6"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    shield: <><path d="M12 2 4 5v6c0 5 3.4 9.2 8 11 4.6-1.8 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-5"/></>,
    spark: <><path d="m12 3 1.3 4.2L17 9l-3.7 1.8L12 15l-1.3-4.2L7 9l3.7-1.8L12 3Z"/><path d="m5 15 .7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7L5 15Z"/></>,
    terminal: <><path d="m5 7 4 5-4 5"/><path d="M12 17h7"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
    wallet: <><path d="M3 6h16a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2V6Z"/><path d="M3 7V5a2 2 0 0 1 2-2h13v5"/><path d="M16 12h5"/></>,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg aria-hidden="true" className="icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{ICON_SHAPES[name]}</g>
    </svg>
  );
}
