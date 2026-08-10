"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import CardStack from "@/components/CardStack";
import type { Candidate, GenderFilter, Verdict } from "@/lib/types";

const BUFFER_LOW = 10;

interface QueueResponse {
  names: Candidate[];
  exhausted: boolean;
}

const FILTERS: { value: GenderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "girl", label: "Girls" },
  { value: "boy", label: "Boys" },
];

export default function SwipePage() {
  const [gender, setGender] = useState<GenderFilter>("all");
  // Names decided in this session. The server deletes them from the queue, so
  // this only has to cover the window before the next revalidation lands.
  const [decided, setDecided] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [canUndo, setCanUndo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<QueueResponse>(
    `/api/queue?gender=${gender}&limit=40`,
    fetcher,
    { revalidateOnFocus: true, keepPreviousData: true },
  );

  const { data: stats, mutate: refreshStats } = useSWR<{
    liked: number;
    passed: number;
  }>("/api/stats", fetcher, { revalidateOnFocus: true });

  const { data: prefsData } = useSWR<{
    preferences: { surname: string | null };
  }>("/api/preferences", fetcher);
  const surname = prefsData?.preferences?.surname ?? null;

  // Derived, not synced — the queue is server state and stays there.
  const cards = useMemo(
    () => (data?.names ?? []).filter((c) => !decided.has(c.name_key)),
    [data, decided],
  );

  // Refetch before the buffer runs dry. The signature guard stops this looping
  // when the server has fewer names left than the low-water mark.
  const lastSignature = useRef("");
  useEffect(() => {
    if (!data || data.exhausted || cards.length >= BUFFER_LOW) return;
    const signature = data.names.map((n) => n.name_key).join(",");
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    void mutate();
  }, [cards.length, data, mutate]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const handleDecide = useCallback(
    (candidate: Candidate, verdict: Verdict) => {
      // Optimistic: the card is gone the instant you swipe.
      setDecided((prev) => new Set(prev).add(candidate.name_key));
      setCanUndo(true);

      void (async () => {
        try {
          const res = await fetch("/api/decide", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ candidate, verdict }),
          });
          if (!res.ok) throw new Error(String(res.status));
          void refreshStats();
        } catch {
          // Put it back rather than silently losing the decision.
          setDecided((prev) => {
            const next = new Set(prev);
            next.delete(candidate.name_key);
            return next;
          });
          setCanUndo(false);
          setToast(`Couldn't save ${candidate.display} — put it back`);
        }
      })();
    },
    [refreshStats],
  );

  const handleUndo = useCallback(() => {
    setCanUndo(false);
    void (async () => {
      try {
        const res = await fetch("/api/decide/undo", { method: "POST" });
        const body = (await res.json()) as { restored: Candidate | null };
        if (!body.restored) return;
        // The server puts it back at the head of the queue; drop our local
        // tombstone and let the refetch surface it.
        setDecided((prev) => {
          const next = new Set(prev);
          next.delete(body.restored!.name_key);
          return next;
        });
        await mutate();
        void refreshStats();
      } catch {
        setToast("Couldn't undo");
      }
    })();
  }, [mutate, refreshStats]);

  const showLoading = isLoading && !data;

  return (
    <main className="flex flex-1 flex-col px-5 pt-4 pb-3">
      <header className="mb-4 flex items-center justify-between">
        <p className="text-[13px] text-muted tabular-nums">
          {stats ? `${stats.liked} liked · ${stats.passed} seen` : " "}
        </p>
        <div className="flex gap-1 rounded-lg border border-line bg-card p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setGender(f.value)}
              className={`rounded-md px-2.5 py-1 text-[12px] transition-colors ${
                gender === f.value
                  ? "bg-accent text-card"
                  : "text-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {showLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted">Finding names…</p>
        </div>
      ) : error && !data ? (
        // Distinct from the empty state below. An outage must not read as
        // "you've seen every name we have".
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="font-display text-2xl">Can&rsquo;t reach the names</p>
          <p className="mt-2 text-sm text-muted">
            Something went wrong on our side — your shortlist is safe.
          </p>
          <button
            onClick={() => void mutate()}
            className="mt-6 rounded-xl bg-accent px-5 py-3 text-sm text-card"
          >
            Try again
          </button>
        </div>
      ) : cards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="font-display text-2xl">That&rsquo;s everything for now</p>
          <p className="mt-2 text-sm text-muted">
            We&rsquo;ve run out of fresh names to show you. Check back later, or
            widen your origins in Settings.
          </p>
          {canUndo && (
            <button
              onClick={handleUndo}
              className="mt-6 rounded-xl border border-line bg-card px-5 py-3 text-sm text-muted"
            >
              Undo last swipe
            </button>
          )}
        </div>
      ) : (
        <CardStack
          cards={cards}
          surname={surname}
          onDecide={handleDecide}
          onUndo={handleUndo}
          canUndo={canUndo}
        />
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
