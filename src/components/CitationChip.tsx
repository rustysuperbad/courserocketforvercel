import * as Tooltip from "@radix-ui/react-tooltip";

type Source = { citation: number; title: string; url: string; license: string; attribution: string; linkStatus?: string };

export default function CitationChip({ source }: { source: Source }) {
  return (
    <Tooltip.Provider delayDuration={80} skipDelayDuration={120}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <a className="cr-cite-chip" href={`#source-${source.citation}`} aria-label={`Source ${source.citation}: ${source.title}`}>
            {source.citation}
          </a>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="cr-cite-pop" sideOffset={6}>
            <strong style={{ display: "block", color: "var(--text)" }}>{source.title}</strong>
            {source.license} · {source.attribution}
            {source.linkStatus ? ` · ${source.linkStatus}` : ""}
            <Tooltip.Arrow style={{ fill: "var(--surface-3)" }} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
