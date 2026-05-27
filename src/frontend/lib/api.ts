/** Safe JSON parse — avoids "Unexpected end of JSON input" on empty API responses. */
export async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? 'Server returned an empty response.'
        : `Server error (${res.status}). Is the API running on port 3001? Run: pnpm dev`
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid server response (${res.status}): ${text.slice(0, 160)}`);
  }
}

export async function apiJson(
  fetcher: (url: string, options?: RequestInit) => Promise<Response>,
  url: string,
  options?: RequestInit
): Promise<{ res: Response; data: any }> {
  const res = await fetcher(url, options);
  const data = await parseJsonResponse(res);
  return { res, data };
}
