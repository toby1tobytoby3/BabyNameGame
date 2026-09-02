"use client";

import { Reorder, useDragControls } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import AddNameForm from "@/components/AddNameForm";
import ShortlistRow from "@/components/ShortlistRow";
import TasteCard from "@/components/TasteCard";
import { fetcher } from "@/lib/fetcher";
import type { AddResult } from "@/lib/queue";
import { MAX_HEARTS, type Decision } from "@/lib/types";

/**
 * Boys and girls are separate lists, not one list sorted by gender — the
 * shortlist is only useful when you can see the six names actually in the
 * running for one baby. "Both" stays available for a combined read.
 *
 * Neutral names appear under *both* Girls and Boys, matching how the swipe
 * queue serves them; a name you'd use either way belongs in either list.
 */
type Tab = "girl" | "boy" | "all";
type SortKey = "manual" | "az" | "origin" | "date";

const TABS: { key: Tab; label: string }[] = [
  { key: "girl", label: "Girls" },
  { key: "boy", label: "Boys" },
  { key: "all", label: "Both" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "manual", label: "Your order" },
  { key: "az", label: "A–Z" },
  { key: "origin", label: "Origin" },
  { key: "date", label: "Recent" },
];

const SEARCH_FROM = 8;
const JSON_HEADERS = { "content-type": "application/json" };

function inTab(n: Decision, tab: Tab) {
  return tab === "all" || n.gender === tab || n.gender === "neutral";
}

export default function LikedPage() {
  const { data, mutate, isLoading } = useSWR<{ names: Decision[] }>(
    "/api/liked",
    fetcher,
    { revalidateOnFocus: true },
  );
  const { data: prefsData } = useSWR<{
    preferences: { surname: string | null };
    availableOrigins: string[];
  }>("/api/preferences", fetcher);
  const surname = prefsData?.preferences?.surname ?? null;

  // null until you pick a tab yourself; see `tab` below.
  const [chosenTab, setChosenTab] = useState<Tab | null>(null);
  const [sort, setSort] = useState<SortKey>("manual");
  const [query, setQuery] = useState("");
  const [showSurname, setShowSurname] = useState(false);
  const [adding, setAdding] = useState(false);
  // Holds an in-flight optimistic edit (reorder, heart, removal); otherwise the
  // server list is the single source of truth.
  const [draft, setDraft] = useState<Decision[] | null>(null);
  const [toast, setToast] = useState<{
    text: string;
    undo?: () => void;
  } | null>(null);

  const all = useMemo(() => draft ?? data?.names ?? [], [draft, data]);

  const counts = useMemo(
    () => ({
      girl: all.filter((n) => inTab(n, "girl")).length,
      boy: all.filter((n) => inTab(n, "boy")).length,
      all: all.length,
    }),
    [all],
  );

  // Landing on an empty list while the other one is full reads as data loss, so
  // until you choose a tab yourself the first non-empty one is shown.
  const tab: Tab =
    chosenTab ?? (counts.girl > 0 ? "girl" : counts.boy > 0 ? "boy" : "all");

  const inScope = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (n) =>
        inTab(n, tab) &&
        (!q ||
          n.display.toLowerCase().includes(q) ||
          (n.origin ?? "").toLowerCase().includes(q)),
    );
  }, [all, tab, query]);

  // Sorts are *views*. Only manual order is persisted, so dragging is off while
  // a sort or a search is applied — otherwise a drop would silently rewrite
  // ranks into whatever the filtered view happened to show.
  const view = useMemo(() => {
    const list = [...inScope];
    switch (sort) {
      case "az":
        return list.sort((a, b) => a.display.localeCompare(b.display));
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
  }, [inScope, sort]);

  const canDrag = sort === "manual" && query.trim() === "";

  /**
   * Show the change immediately, save it, then fall back to the server.
   *
   * The counter matters: two quick gestures overlap, and clearing the draft
   * when the *first* request lands would snap the list back to a server state
   * that doesn't know about the second yet.
   */
  const pending = useRef(0);
  const commit = useCallback(
    async (next: Decision[], send: () => Promise<Response>, failed: string) => {
      setDraft(next);
      pending.current += 1;
      try {
        try {
          const res = await send();
          if (!res.ok) throw new Error(String(res.status));
        } catch {
          setToast({ text: failed });
        }
        // A failed revalidation must still release the draft, or the list stays
        // frozen on an optimistic state nothing will ever replace.
        await mutate().catch(() => undefined);
      } finally {
        pending.current -= 1;
        if (pending.current === 0) setDraft(null);
      }
    },
    [mutate],
  );

  // Dragging reorders the *visible* list, which may be one gender's slice of
  // the shortlist. Drop the new order back into the slots those names occupied
  // in the full list so the other gender's ranks are untouched.
  const handleReorder = useCallback(
    (nextView: Decision[]) => {
      const moved = new Set(nextView.map((n) => n.name_key));
      let i = 0;
      setDraft(all.map((n) => (moved.has(n.name_key) ? nextView[i++] : n)));
    },
    [all],
  );

  // Reorder.Group fires onReorder on every swap mid-drag; saving is deferred to
  // the drop so one drag is one request.
  const commitOrder = useCallback(() => {
    if (!draft) return;
    const order = draft;
    void commit(
      order,
      () =>
        fetch("/api/liked/reorder", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            orderedNameKeys: order.map((n) => n.name_key),
          }),
        }),
      "Couldn't save that order",
    );
  }, [draft, commit]);

  const restore = useCallback(
    (n: Decision) => {
      setToast(null);
      void commit(
        // Filter first: `all` is captured from the render that built the toast,
        // which was still holding the name this undo puts back.
        [...all.filter((x) => x.name_key !== n.name_key), n],
        () =>
          fetch("/api/liked/restore", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ name_key: n.name_key, rank: n.rank }),
          }),
        `Couldn't bring ${n.display} back`,
      );
    },
    [all, commit],
  );

  const remove = useCallback(
    (n: Decision) => {
      setToast({ text: `Removed ${n.display}`, undo: () => restore(n) });
      void commit(
        all.filter((x) => x.name_key !== n.name_key),
        () =>
          fetch("/api/liked/remove", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ name_key: n.name_key }),
          }),
        `Couldn't remove ${n.display}`,
      );
    },
    [all, commit, restore],
  );

  // Double-tap cycles 0 → 1 → 2 → 3 → 0, so a mis-tap is three taps from undone
  // rather than stuck. Gaining a heart floats the name to the top; the server
  // does the same, so the optimistic list and the refetch agree.
  const heart = useCallback(
    (n: Decision) => {
      const hearts = (n.hearts + 1) % (MAX_HEARTS + 1);
      const updated = { ...n, hearts };
      const next =
        hearts > 0
          ? [updated, ...all.filter((x) => x.name_key !== n.name_key)]
          : all.map((x) => (x.name_key === n.name_key ? updated : x));
      navigator.vibrate?.(hearts > 0 ? 12 : [6, 40, 6]);
      void commit(
        next,
        () =>
          fetch("/api/liked/hearts", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ name_key: n.name_key, hearts }),
          }),
        `Couldn't save that heart`,
      );
    },
    [all, commit],
  );

  const handleAdded = useCallback(
    ({ status, name }: AddResult) => {
      setAdding(false);
      // Land on the list the name actually went into, with nothing filtering it
      // out — it was just added to the top and should be the first thing seen.
      // A neutral name is already in whichever list is open.
      if (name.gender !== "neutral") setChosenTab(name.gender);
      setQuery("");
      setSort("manual");
      setToast({
        text:
          status === "already"
            ? `${name.display} is already on your shortlist`
            : status === "restored"
              ? `${name.display} is back on your shortlist`
              : `Added ${name.display}`,
      });
      void mutate();
    },
    [mutate],
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.undo ? 6000 : 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const rowProps = (n: Decision, i: number) => ({
    name: n,
    surname,
    showSurname,
    position: i + 1,
    showGender: tab === "all",
    onHeart: () => heart(n),
    onRemove: () => remove(n),
  });

  return (
    <main className="flex flex-1 flex-col px-5 pb-3">
      <div className="sticky top-0 z-10 -mx-5 bg-canvas/95 px-5 pt-4 pb-2 backdrop-blur">
        <header className="mb-3 flex items-center justify-between gap-3">
          <h1 className="font-display text-3xl">Shortlist</h1>
          <div className="flex shrink-0 items-center gap-3">
            {surname && (
              <button
                onClick={() => setShowSurname((v) => !v)}
                className="text-[12px] text-muted transition-colors hover:text-ink"
              >
                {showSurname ? "Hide surname" : "Show surname"}
              </button>
            )}
            <button
              onClick={() => setAdding((v) => !v)}
              aria-expanded={adding}
              aria-label={adding ? "Close add a name" : "Add a name"}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xl leading-none text-card"
            >
              {adding ? "×" : "+"}
            </button>
          </div>
        </header>

        <div className="flex gap-1 rounded-lg border border-line bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setChosenTab(t.key)}
              aria-pressed={tab === t.key}
              className={`flex-1 rounded-md py-1.5 text-[13px] transition-colors ${
                tab === t.key
                  ? "bg-accent text-card"
                  : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-[11px] tabular-nums opacity-70">
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>

        {all.length >= SEARCH_FROM && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search names"
              aria-label="Search the shortlist"
              className="min-w-0 flex-1 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] outline-none placeholder:text-muted focus:border-accent"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort the shortlist"
              className="shrink-0 rounded-lg border border-line bg-card px-2 py-1.5 text-[12px] text-muted"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {adding && (
        <AddNameForm
          origins={prefsData?.availableOrigins ?? []}
          defaultGender={tab === "all" ? "neutral" : tab}
          initialName={query.trim()}
          onAdded={handleAdded}
          onClose={() => setAdding(false)}
        />
      )}

      {/* Renders nothing until there is enough evidence to say something. */}
      <TasteCard />

      {isLoading && !data ? (
        <p className="mt-10 text-center text-sm text-muted">Loading…</p>
      ) : all.length === 0 ? (
        <div className="mt-16 px-6 text-center">
          <p className="font-display text-2xl">Nothing yet</p>
          <p className="mt-2 text-sm text-muted">
            Names you like will collect here, in the order you choose — from
            swiping, or added by hand.
          </p>
          {!adding && <AddButton onClick={() => setAdding(true)} />}
        </div>
      ) : view.length === 0 ? (
        <div className="mt-14 px-6 text-center">
          <p className="font-display text-2xl">
            {query.trim()
              ? "No matches"
              : tab === "girl"
                ? "No girls’ names yet"
                : "No boys’ names yet"}
          </p>
          <p className="mt-2 text-sm text-muted">
            {query.trim()
              ? `Nothing in this list matches “${query.trim()}”.`
              : "Keep swiping — the ones you like land here."}
          </p>
          {!adding && (
            <AddButton
              onClick={() => setAdding(true)}
              label={query.trim() ? `Add “${query.trim()}”` : "Add a name"}
            />
          )}
        </div>
      ) : (
        <>
          {/* One card around the whole list, hairlines between the names. */}
          <div className="mt-2 overflow-hidden rounded-xl border border-line bg-card">
            {canDrag ? (
              <Reorder.Group
                axis="y"
                values={view}
                onReorder={handleReorder}
                className="divide-y divide-line"
              >
                {view.map((n, i) => (
                  <SortableRow
                    key={n.name_key}
                    value={n}
                    onDrop={commitOrder}
                    rowProps={rowProps(n, i)}
                  />
                ))}
              </Reorder.Group>
            ) : (
              <ul className="divide-y divide-line">
                {view.map((n, i) => (
                  <li key={n.name_key}>
                    <ShortlistRow {...rowProps(n, i)} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="mt-4 mb-1 text-center text-[11px] leading-relaxed text-muted">
            {canDrag
              ? "Double-tap to heart · swipe left to remove · grip to reorder"
              : "Switch to “Your order” and clear the search to drag names around."}
          </p>
        </>
      )}

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-20 mx-auto flex w-fit items-center gap-3 rounded-full bg-ink px-4 py-2 text-[13px] text-canvas"
        >
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={toast.undo}
              className="font-medium text-canvas underline underline-offset-2"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function AddButton({
  onClick,
  label = "Add a name",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="mt-6 rounded-xl border border-line bg-card px-5 py-3 text-sm text-muted transition-colors hover:text-ink"
    >
      {label}
    </button>
  );
}

/**
 * A draggable row.
 *
 * `dragListener={false}` is the whole fix for the broken scroll: with the
 * default listener, Reorder.Item sets `touch-action: pan-x` on every row, so a
 * finger dragged up the list moved a name instead of scrolling the page. With
 * the listener off, motion never touches touch-action, the page scrolls
 * normally anywhere on a row, and reordering starts only from the grip.
 */
function SortableRow({
  value,
  onDrop,
  rowProps,
}: {
  value: Decision;
  onDrop: () => void;
  rowProps: React.ComponentProps<typeof ShortlistRow>;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={value}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDrop}
      // Shadow, not scale: Reorder measures the item's box to decide where it
      // has landed, and a transform would move that box out from under it.
      whileDrag={{ boxShadow: "0 10px 24px rgb(0 0 0 / 0.20)" }}
    >
      <ShortlistRow {...rowProps} dragControls={controls} />
    </Reorder.Item>
  );
}
