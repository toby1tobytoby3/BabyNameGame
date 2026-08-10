export class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

/**
 * SWR fetcher that actually fails on failure.
 *
 * `fetch(...).then(r => r.json())` resolves for 4xx/5xx too, so SWR would treat
 * a broken server as a successful empty response — an outage renders as "you've
 * seen everything", which is worse than an error.
 */
export const fetcher = async (url: string) => {
  const res = await fetch(url);

  // The session cookie lasts 90 days; when it lapses, every request 401s.
  // Send the user back to the login screen rather than showing empty pages.
  if (res.status === 401) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      // A hard navigation is deliberate: a client-side push would keep the SWR
      // cache and component state from the expired session alive.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    }
    throw new HttpError(401);
  }

  if (!res.ok) throw new HttpError(res.status);
  return res.json();
};
