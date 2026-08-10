"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { OriginPref, Preferences } from "@/lib/types";

export default function SettingsPage() {
  const router = useRouter();
  const { data, mutate } = useSWR<{
    preferences: Preferences;
    availableOrigins: string[];
  }>("/api/preferences", fetcher);

  // Unsaved edits only; the saved values live on the server.
  const [draft, setDraft] = useState<Partial<Preferences>>({});
  const [saved, setSaved] = useState(false);

  const prefs: Preferences | null = data
    ? { ...data.preferences, ...draft }
    : null;

  const setPrefs = (next: Preferences) => setDraft((d) => ({ ...d, ...next }));

  async function save(patch: Partial<Preferences>) {
    setDraft((d) => ({ ...d, ...patch }));
    await fetch("/api/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
    await mutate();
    setDraft({});
  }

  function setOriginWeight(origin: string, weight: number) {
    if (!prefs) return;
    const others = prefs.origins.filter((o) => o.origin !== origin);
    const next: OriginPref[] =
      weight > 0 ? [...others, { origin, weight }] : others;
    void save({ origins: next });
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (!prefs || !data) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  const weightOf = (origin: string) =>
    prefs.origins.find((o) => o.origin === origin)?.weight ?? 0;

  return (
    <main className="flex flex-1 flex-col gap-8 px-5 pt-4 pb-8">
      <header className="flex items-baseline justify-between">
        <h1 className="font-display text-3xl">Settings</h1>
        {saved && <span className="text-[12px] text-accent">Saved</span>}
      </header>

      {/* Surname ---------------------------------------------------------- */}
      <section>
        <h2 className="text-[13px] font-medium tracking-wide">Surname</h2>
        <p className="mt-1 text-[12px] text-muted">
          Shown under each name so you can hear the whole thing.
        </p>
        <input
          value={prefs.surname ?? ""}
          onChange={(e) => setPrefs({ ...prefs, surname: e.target.value })}
          onBlur={(e) => save({ surname: e.target.value })}
          placeholder="Strindberg"
          className="mt-3 w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-accent"
        />
      </section>

      {/* Mix -------------------------------------------------------------- */}
      <section>
        <h2 className="text-[13px] font-medium tracking-wide">
          Familiar ↔ Exploratory
        </h2>
        <p className="mt-1 text-[12px] text-muted">
          {Math.round(prefs.similar_new_mix * 100)}% like what you&rsquo;ve
          already liked, {Math.round((1 - prefs.similar_new_mix) * 100)}% fresh
          territory.
        </p>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(prefs.similar_new_mix * 100)}
          onChange={(e) =>
            setPrefs({ ...prefs, similar_new_mix: Number(e.target.value) / 100 })
          }
          onMouseUp={(e) =>
            save({ similar_new_mix: Number(e.currentTarget.value) / 100 })
          }
          onTouchEnd={(e) =>
            save({ similar_new_mix: Number(e.currentTarget.value) / 100 })
          }
          className="mt-3 w-full accent-[var(--color-accent)]"
        />
      </section>

      {/* Origin mode ------------------------------------------------------ */}
      <section>
        <h2 className="text-[13px] font-medium tracking-wide">Origins</h2>
        <div className="mt-3 flex gap-1 rounded-lg border border-line bg-card p-0.5">
          {(["soft", "hard"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => save({ origin_mode: mode })}
              className={`flex-1 rounded-md px-3 py-2 text-[12px] transition-colors ${
                prefs.origin_mode === mode
                  ? "bg-accent text-card"
                  : "text-muted hover:text-ink"
              }`}
            >
              {mode === "soft" ? "Nudge towards" : "Only these"}
            </button>
          ))}
        </div>

        <ul className="mt-3 space-y-1.5">
          {data.availableOrigins.map((origin) => {
            const w = weightOf(origin);
            return (
              <li
                key={origin}
                className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-2.5"
              >
                <span className={`text-sm ${w > 0 ? "text-ink" : "text-muted"}`}>
                  {origin}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOriginWeight(origin, Math.max(w - 1, 0))}
                    disabled={w === 0}
                    aria-label={`Decrease ${origin}`}
                    className="h-7 w-7 rounded-md border border-line text-muted disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-4 text-center text-sm tabular-nums">
                    {w}
                  </span>
                  <button
                    onClick={() => setOriginWeight(origin, Math.min(w + 1, 5))}
                    disabled={w === 5}
                    aria-label={`Increase ${origin}`}
                    className="h-7 w-7 rounded-md border border-line text-muted disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <button
        onClick={logout}
        className="rounded-xl border border-line bg-card py-3 text-sm text-muted"
      >
        Log out
      </button>
    </main>
  );
}
