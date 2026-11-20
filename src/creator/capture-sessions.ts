const active = new Set<() => Promise<void>>();

export function trackCapture(stop: () => Promise<void>) {
  active.add(stop);
  return () => { active.delete(stop); };
}

export async function stopCreatorCaptures() {
  await Promise.all([...active].map((stop) => stop()));
}
