import type { Candidate } from "@/lib/types";

const GENDER_LABEL: Record<string, string> = {
  girl: "Girl",
  boy: "Boy",
  neutral: "Neutral",
};

export default function NameCard({
  candidate,
  surname,
}: {
  candidate: Candidate;
  surname?: string | null;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center rounded-3xl border border-line bg-card px-6 shadow-sm">
      <h2 className="text-center font-display text-[clamp(2.75rem,13vw,4.25rem)] leading-[1.05] tracking-tight text-balance">
        {candidate.display}
      </h2>

      {surname && (
        <p className="mt-3 font-display text-lg font-light tracking-[0.14em] text-muted uppercase">
          {surname}
        </p>
      )}

      <p className="absolute bottom-7 text-[13px] tracking-wide text-muted">
        {GENDER_LABEL[candidate.gender] ?? candidate.gender}
        {candidate.origin ? ` · ${candidate.origin}` : ""}
      </p>
    </div>
  );
}
