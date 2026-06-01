export type MockResponse = { status: number; body: unknown };

export function makeMockFetch(responses: MockResponse[]) {
  let i = 0;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[i++] ?? { status: 200, body: {} };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}