"use client";
// The trust graph: the shop in the centre, each issuer around it.
// green = verified, grey = unknown, red = failed a check.
import { useMemo } from "react";
import type React from "react";
import { ReactFlow, Background, Handle, Position, type Node, type Edge, type NodeProps, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import type { Graph } from "@/lib/mock";

const COLORS: Record<string, { bg: string; border: string; text: string }> = {
  shop: { bg: "#E6EFE7", border: "#E6EFE7", text: "#0B1410" },
  verified: { bg: "#19291F", border: "#CFE3D6", text: "#CFE3D6" },
  failed: { bg: "#2B1814", border: "#E48C7B", text: "#E48C7B" },
  unknown: { bg: "#15241C", border: "#5C7468", text: "#9FB4A8" },
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
  // The page re-reads the graph whenever anything changes, and each read is a NEW object. React Flow hides a node until it
  // has measured it, and re-measuring on every new object left the whole graph hidden (a blank box). So: rebuild the nodes
  // and edges only when the graph's CONTENT changes, and give every node a fixed size so it never needs measuring.
  const signature = JSON.stringify(graph);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { nodes, edges } = useMemo(() => build(graph), [signature]);

  return (
    <div className="h-[360px] w-full overflow-hidden rounded-(--radius-panel) border border-line bg-surface sm:h-[420px]">
      <ReactFlow key={signature} nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
        <Background color="#22362B" gap={22} size={1} />
      </ReactFlow>
    </div>
  );
}

function build(graph: Graph): { nodes: Node[]; edges: Edge[] } {
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
      width: isShop ? 170 : 150, height: isShop ? 62 : 82, // fixed size: no measuring, so the node is visible straight away
      style: { background: c.bg, color: c.text, border: `1.5px solid ${c.border}`, borderRadius: 10, padding: 10, boxShadow: "none" },
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

  return { nodes, edges };
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
