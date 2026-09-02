"use client";

import { useRef } from "react";
import { MAX_ORIGIN_WEIGHT, MIN_ORIGIN_WEIGHT } from "@/lib/types";

const STEPS = MAX_ORIGIN_WEIGHT - MIN_ORIGIN_WEIGHT; // 4 gaps, 5 positions
/** Percentage across the track for a given weight. 0 sits dead centre. */
const pct = (w: number) => ((w - MIN_ORIGIN_WEIGHT) / STEPS) * 100;
const clamp = (w: number) =>
  Math.min(MAX_ORIGIN_WEIGHT, Math.max(MIN_ORIGIN_WEIGHT, w));

/**
 * One origin on the −2 … +2 scale.
 *
 * This was a transparent `input[type=range]` laid over painted marks, to get
 * drag, tap and keyboard from the platform for free. Two of those three are a
 * lie on iOS Safari: a range input there only responds to a drag that starts on
 * the thumb, so tapping a position — the obvious gesture, and the only one that
 * makes sense for five discrete steps — did nothing at all and nothing saved.
 *
 * So the gesture is ours now: pointerdown picks the nearest step, a drag keeps
 * picking as it moves, and release saves once. `touch-action: pan-y` leaves
 * vertical scrolling to the browser, and when it does take the gesture the
 * pointercancel puts the value back where it started.
 */
export default function OriginScale({
  origin,
  value,
  onInput,
  onCommit,
}: {
  origin: string;
  value: number;
  /** Live, per step, while dragging. */
  onInput: (weight: number) => void;
  /** On release — one save per gesture, not one per step. */
  onCommit: (weight: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  /** Where the gesture started and where it has got to, for commit and undo. */
  const from = useRef(value);
  const latest = useRef(value);

  const active = value !== 0;
  const positive = value > 0;

  /** The step nearest a point on the track. */
  function stepAt(clientX: number) {
    const el = track.current;
    if (!el) return value;
    const box = el.getBoundingClientRect();
    const across = box.width === 0 ? 0 : (clientX - box.left) / box.width;
    return clamp(Math.round(across * STEPS) + MIN_ORIGIN_WEIGHT);
  }

  function pick(clientX: number) {
    const next = stepAt(clientX);
    if (next === latest.current) return;
    latest.current = next;
    onInput(next);
  }

  return (
    <div className="grid grid-cols-[1fr_8.5rem_1.75rem] items-stretch gap-2 px-3">
      <span
        className={`flex items-center py-2.5 text-sm ${active ? "text-ink" : "text-muted"}`}
      >
        {origin}
      </span>

      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={`How often to show ${origin} names`}
        aria-valuemin={MIN_ORIGIN_WEIGHT}
        aria-valuemax={MAX_ORIGIN_WEIGHT}
        aria-valuenow={value}
        aria-valuetext={
          value === 0 ? "no preference" : value > 0 ? `+${value}` : String(value)
        }
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          dragging.current = true;
          from.current = value;
          latest.current = value;
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) pick(e.clientX);
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          // Nothing moved — no request, and nothing to undo.
          if (latest.current !== from.current) onCommit(latest.current);
        }}
        onPointerCancel={() => {
          // The browser claimed the gesture for a scroll. Put it back.
          if (!dragging.current) return;
          dragging.current = false;
          if (latest.current !== from.current) onInput(from.current);
        }}
        onKeyDown={(e) => {
          const next =
            e.key === "ArrowLeft" || e.key === "ArrowDown"
              ? clamp(value - 1)
              : e.key === "ArrowRight" || e.key === "ArrowUp"
                ? clamp(value + 1)
                : e.key === "Home"
                  ? MIN_ORIGIN_WEIGHT
                  : e.key === "End"
                    ? MAX_ORIGIN_WEIGHT
                    : value;
          if (next === value) return;
          e.preventDefault();
          onCommit(next);
        }}
        className="relative flex cursor-pointer touch-pan-y items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {/* The shared axis. Full row height so it joins its neighbours. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line"
        />

        <div aria-hidden className="relative h-5 w-full">
          {/* Steps you can land on, on the same centres as the handle. */}
          {Array.from({ length: STEPS + 1 }, (_, i) => (
            <span
              key={i}
              className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line"
              style={{ left: `${(i / STEPS) * 100}%` }}
            />
          ))}

          <div
            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-[left,background-color,border-color] duration-100 ${
              !active
                ? "border-line bg-card"
                : positive
                  ? "border-accent bg-accent"
                  : "border-red-500/70 bg-red-500/70"
            }`}
            style={{ left: `${pct(value)}%` }}
          />
        </div>
      </div>

      <span
        className={`flex items-center justify-end py-2.5 text-[11px] tabular-nums ${
          !active ? "text-muted/60" : positive ? "text-accent" : "text-red-500/80"
        }`}
      >
        {/* A real minus sign, to match the em-width plus. */}
        {active ? (positive ? `+${value}` : `−${-value}`) : "0"}
      </span>
    </div>
  );
}
