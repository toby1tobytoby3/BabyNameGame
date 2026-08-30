"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";

interface Finding {
  id: string;
  claim: string;
  liked: string;
  passed: string;
  z: number;
}

/**
 * What your likes have in common.
 *
 * Renders nothing at all until the server has enough evidence to say something
 * — no placeholder, no "not enough data yet". A card that appears the moment it
 * has something true to say is better than one that sits there empty, and the
 * silence is the honest state rather than a missing feature.
 */
export default function TasteCard() {
  const { data } = useSWR<{
    sample: { liked: number; passed: number };
    findings: Finding[];
  }>("/api/insights", fetcher, { revalidateOnFocus: true });

  const [open, setOpen] = useState(false);

  const findings = data?.findings ?? [];
  if (findings.length === 0) return null;

  const [lead, ...rest] = findings;

  return (
    <section className="mt-2 rounded-xl border border-line bg-card px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[10.5px] font-medium tracking-[0.12em] text-muted uppercase">
          What you seem to like
        </h2>
        <span className="shrink-0 text-[11px] text-muted tabular-nums">
          {data!.sample.liked} liked · {data!.sample.passed} passed
        </span>
      </div>

      <p className="mt-2 font-display text-[19px] leading-snug text-balance">
        {lead.claim}
      </p>
      <p className="mt-1 text-[12px] text-muted tabular-nums">
        {lead.liked} · {lead.passed} passed
      </p>

      {rest.length > 0 && (
        <>
          {open && (
            <ul className="mt-3 space-y-2.5 border-t border-line pt-3">
              {rest.map((f) => (
                <li key={f.id}>
                  <p className="text-[14px] leading-snug">{f.claim}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted tabular-nums">
                    {f.liked} · {f.passed} passed
                  </p>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 text-[12px] text-muted transition-colors hover:text-ink"
          >
            {open ? "Show less" : `${rest.length} more ${rest.length === 1 ? "pattern" : "patterns"}`}
          </button>
        </>
      )}

      <Link
        href="/names?sort=fit&hideSeen=1"
        className="mt-3 flex items-center justify-center rounded-lg bg-accent py-2 text-[13px] text-card"
      >
        Find more like these
      </Link>
    </section>
  );
}
