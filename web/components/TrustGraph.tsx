"use client";
// The trust graph: the shop in the centre, each issuer around it.
// green = verified, grey = unknown, red = failed a check.
import type React from "react";
import { ReactFlow, Background, Handle, Position, type Node, type Edge, type NodeProps, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { Graph } from "@/lib/mock";

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  shop: { bg: "#192824", border: "#192824", text: "#FFFFFF" },
  verified: { bg: "#E3EEE8", border: "#245B49", text: "#1A4637" },
  failed: { bg: "#F6E6E3", border: "#B94A3C", text: "#B94A3C" },
  unknown: { bg: "#EAF2ED", border: "#8A9791", text: "#5A6B63" },
};
const KIND_LABEL: Record<string, string> = { Supplier: "Supplier", PaymentProvider: "Payment provider", shop: "Shop" };

// A node with an invisible handle on every side, so each line leaves from the side facing the other node.
const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];
function SideNode({ data }: NodeProps) {
  return (
    <>
      {SIDES.map((p) => <Handle key={`s-${p}`} id={`s-${p}`} type="source" position={p} style={{ opacity: 0 }} />)}
      {SIDES.map((p) => <Handle key={`t-${p}`} id={`t-${p}`} type="target" position={p} style={{ opacity: 0 }} />)}
      {(data as { label: React.ReactNode }).label}
    </>
  );
}
const nodeTypes = { side: SideNode };

function facing(dx: number, dy: number): Position {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? Position.Right : Position.Left;
  return dy > 0 ? Position.Bottom : Position.Top;
}

export function TrustGraph({ graph }: { graph: Graph }) {
  const issuers = graph.nodes.filter((n) => n.type !== "shop");
  const radius = 190;

  const nodes: Node[] = graph.nodes.map((n) => {
    const isShop = n.type === "shop";
    const i = issuers.findIndex((x) => x.id === n.id);
    const angle = (2 * Math.PI * i) / Math.max(issuers.length, 1) - Math.PI / 2;
    const c = COLORS[n.state] ?? COLORS.unknown;
    return {
      id: n.id,
      type: "side",
      position: isShop ? { x: 0, y: 0 } : { x: radius * 1.35 * Math.cos(angle), y: radius * Math.sin(angle) },
      data: {
        label: (
          <div className="leading-tight">
            <div className="text-[11px] font-medium opacity-70">{KIND_LABEL[n.type] ?? n.type}</div>
            <div className="text-sm font-medium">{n.label}</div>
            {!isShop && <div className="mt-1 text-[11px] capitalize">{n.state === "verified" ? "Verified" : n.state === "failed" ? "Did not pass" : "Unknown"}</div>}
          </div>
        ),
      },
      style: { background: c.bg, color: c.text, border: `1.5px solid ${c.border}`, borderRadius: 10, width: isShop ? 170 : 150, padding: 10, boxShadow: "none" },
      connectable: false,
    };
  });

  const pos = Object.fromEntries(nodes.map((n) => [n.id, n.position]));
  const edges: Edge[] = graph.edges.map((e) => {
    const c = COLORS[e.state] ?? COLORS.unknown;
    const from = pos[e.source] ?? { x: 0, y: 0 };
    const to = pos[e.target] ?? { x: 0, y: 0 };
    return {
      id: e.id, source: e.source, target: e.target, type: "straight",
      sourceHandle: `s-${facing(to.x - from.x, to.y - from.y)}`,
      targetHandle: `t-${facing(from.x - to.x, from.y - to.y)}`,
      animated: e.state === "verified",
      style: { stroke: c.border, strokeWidth: 1.5, strokeDasharray: e.state === "unknown" ? "6 4" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: c.border },
    };
  });

  return (
    <div className="h-[360px] w-full overflow-hidden rounded-(--radius-panel) border border-line bg-surface sm:h-[420px]">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        <Background color="#D6E3DB" gap={22} size={1} />
      </ReactFlow>
    </div>
  );
}

export function GraphLegend() {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-quiet">
      <span className="flex items-center gap-2"><CircleCheck className="size-4 text-pine" aria-hidden /> Verified: every check passes</span>
      <span className="flex items-center gap-2"><CircleDashed className="size-4 text-faint" aria-hidden /> Unknown, not bad</span>
      <span className="flex items-center gap-2"><CircleX className="size-4 text-clay" aria-hidden /> Did not pass a fraud check</span>
    </div>
  );
}
