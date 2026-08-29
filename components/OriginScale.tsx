"use client";

import { MAX_ORIGIN_WEIGHT, MIN_ORIGIN_WEIGHT } from "@/lib/types";

const STEPS = MAX_ORIGIN_WEIGHT - MIN_ORIGIN_WEIGHT; // 4 gaps, 5 positions
/** Percentage across the track for a given weight. 0 sits dead centre. */
const pct = (w: number) => ((w - MIN_ORIGIN_WEIGHT) / STEPS) * 100;

/**
 * One origin on the −2 … +2 scale.
 *
 * The visible parts — centre line, connector, handle — are painted from the
 * value; a native range input sits transparently on top and handles every
 * input mode. That is the whole reason for the overlay: pointer drag, tap to
 * jump, and arrow keys with correct announcement all come from the platform,
 * where a hand-rolled drag would have to reimplement each one and would still
 * fight the page's vertical scroll on touch.
 *
 * The centre line spans the full row height rather than just the track, so the
 * rows stack into one continuous vertical axis down the list.
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
  const active = value !== 0;
  const positive = value > 0;
  // The connector runs from the centre out to the handle, so it starts at the
  // centre going right and at the handle going left.
  const barLeft = positive ? 50 : pct(value);
  const barWidth = Math.abs(pct(value) - 50);

  return (
    <div className="grid grid-cols-[1fr_8.5rem_1.5rem] items-stretch gap-2 px-3">
      <span
        className={`flex items-center py-2.5 text-sm ${active ? "text-ink" : "text-muted"}`}
      >
        {origin}
      </span>

      <div className="relative flex items-center">
        {/* The shared axis. Full row height so it joins its neighbours. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line"
        />

        <div aria-hidden className="relative h-5 w-full">
          {/* Steps you can land on. */}
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between">
            {Array.from({ length: STEPS + 1 }, (_, i) => (
              <span key={i} className="h-1 w-1 rounded-full bg-line" />
            ))}
          </div>

          {active && (
            <div
              className={`absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full ${
                positive ? "bg-accent" : "bg-red-500/70"
              }`}
              style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
            />
          )}

          <div
            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-colors ${
              !active
                ? "border-line bg-card"
                : positive
                  ? "border-accent bg-accent"
                  : "border-red-500/70 bg-red-500/70"
            }`}
            style={{ left: `${pct(value)}%` }}
          />
        </div>

        <input
          type="range"
          min={MIN_ORIGIN_WEIGHT}
          max={MAX_ORIGIN_WEIGHT}
          step={1}
          value={value}
          aria-label={`How often to show ${origin} names`}
          aria-valuetext={
            value === 0 ? "no preference" : value > 0 ? `+${value}` : String(value)
          }
          onChange={(e) => onInput(Number(e.target.value))}
          onPointerUp={(e) => onCommit(Number(e.currentTarget.value))}
          onKeyUp={(e) => onCommit(Number(e.currentTarget.value))}
          // Opacity, not `hidden`: it has to stay hit-testable and focusable.
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>

      <span
        className={`flex items-center justify-end py-2.5 text-[11px] tabular-nums ${
          positive ? "text-accent" : "text-red-500/80"
        }`}
      >
        {/* A real minus sign, to match the em-width plus. */}
        {active ? (positive ? `+${value}` : `−${-value}`) : ""}
      </span>
    </div>
  );
}
