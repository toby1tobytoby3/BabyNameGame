"use client";

import { Reorder } from "motion/react";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { Decision } from "@/lib/types";

type SortKey = "manual" | "az" | "gender" | "origin" | "date";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "manual", label: "Your order" },
  { key: "az", label: "A–Z" },
  { key: "gender", label: "Gender" },
  { key: "origin", label: "Origin" },
  { key: "date", label: "Recent" },
];

export default function LikedPage() {
  const { data, mutate, isLoading } = useSWR<{ names: Decision[] }>(
    "/api/liked",
    fetcher,
    { revalidateOnFocus: true },
  );

  const [sort, setSort] = useState<SortKey>("manual");
  // Only holds an in-flight optimistic reorder/removal; otherwise the server
  // list is the single source of truth.
  const [draft, setDraft] = useState<Decision[] | null>(null);
  const { data: prefsData } = useSWR<{
    preferences: { surname: string | null };
  }>("/api/preferences", fetcher);
  const surname = prefsData?.preferences?.surname ?? null;

  const order = useMemo(() => draft ?? data?.names ?? [], [draft, data]);

  // Sorts are *views*. Only manual order is persisted, so dragging is disabled
  // while a sort is applied — otherwise a drop would silently rewrite ranks
  // into whatever the sorted view happened to show.
  const view = useMemo(() => {
    const list = [...order];
    switch (sort) {
      case "az":
        return list.sort((a, b) => a.display.localeCompare(b.display));
      case "gender":
        return list.sort(
          (a, b) =>
            (a.gender ?? "").localeCompare(b.gender ?? "") ||
            a.display.localeCompare(b.display),
        );
      case "origin":
        return list.sort(
          (a, b) =>
            (a.origin ?? "").localeCompare(b.origin ?? "") ||
            a.display.localeCompare(b.display),
        );
      case "date":
        return list.sort((a, b) => b.decided_at.localeCompare(a.decided_at));
      default:
        return list;
    }
  }, [order, sort]);

  async function persistOrder(next: Decision[]) {
    setDraft(next);
    await fetch("/api/liked/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedNameKeys: next.map((n) => n.name_key) }),
    });
    await mutate();
    setDraft(null);
  }

  async function remove(nameKey: string) {
    setDraft(order.filter((n) => n.name_key !== nameKey));
    await fetch("/api/liked/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name_key: nameKey }),
    });
    await mutate();
    setDraft(null);
  }

  return (
    <main className="flex flex-1 flex-col px-5 pt-4 pb-3">
      <header className="mb-3 flex items-baseline justify-between">
        <h1 className="font-display text-3xl">Shortlist</h1>
        <span className="text-[13px] text-muted tabular-nums">
          {order.length}
        </span>
      </header>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSort(s.key)}
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
              sort === s.key
                ? "border-accent text-accent"
                : "border-line text-muted hover:text-ink"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="mt-10 text-center text-sm text-muted">Loading…</p>
      ) : order.length === 0 ? (
        <div className="mt-16 px-6 text-center">
          <p className="font-display text-2xl">Nothing yet</p>
          <p className="mt-2 text-sm text-muted">
            Names you like will collect here, in the order you choose.
          </p>
        </div>
      ) : sort === "manual" ? (
        <Reorder.Group axis="y" values={view} onReorder={persistOrder} className="space-y-2">
          {view.map((n) => (
            <Reorder.Item key={n.name_key} value={n} className="cursor-grab active:cursor-grabbing">
              <Row name={n} surname={surname} onRemove={remove} />
            </Reorder.Item>
          ))}
        </Reorder.Group>
      ) : (
        <>
          <ul className="space-y-2">
            {view.map((n) => (
              <li key={n.name_key}>
                <Row name={n} surname={surname} onRemove={remove} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-center text-[12px] text-muted">
            Switch to “Your order” to drag names around.
          </p>
        </>
      )}
    </main>
  );
}

function Row({
  name,
  surname,
  onRemove,
}: {
  name: Decision;
  surname: string | null;
  onRemove: (k: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-xl">
          {name.display}
          {surname && (
            <span className="ml-2 text-sm font-light text-muted">{surname}</span>
          )}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-muted">
          {name.gender}
          {name.origin ? ` · ${name.origin}` : ""}
        </p>
      </div>
      <button
        onClick={() => onRemove(name.name_key)}
        aria-label={`Remove ${name.display}`}
        className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-muted hover:text-ink"
      >
        Remove
      </button>
    </div>
  );
}
