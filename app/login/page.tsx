"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      router.replace("/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong");
      setPassword("");
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-8">
      <h1 className="font-display text-5xl tracking-tight">Names</h1>
      <p className="mt-2 text-sm text-muted">A shortlist, two people.</p>

      <form onSubmit={submit} className="mt-10 w-full">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          aria-label="Password"
          className="w-full rounded-xl border border-line bg-card px-4 py-3.5 text-center text-lg outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-3 w-full rounded-xl bg-accent py-3.5 text-card disabled:opacity-40"
        >
          {busy ? "…" : "Enter"}
        </button>
        {error && (
          <p role="alert" className="mt-3 text-center text-sm text-muted">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}
