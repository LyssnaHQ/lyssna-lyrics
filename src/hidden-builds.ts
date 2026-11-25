type SavedHiddenBuild = { key: string; version?: string };

// The launcher uses this key to pick the build to load on startup.
const activeKey = "lyssna-lyrics.v1.hidden-build";
const savedKey = "lyssna-lyrics.v1.saved-hidden-builds";
const keyPattern = /^[A-Za-z0-9_-]{32}$/;

export function activeHiddenBuildKey() {
  try { return localStorage.getItem(activeKey) ?? undefined; }
  catch { return undefined; }
}

export function readSavedHiddenBuilds(): SavedHiddenBuild[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(savedKey) ?? "[]");
    if (Array.isArray(value)) return value.filter((item): item is SavedHiddenBuild =>
      typeof item?.key === "string" && keyPattern.test(item.key) && (item.version === undefined || typeof item.version === "string"));
  } catch { /* Unavailable storage leaves the launcher in charge of the active build. */ }
  return [];
}

export function rememberHiddenBuild(key: string, version?: string) {
  if (!keyPattern.test(key)) throw new Error("Enter the 32-character build key.");
  const builds = readSavedHiddenBuilds();
  const index = builds.findIndex(build => build.key === key);
  if (index < 0) builds.push({ key, version });
  else if (version && builds[index].version !== version) builds[index] = { key, version };
  else return builds;
  localStorage.setItem(savedKey, JSON.stringify(builds));
  return builds;
}

export function forgetHiddenBuild(key: string) {
  const builds = readSavedHiddenBuilds().filter(build => build.key !== key);
  localStorage.setItem(savedKey, JSON.stringify(builds));
  return builds;
}
