"use client";
// Every USDC balance. Re-reads after every change, so you can watch money move.
// CONNECT: each number is `balance(address)` on the USDC token contract.
import { Skeleton } from "@/components/ui";
import { CONTRACT_ADDRESS, contract } from "@/lib/mock";
import { useQuery } from "@/lib/hooks";
import { PERSONAS, accountOf, PERSONA_IDS } from "@/lib/session";
import { usdc } from "@/lib/format";

const PARTIES = [...PERSONA_IDS.filter((p) => accountOf(p)).map((p) => ({ key: p as string, name: PERSONAS[p].label, address: accountOf(p)!.address })),
  { key: "contract", name: "Stakes held by the contract", address: CONTRACT_ADDRESS }];

export function Balances() {
  const { data } = useQuery(() => contract.getBalances(PARTIES.map((p) => p.address)));
  return (
    <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
      {PARTIES.map((p, i) => (
        <div key={p.key} className="flex min-w-0 items-baseline justify-between gap-4 border-b border-line py-2">
          <dt className="min-w-0 truncate text-sm text-quiet">{p.name}</dt>
          <dd className="shrink-0 text-sm font-medium tabular-nums" data-balance={p.key}>{data ? usdc(data[i]) : <Skeleton className="h-4 w-14" />}</dd>
        </div>
      ))}
    </dl>
  );
}
