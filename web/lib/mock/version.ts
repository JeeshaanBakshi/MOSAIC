// "Has anything changed?" The server stamps every answer with a version number. When it goes up (because I did
// something, or because someone ELSE did), every screen re-reads its data.
const listeners = new Set<() => void>();
let version = 0;

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getVersion = () => version;
export const getServerVersion = () => 0;

export function noteVersion(v: number) {
  if (v !== version) {
    version = v;
    listeners.forEach((l) => l());
  }
}
