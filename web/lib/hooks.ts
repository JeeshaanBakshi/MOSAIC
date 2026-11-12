"use client";
// How pages read data. A page asks a question ("get this shop's credentials") and the answer arrives
// later, because on a real chain every read is a network call. After ANY write, the store's version
// goes up, so every query on screen runs again and the UI never shows stale data.
//
// CONNECT: keep this as is. Real reads are also async. If you want fewer calls, replace the version
// trigger with a timer, or re-run queries only after your own writes succeed.

import { useEffect, useState, useSyncExternalStore } from "react";
import { getServerVersion, getVersion, subscribe } from "./mock";

export function useStoreVersion() {
  return useSyncExternalStore(subscribe, getVersion, getServerVersion);
}

export function useQuery<T>(fn: () => Promise<T>, deps: readonly unknown[] = []) {
  const version = useStoreVersion();
  const [state, setState] = useState<{ data?: T; error?: Error }>({});

  useEffect(() => {
    let cancelled = false; // ignore answers that arrive after we've moved on
    fn().then(
      (data) => { if (!cancelled) setState({ data }); },
      (error) => { if (!cancelled) setState({ error }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);

  return { data: state.data, error: state.error, loading: state.data === undefined && !state.error };
}
