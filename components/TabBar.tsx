"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Swipe" },
  { href: "/liked", label: "Shortlist" },
  { href: "/settings", label: "Settings" },
];

export default function TabBar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav className="sticky bottom-0 z-20 border-t border-line bg-canvas/90 backdrop-blur">
      <ul className="flex">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={`block py-3.5 text-center text-[13px] tracking-wide transition-colors ${
                  active ? "text-accent" : "text-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
