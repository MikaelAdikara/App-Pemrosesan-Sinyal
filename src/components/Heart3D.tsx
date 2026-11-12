// Jantung "clay" semi-3D: gradien radial + sorotan spekular + bayangan lantai.
// Berdenyut setiap kali detektor menemukan detak; ungu-merah tua bila detak itu PVC.
export function Heart3D({ beat, kind }: { beat: number; kind: 'N' | 'V' | null }) {
  return (
    <div className={'heart3d' + (kind === 'V' ? ' is-v' : '')} aria-hidden>
      <svg viewBox="0 0 120 120" key={beat} className={beat ? 'pump' : ''}>
        <defs>
          <radialGradient id="hb" cx="36%" cy="30%" r="78%">
            <stop offset="0" stopColor="var(--h1)" />
            <stop offset=".45" stopColor="var(--h2)" />
            <stop offset="1" stopColor="var(--h3)" />
          </radialGradient>
          <radialGradient id="hs" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#fff" stopOpacity=".9" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hr" x1="0" y1="0" x2="0" y2="1">
            <stop offset=".55" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#FFB3C0" stopOpacity=".55" />
          </linearGradient>
          <filter id="hblur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
        </defs>
        <ellipse className="floor" cx="60" cy="108" rx="30" ry="5" fill="#000" opacity=".45" filter="url(#hblur)" />
        <g className="body">
          <path d="M60 100C30 80 10 62 10 38 10 22 22 10 37 10c10 0 18 5 23 14 5-9 13-14 23-14 15 0 27 12 27 28 0 24-20 42-50 62z" fill="url(#hb)" />
          <path d="M60 100C30 80 10 62 10 38 10 22 22 10 37 10c10 0 18 5 23 14 5-9 13-14 23-14 15 0 27 12 27 28 0 24-20 42-50 62z" fill="url(#hr)" />
          <ellipse cx="36" cy="30" rx="13" ry="8" fill="url(#hs)" transform="rotate(-28 36 30)" />
          <circle cx="82" cy="26" r="4" fill="#fff" opacity=".35" />
          <path className="trace" d="M14 56h22l5-9 7 20 7-30 6 24 4-5h41" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" opacity=".92" />
        </g>
      </svg>
    </div>
  )
}
