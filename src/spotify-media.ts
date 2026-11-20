type Token = { accessToken?: string };
type TokenProvider = { getToken(options?: { forceRefresh?: boolean }): Promise<Token | null> };
type Platform = {
  AuthorizationAPI?: { getState?(): { token?: Token }; _tokenProvider?: TokenProvider };
  Registry?: { resolve?(key: symbol): TokenProvider | undefined };
  Session?: Token;
  version?: string;
  PlatformData?: { app_platform?: string };
};

export async function fetchSpotifyMedia(path: string | ((authenticated: boolean) => string), signal: AbortSignal) {
  const { Spicetify, SpotiKit } = globalThis as { Spicetify?: { Platform?: Platform }; SpotiKit?: { Platform?: Platform } };
  const platform = Spicetify?.Platform ?? SpotiKit?.Platform;
  const authorization = platform?.AuthorizationAPI;
  const currentToken = authorization?.getState?.()?.token?.accessToken ?? platform?.Session?.accessToken;
  let provider = authorization?._tokenProvider;
  if (!provider) {
    try { provider = platform?.Registry?.resolve?.(Symbol.for("TokenProvider")); }
    catch { /* Older clients expose the token through Session. */ }
  }
  const request = (token?: string) => {
    const headers = new Headers({ Accept: "application/json" });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (platform?.version) headers.set("Spotify-App-Version", platform.version);
    if (platform?.PlatformData?.app_platform) headers.set("App-Platform", platform.PlatformData.app_platform);
    return fetch(`https://spclient.wg.spotify.com${typeof path === "function" ? path(!!token) : path}`,
      { headers, signal, redirect: "error", credentials: "omit" });
  };
  const token = currentToken ?? (await provider?.getToken())?.accessToken;
  let response = await request(token);
  if (response.status === 401 && token && provider) {
    const refreshed = (await provider.getToken({ forceRefresh: true }))?.accessToken;
    if (refreshed && refreshed !== token) response = await request(refreshed);
  }
  return response;
}
