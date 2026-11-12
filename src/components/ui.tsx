import { useId, type ReactNode } from 'react'

export function Slider(p: {
  label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; fmt?: (v: number) => string; hint?: string
}) {
  const id = useId()
  const pct = ((p.value - p.min) / (p.max - p.min)) * 100
  return (
    <div className="ctl">
      <div className="ctl-head">
        <label htmlFor={id}>{p.label}</label>
        <output htmlFor={id}>{p.fmt ? p.fmt(p.value) : p.value}</output>
      </div>
      <input id={id} type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value}
        style={{ '--pct': pct + '%' } as React.CSSProperties}
        onChange={(e) => p.onChange(Number(e.target.value))} />
      {p.hint && <p className="ctl-hint">{p.hint}</p>}
    </div>
  )
}

export function Choice<T extends string | number>(p: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <div className="ctl" role="radiogroup" aria-label={p.label}>
      <div className="ctl-head"><span className="ctl-label">{p.label}</span></div>
      <div className="seg">
        {p.options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === p.value}
            className={o.value === p.value ? 'on' : ''} onClick={() => p.onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  )
}

export function Toggle(p: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId()
  return (
    <div className="ctl toggle">
      <input id={id} type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      <label htmlFor={id}><span className="sw" aria-hidden />{p.label}</label>
      {p.hint && <p className="ctl-hint">{p.hint}</p>}
    </div>
  )
}

/** angka besar dengan keterangan kecil di bawahnya */
export function Read(p: { value: ReactNode; label: string; tone?: 'ink' | 'cobalt' | 'red' | 'teal' }) {
  return (
    <div className={`read tone-${p.tone ?? 'ink'}`}>
      <div className="read-v">{p.value}</div>
      <div className="read-l">{p.label}</div>
    </div>
  )
}

export function Figure(p: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <figure className={'fig ' + (p.className ?? '')}>
      <figcaption><span className="fig-t">{p.title}</span>{p.note && <span className="fig-n">{p.note}</span>}</figcaption>
      {p.children}
    </figure>
  )
}

export function Legend(p: { items: { color: string; label: string; dash?: boolean }[] }) {
  return (
    <ul className="legend">
      {p.items.map((i) => (
        <li key={i.label}><span className={'sw-line' + (i.dash ? ' dash' : '')} style={{ borderColor: i.color }} />{i.label}</li>
      ))}
    </ul>
  )
}

export function Bench(p: { controls: ReactNode; children: ReactNode }) {
  return (
    <div className="bench">
      <aside className="bench-ctl">{p.controls}</aside>
      <div className="bench-out">{p.children}</div>
    </div>
  )
}

export function Formula(p: { children: ReactNode }) { return <div className="formula">{p.children}</div> }
