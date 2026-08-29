"use client";

import { useState } from "react";
import type { AddResult } from "@/lib/queue";
import type { Gender } from "@/lib/types";

const GENDERS: { key: Gender; label: string }[] = [
  { key: "girl", label: "Girl" },
  { key: "boy", label: "Boy" },
  { key: "neutral", label: "Either" },
];

/**
 * Add a name the swipe deck never offered.
 *
 * The origin field is optional and only a hint: a name the library already
 * knows gets its own origin and tags server-side regardless of what is typed
 * here, so leaving it blank costs nothing.
 */
export default function AddNameForm({
  origins,
  defaultGender,
  initialName = "",
  onAdded,
  onClose,
}: {
  origins: string[];
  defaultGender: Gender;
  /** Prefill, so opening the form while searching carries the term across. */
  initialName?: string;
  onAdded: (result: AddResult) => void;
  onClose: () => void;
}) {
  const [display, setDisplay] = useState(initialName);
  const [gender, setGender] = useState<Gender>(defaultGender);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !display.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/liked/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display, gender, origin }),
      });
      const body = (await res.json()) as AddResult & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Couldn’t add that name");
        return;
      }
      onAdded(body);
    } catch {
      setError("Couldn’t reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="mt-2 rounded-xl border border-line bg-card p-3"
    >
      <input
        autoFocus
        value={display}
        onChange={(e) => {
          setDisplay(e.target.value);
          setError(null);
        }}
        placeholder="Name"
        aria-label="Name to add"
        maxLength={40}
        autoCapitalize="words"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-display text-lg outline-none focus:border-accent"
      />

      <div className="mt-2 flex gap-1 rounded-lg border border-line p-0.5">
        {GENDERS.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setGender(g.key)}
            aria-pressed={gender === g.key}
            className={`flex-1 rounded-md py-1.5 text-[13px] transition-colors ${
              gender === g.key ? "bg-accent text-card" : "text-muted hover:text-ink"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      <input
        value={origin}
        onChange={(e) => setOrigin(e.target.value)}
        list="known-origins"
        placeholder="Origin (optional)"
        aria-label="Origin"
        maxLength={40}
        autoComplete="off"
        className="mt-2 w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] outline-none focus:border-accent"
      />
      <datalist id="known-origins">
        {origins.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-line px-3 py-2 text-[13px] text-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !display.trim()}
          className="flex-1 rounded-lg bg-accent py-2 text-[13px] text-card disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add to shortlist"}
        </button>
      </div>
    </form>
  );
}
