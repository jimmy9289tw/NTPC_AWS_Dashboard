export function DataReadingSummary({ facts, identity }: { facts: string[]; identity?: string }) {
  if (!facts.length) return null;
  return <aside className="data-reading-summary" aria-label="數據重點">
    <div><strong>數據重點</strong>{identity && <small>{identity}</small>}</div>
    <ul>{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
  </aside>;
}
