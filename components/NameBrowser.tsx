"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { BrowseName, NameStatus, SortKey } from "@/lib/browse";

const PAGE = 60;
/** Matches the API's cap. Past this, filtering beats scrolling. */
const MAX = 500;

const GENDERS: { key: string; label: string }[] = [
  { key: "girl", label: "Girls" },
  { key: "boy", label: "Boys" },
  { key: "all", label: "Both" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "fit", label: "Best fit" },
  { key: "az", label: "A–Z" },
  { key: "short", label: "Shortest" },
  { key: "long", label: "Longest" },
];

const SYLLABLES = [
  { key: "any", label: "Any length" },
  { key: "1", label: "1 syllable" },
  { key: "2", label: "2 syllables" },
  { key: "3+", label: "3+ syllables" },
];

const ENDINGS = [
  { key: "any", label: "Any ending" },
  { key: "vowel", label: "Ends on a vowel" },
  { key: "vowel-a", label: "Ends in -a" },
  { key: "vowel-o", label: "Ends in -o" },
  { key: "vowel-i", label: "Ends in -i" },
  { key: "consonant", label: "Ends on a consonant" },
  { key: "nasal", label: "Ends on n or m" },
  { key: "liquid", label: "Ends on l or r" },
  { key: "sibilant", label: "Ends on s or z" },
  { key: "stop", label: "Ends on a hard stop" },
];

const FEELS = [
  { key: "any", label: "Any sound" },
  { key: "soft", label: "Soft sounding" },
  { key: "hard", label: "Hard sounding" },
];

/** Short words for what a name ends on, for the row meta line. */
const ENDING_WORD: Record<string, string> = {
  "vowel-a": "ends -a", "vowel-e": "ends -e", "vowel-i": "ends -i",
  "vowel-o": "ends -o", "vowel-u": "ends -u",
  nasal: "ends n/m", liquid: "ends l/r", sibilant: "ends s/z",
  stop: "hard ending", fricative: "ends f/h/th",
};

const STATUS_LABEL: Record<NameStatus, string> = {
  new: "", liked: "On your list", passed: "Passed", queued: "In the deck",
};

interface Filters {
  q: string;
  gender: string;
  sort: SortKey;
  hideSeen: boolean;
  syllables: string;
  ending: string;
  feel: string;
  origin: string;
}

export default function NameBrowser() {
  const params = useSearchParams();

  // One object rather than eight pieces of state, so that changing any filter
  // can reset the page length in the same update — the shortlist's "find more
  // like these" link lands here with sort and hideSeen already chosen.
  const [filters, setFilters] = useState<Filters>(() => ({
    q: "",
    gender: params.get("gender") ?? "all",
    sort: (params.get("sort") as SortKey) ?? "az",
    hideSeen: params.get("hideSeen") === "1",
    syllables: "any",
    ending: "any",
    feel: "any",
    origin: "",
  }));
  const { q, gender, sort, hideSeen, syllables, ending, feel, origin } = filters;

  const [raw, setRaw] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [toast, setToast] = useState<string | null>(null);
  // Names added in this session, so a row updates the moment you tap it.
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());

  function update(patch: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setLimit(PAGE);
  }

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(
      () => setFilters((prev) => (prev.q === raw ? prev : { ...prev, q: raw })),
      250,
    );
    return () => clearTimeout(id);
  }, [raw]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  const key = useMemo(() => {
    const p = new URLSearchParams({
      gender, sort, syllables, ending, feel,
      limit: String(limit),
    });
    if (q) p.set("q", q);
    if (origin) p.set("origin", origin);
    if (hideSeen) p.set("hideSeen", "1");
    return `/api/names?${p}`;
  }, [q, gender, sort, hideSeen, syllables, ending, feel, origin, limit]);

  const { data, isLoading } = useSWR<{
    names: BrowseName[];
    total: number;
    origins: string[];
    hasTaste: boolean;
    likedCount: number;
  }>(key, fetcher, { keepPreviousData: true });

  const names = data?.names ?? [];
  const total = data?.total ?? 0;

  async function add(n: BrowseName) {
    setAdded((prev) => new Set(prev).add(n.name_key));
    navigator.vibrate?.(12);
    try {
      const res = await fetch("/api/liked/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display: n.display,
          gender: n.gender,
          origin: n.origin,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { status: string };
      setToast(
        body.status === "already"
          ? `${n.display} is already on your shortlist`
          : `Added ${n.display}`,
      );
    } catch {
      setAdded((prev) => {
        const next = new Set(prev);
        next.delete(n.name_key);
        return next;
      });
      setToast(`Couldn't add ${n.display}`);
    }
  }

  const selectClass =
    "shrink-0 rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-muted";

  return (
    <main className="flex flex-1 flex-col px-5 pb-3">
      <div className="sticky top-0 z-10 -mx-5 bg-canvas/95 px-5 pt-4 pb-2 backdrop-blur">
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl">All names</h1>
          <span className="shrink-0 text-[13px] text-muted tabular-nums">
            {total.toLocaleString()}
          </span>
        </header>

        <div className="flex items-center gap-2">
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Search names and origins"
            aria-label="Search all names"
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent"
          />
          <select
            value={sort}
            onChange={(e) => update({ sort: e.target.value as SortKey })}
            aria-label="Sort names"
            className={selectClass}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex gap-1 rounded-lg border border-line bg-card p-0.5">
          {GENDERS.map((g) => (
            <button
              key={g.key}
              onClick={() => update({ gender: g.key })}
              aria-pressed={gender === g.key}
              className={`flex-1 rounded-md py-1.5 text-[13px] transition-colors ${
                gender === g.key ? "bg-accent text-card" : "text-muted hover:text-ink"
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>

        {/* Scrolls sideways rather than wrapping into a wall of controls. */}
        <div className="-mx-5 mt-2 flex gap-1.5 overflow-x-auto px-5 pb-0.5">
          <select value={syllables} onChange={(e) => update({ syllables: e.target.value })}
            aria-label="Filter by length" className={selectClass}>
            {SYLLABLES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select value={ending} onChange={(e) => update({ ending: e.target.value })}
            aria-label="Filter by ending" className={selectClass}>
            {ENDINGS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select value={feel} onChange={(e) => update({ feel: e.target.value })}
            aria-label="Filter by sound" className={selectClass}>
            {FEELS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <select value={origin} onChange={(e) => update({ origin: e.target.value })}
            aria-label="Filter by origin" className={selectClass}>
            <option value="">Any origin</option>
            {(data?.origins ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button
            onClick={() => update({ hideSeen: !hideSeen })}
            aria-pressed={hideSeen}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
              hideSeen ? "border-accent text-accent" : "border-line text-muted"
            }`}
          >
            Hide seen
          </button>
        </div>

        {sort === "fit" && data && !data.hasTaste && (
          <p className="mt-2 text-[12px] text-muted">
            Best fit needs a few likes first — showing them alphabetically for now.
          </p>
        )}
      </div>

      {isLoading && !data ? (
        <p className="mt-10 text-center text-sm text-muted">Loading…</p>
      ) : names.length === 0 ? (
        <div className="mt-16 px-6 text-center">
          <p className="font-display text-2xl">Nothing matches</p>
          <p className="mt-2 text-sm text-muted">
            Try widening one of the filters, or clearing the search.
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-1 space-y-1">
            {names.map((n, i) => {
              const status: NameStatus = added.has(n.name_key) ? "liked" : n.status;
              const meta = [
                n.origin,
                `${n.syllables} syl`,
                ENDING_WORD[n.ending],
              ].filter(Boolean).join(" · ");

              return (
                <li
                  key={n.name_key}
                  className="flex items-center gap-2.5 rounded-lg border border-line bg-card px-3 py-2"
                >
                  {sort === "fit" && (
                    <span className="w-5 shrink-0 text-right text-[11px] text-muted tabular-nums">
                      {i + 1}
                    </span>
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[17px] leading-tight">
                      {n.display}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {meta}
                      {/* Which of your names it takes after — the reason it is here. */}
                      {sort === "fit" && n.like && (
                        <span className="text-accent"> · like {n.like}</span>
                      )}
                    </span>
                  </span>

                  {status === "liked" ? (
                    <span className="shrink-0 text-[11px] text-accent">
                      {STATUS_LABEL.liked}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2">
                      {status !== "new" && (
                        <span className="text-[11px] text-muted">
                          {STATUS_LABEL[status]}
                        </span>
                      )}
                      <button
                        onClick={() => add(n)}
                        aria-label={`Add ${n.display} to the shortlist`}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-line text-lg leading-none text-muted transition-colors hover:border-accent hover:text-accent"
                      >
                        +
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {names.length < total && limit < MAX ? (
            <button
              onClick={() => setLimit((n) => Math.min(n + PAGE, MAX))}
              className="mt-3 mb-1 rounded-xl border border-line bg-card py-2.5 text-sm text-muted transition-colors hover:text-ink"
            >
              Show more · {(total - names.length).toLocaleString()} left
            </button>
          ) : names.length < total ? (
            <p className="mt-3 mb-1 text-center text-[12px] text-muted">
              Showing the first {MAX} of {total.toLocaleString()} — search or
              narrow a filter to see the rest.
            </p>
          ) : null}
        </>
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-20 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] text-canvas"
        >
          {toast}
        </div>
      )}
    </main>
  );
}
