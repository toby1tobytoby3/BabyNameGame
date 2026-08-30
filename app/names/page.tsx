import { Suspense } from "react";
import NameBrowser from "@/components/NameBrowser";

/**
 * The browser reads its opening filters from the query string (the shortlist's
 * "Find more like these" link arrives with sort and hideSeen already set), and
 * useSearchParams needs a Suspense boundary above it or the whole route falls
 * back to client rendering.
 */
export default function NamesPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 flex-col px-5 pt-4">
          <h1 className="font-display text-3xl">All names</h1>
        </main>
      }
    >
      <NameBrowser />
    </Suspense>
  );
}
