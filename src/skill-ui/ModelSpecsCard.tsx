export function ModelSpecsCard({ name, specs }: { name: string; specs: ReadonlyArray<readonly [string, string | undefined]> }) {
  const entries = specs.filter(([, value]) => Boolean(value))
  return <div className="model-specs-card">
    <strong>{name}</strong>
    {entries.length > 0
      ? <dl>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      : <p>此连接暂无可显示的模型规格。</p>}
  </div>
}
