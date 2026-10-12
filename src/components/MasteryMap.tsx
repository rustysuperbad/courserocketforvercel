type Node = { id: string; label: string; state: "known" | "open" };

export default function MasteryMap({ nodes }: { nodes: Node[] }) {
  if (!nodes.length) return null;
  return (
    <div className="cr-mastery" aria-label="Mastery map">
      {nodes.map((node) => (
        <span key={node.id} data-state={node.state}>{node.label}</span>
      ))}
    </div>
  );
}
