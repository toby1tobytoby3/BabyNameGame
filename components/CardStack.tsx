"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import NameCard from "./NameCard";
import type { Candidate, Verdict } from "@/lib/types";

const THRESHOLD = 110;

export default function CardStack({
  cards,
  surname,
  onDecide,
  onUndo,
  canUndo,
}: {
  cards: Candidate[];
  surname?: string | null;
  onDecide: (c: Candidate, v: Verdict) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const x = useMotionValue(0);
  const busy = useRef(false);

  const rotate = useTransform(x, [-240, 0, 240], [-9, 0, 9]);
  // Warm wash on like, cool wash on pass. No icons, no confetti — this is a
  // fond decision, not a game show.
  const likeWash = useTransform(x, [20, 150], [0, 1]);
  const passWash = useTransform(x, [-150, -20], [1, 0]);

  const top = cards[0];

  const commit = useCallback(
    (verdict: Verdict) => {
      if (!top || busy.current) return;
      busy.current = true;
      const dir = verdict === "like" ? 1 : -1;

      const finish = () => {
        onDecide(top, verdict);
        x.set(0);
        busy.current = false;
      };

      // Motion's AnimationPlaybackControls exposes `finished`; it is NOT itself
      // a thenable, so `animate(...).then(...)` throws and the swipe silently
      // never commits. Settle on both paths — a cancelled animation rejects,
      // and leaving `busy` true would wedge the entire stack.
      animate(x, dir * 520, { duration: 0.22, ease: "easeIn" }).finished.then(
        finish,
        finish,
      );
    },
    [top, x, onDecide],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.tagName === "INPUT")
        return;
      if (e.key === "ArrowLeft") commit("pass");
      else if (e.key === "ArrowRight") commit("like");
      else if (e.key === "Backspace" || (e.key === "z" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        if (canUndo) onUndo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, onUndo, canUndo]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="no-touch-scroll relative flex-1">
        {cards
          .slice(0, 3)
          .reverse()
          .map((c, revIdx, arr) => {
            const depth = arr.length - 1 - revIdx; // 0 = top
            const isTop = depth === 0;
            return (
              <motion.div
                key={c.name_key}
                className="absolute inset-0"
                style={
                  isTop
                    ? { x, rotate, zIndex: 3 }
                    : { zIndex: 3 - depth }
                }
                animate={
                  isTop
                    ? { scale: 1, y: 0, opacity: 1 }
                    : { scale: 1 - depth * 0.035, y: depth * 10, opacity: 1 }
                }
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
                drag={isTop ? "x" : false}
                dragSnapToOrigin
                dragElastic={0.55}
                onDragEnd={(_, info) => {
                  if (info.offset.x > THRESHOLD) commit("like");
                  else if (info.offset.x < -THRESHOLD) commit("pass");
                }}
              >
                <div className="relative h-full w-full">
                  <NameCard candidate={c} surname={surname} />
                  {isTop && (
                    <>
                      <motion.div
                        aria-hidden
                        style={{ opacity: likeWash }}
                        className="pointer-events-none absolute inset-0 rounded-3xl bg-warm/20"
                      />
                      <motion.div
                        aria-hidden
                        style={{ opacity: passWash }}
                        className="pointer-events-none absolute inset-0 rounded-3xl bg-slate-500/15"
                      />
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
      </div>

      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          onClick={() => commit("pass")}
          disabled={!top}
          className="flex-1 rounded-xl border border-line bg-card py-3.5 text-sm text-muted transition-colors hover:text-ink disabled:opacity-40"
        >
          Pass
        </button>
        <button
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo last swipe"
          className="rounded-xl border border-line bg-card px-4 py-3.5 text-sm text-muted transition-colors hover:text-ink disabled:opacity-30"
        >
          Undo
        </button>
        <button
          onClick={() => commit("like")}
          disabled={!top}
          className="flex-1 rounded-xl bg-accent py-3.5 text-sm text-card disabled:opacity-40"
        >
          Like
        </button>
      </div>
    </div>
  );
}
