export type ApiClient = <T>(path: string, options?: RequestInit) => Promise<T>;

export function createApiClient(baseUrl: string): ApiClient {
  return async <T>(path: string, options?: RequestInit): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
    return res.json() as Promise<T>;
  };
}
