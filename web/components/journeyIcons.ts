// SVG icon data (24x24 grid) for the particle shapes: the SAME icons our rail uses (Handshake, Store, Landmark, ShieldCheck) plus Receipt.
// Copied from lucide-react (ISC licence). Each entry is a list of [tag, attributes] drawing instructions.

export type IconNode = [string, Record<string, string | number>][];

export const handshakeIcon: IconNode = [ [ "path", { "d": "m11 17 2 2a1 1 0 1 0 3-3" } ], [ "path", { "d": "m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" } ], [ "path", { "d": "m21 3 1 11h-2" } ], [ "path", { "d": "M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" } ], [ "path", { "d": "M3 4h8" } ] ];

export const receiptIcon: IconNode = [ [ "path", { "d": "M12 17V7" } ], [ "path", { "d": "M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8" } ], [ "path", { "d": "M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z" } ] ];

export const storeIcon: IconNode = [ [ "path", { "d": "M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" } ], [ "path", { "d": "M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" } ], [ "path", { "d": "M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" } ] ];

export const landmarkIcon: IconNode = [ [ "path", { "d": "M10 18v-7" } ], [ "path", { "d": "M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z" } ], [ "path", { "d": "M14 18v-7" } ], [ "path", { "d": "M18 18v-7" } ], [ "path", { "d": "M3 22h18" } ], [ "path", { "d": "M6 18v-7" } ] ];

export const shieldIcon: IconNode = [ [ "path", { "d": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" } ], [ "path", { "d": "m9 12 2 2 4-4" } ] ];
