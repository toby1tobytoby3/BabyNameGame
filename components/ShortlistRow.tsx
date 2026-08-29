"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import type { DragControls } from "motion/react";
import { useRef } from "react";
import { MAX_HEARTS, type Decision } from "@/lib/types";

/** Past this much leftward travel, letting go removes the name. */
const SWIPE_COMMIT = 96;
/** A short, fast flick counts too, provided it actually went somewhere. */
const FLICK_DISTANCE = 40;
const FLICK_VELOCITY = -600;
/** Two taps closer together than this are one double-tap. */
const DOUBLE_TAP_MS = 320;

const GENDER_LABEL: Record<string, string> = {
  girl: "Girl",
  boy: "Boy",
  neutral: "Neutral",
};

function buzz(pattern: number | number[]) {
  // Absent on desktop and on iOS Safari; a favourite must not depend on it.
  navigator.vibrate?.(pattern);
}

/**
 * One name in the shortlist.
 *
 * Three gestures share the row, so they are kept strictly disjoint:
 *   - horizontal drag on the body   → remove (motion sets touch-action: pan-y,
 *     so a vertical finger still scrolls the page);
 *   - double-tap on the body        → add a heart;
 *   - press on the grip handle only → reorder, via the drag controls the
 *     parent Reorder.Item owns. The handle stops pointer events from reaching
 *     the body's drag listener, so the two never fight over one gesture.
 */
export default function ShortlistRow({
  name,
  surname,
  showSurname,
  position,
  showGender,
  dragControls,
  onHeart,
  onRemove,
}: {
  name: Decision;
  surname: string | null;
  showSurname: boolean;
  position: number;
  showGender: boolean;
  dragControls?: DragControls;
  onHeart: () => void;
  onRemove: () => void;
}) {
  const x = useMotionValue(0);
  const revealed = useTransform(x, [-SWIPE_COMMIT, -8], [1, 0]);
  const lastTap = useRef(0);
  const dragged = useRef(false);

  const meta = [
    showGender || name.gender === "neutral"
      ? (GENDER_LABEL[name.gender] ?? name.gender)
      : null,
    name.origin,
  ]
    .filter(Boolean)
    .join(" · ");

  function handleTap() {
    // A click always follows a drag; swallow that one rather than reading it
    // as the first half of a double-tap.
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onHeart();
    } else {
      lastTap.current = now;
    }
  }

  return (
    <div className="relative overflow-hidden rounded-lg select-none">
      <motion.div
        aria-hidden
        style={{ opacity: revealed }}
        className="absolute inset-0 flex items-center justify-end rounded-lg bg-red-600/90 pr-4 text-[12px] tracking-wide text-white"
      >
        Remove
      </motion.div>

      <motion.div
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragMomentum={false}
        dragConstraints={{ left: -132, right: 0 }}
        dragElastic={{ left: 0.2, right: 0 }}
        onPointerDown={() => {
          dragged.current = false;
        }}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={(_, info) => {
          const gone =
            info.offset.x < -SWIPE_COMMIT ||
            (info.offset.x < -FLICK_DISTANCE &&
              info.velocity.x < FLICK_VELOCITY);
          if (gone) {
            buzz(14);
            // AnimationPlaybackControls is not itself a thenable — settle on
            // `.finished`, and on both paths, so a cancelled animation can
            // never strand the row half-swiped.
            animate(x, -420, { duration: 0.16, ease: "easeIn" }).finished.then(
              onRemove,
              onRemove,
            );
          } else {
            animate(x, 0, { type: "spring", stiffness: 520, damping: 42 });
          }
        }}
        onClick={handleTap}
        className="relative flex items-center gap-2 rounded-lg border border-line bg-card px-2.5 py-2"
      >
        {dragControls && (
          <button
            type="button"
            aria-label={`Reorder ${name.display}`}
            // touch-none on the handle alone: the row itself must stay
            // scrollable, so only these 24 pixels claim the gesture.
            className="-ml-1 shrink-0 cursor-grab touch-none px-1 py-1.5 text-muted/60 active:cursor-grabbing"
            onPointerDown={(e) => {
              e.stopPropagation();
              dragControls.start(e);
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <GripIcon />
          </button>
        )}

        <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted/70">
          {position}
        </span>

        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate font-display text-[17px] leading-tight">
            {name.display}
          </span>
          {showSurname && surname && (
            <span className="truncate text-[12px] font-light text-muted">
              {surname}
            </span>
          )}
        </span>

        {name.hearts > 0 && (
          <span
            className="flex shrink-0 items-center gap-px text-warm"
            aria-label={`${name.hearts} heart${name.hearts > 1 ? "s" : ""}`}
          >
            {Array.from({ length: name.hearts }, (_, i) => (
              <HeartIcon key={i} />
            ))}
          </span>
        )}

        {meta && (
          <span className="max-w-[38%] shrink-0 truncate text-[11px] text-muted">
            {meta}
          </span>
        )}
      </motion.div>

      {/* The gestures above are unreachable by keyboard and screen reader; these
          are the same two actions, off-screen but focusable. */}
      <button
        type="button"
        className="sr-only"
        onClick={onHeart}
        onFocus={(e) => e.currentTarget.scrollIntoView({ block: "nearest" })}
      >
        {name.hearts >= MAX_HEARTS
          ? `Clear hearts on ${name.display}`
          : `Add a heart to ${name.display}`}
      </button>
      <button type="button" className="sr-only" onClick={onRemove}>
        Remove {name.display}
      </button>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden fill="currentColor">
      {[3, 8, 13].map((cy) =>
        [2, 8].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" />),
      )}
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 21s-7.5-4.7-9.6-9A5.4 5.4 0 0 1 12 6.2 5.4 5.4 0 0 1 21.6 12c-2.1 4.3-9.6 9-9.6 9Z" />
    </svg>
  );
}
