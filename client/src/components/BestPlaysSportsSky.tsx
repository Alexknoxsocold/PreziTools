export default function BestPlaysSportsSky() {
  return (
    <div className="bp-sports-sky bp-cosmic-arena pointer-events-none absolute inset-0" aria-hidden="true">
      <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" role="presentation">
        <defs>
          <linearGradient id="bpArenaGround" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9f3f63" stopOpacity=".36" />
            <stop offset=".46" stopColor="#542552" stopOpacity=".46" />
            <stop offset="1" stopColor="#160d2b" stopOpacity=".82" />
          </linearGradient>
          <linearGradient id="bpArenaRing" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#38bdf8" stopOpacity="0" />
            <stop offset=".32" stopColor="#38bdf8" stopOpacity=".65" />
            <stop offset=".68" stopColor="#a78bfa" stopOpacity=".8" />
            <stop offset="1" stopColor="#4ade80" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="bpArenaPlanet" cx="35%" cy="28%" r="72%">
            <stop offset="0" stopColor="#a7f3d0" stopOpacity=".72" />
            <stop offset=".22" stopColor="#0ea5e9" stopOpacity=".42" />
            <stop offset=".58" stopColor="#4338ca" stopOpacity=".38" />
            <stop offset="1" stopColor="#100d35" stopOpacity=".12" />
          </radialGradient>
          <radialGradient id="bpArenaGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#a78bfa" stopOpacity=".34" />
            <stop offset=".5" stopColor="#2563eb" stopOpacity=".12" />
            <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
          </radialGradient>
          <filter id="bpSkyGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="bpArenaBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>

        <g className="bp-arena-aurora" filter="url(#bpArenaBlur)">
          <path d="M-120 250 C220 70 410 390 770 185 C1040 30 1255 275 1720 78" />
          <path d="M-150 390 C230 180 470 460 820 280 C1125 125 1375 350 1740 205" />
        </g>

        <g className="bp-arena-planet-system" transform="translate(1185 260)">
          <ellipse className="bp-arena-planet-aura" cx="0" cy="0" rx="330" ry="280" fill="url(#bpArenaGlow)" />
          <circle className="bp-arena-planet" cx="0" cy="0" r="137" fill="url(#bpArenaPlanet)" />
          <path className="bp-arena-planet-band" d="M-116 -42 C-35 -1 46 4 120 -31 M-127 21 C-41 58 49 62 126 18 M-92 72 C-23 91 40 91 95 66" />
          <ellipse className="bp-arena-ring bp-arena-ring-back" cx="0" cy="3" rx="235" ry="55" />
          <ellipse className="bp-arena-ring bp-arena-ring-front" cx="0" cy="3" rx="235" ry="55" />
          <circle className="bp-arena-moon bp-arena-moon-one" cx="-222" cy="-48" r="7" />
          <circle className="bp-arena-moon bp-arena-moon-two" cx="202" cy="48" r="5" />
        </g>

        <g className="bp-arena-constellation">
          <path d="M90 205 L250 142 L408 236 L566 128 L742 226 L884 165" />
          <path d="M250 142 L313 306 L498 328 L566 128 M742 226 L806 353 L975 314" />
          {[['90','205'],['250','142'],['408','236'],['566','128'],['742','226'],['884','165'],['313','306'],['498','328'],['806','353'],['975','314']].map(([cx,cy], index) => (
            <circle key={`${cx}-${cy}`} className={`bp-arena-node bp-arena-node-${(index % 3) + 1}`} cx={cx} cy={cy} r={index % 2 ? 4 : 3} />
          ))}
        </g>

        <g className="bp-arena-score-orbit">
          <ellipse cx="360" cy="548" rx="180" ry="42" />
          <circle cx="180" cy="548" r="5" />
          <circle cx="540" cy="548" r="5" />
        </g>

        <g className="bp-arena-lights bp-arena-lights-left" transform="translate(82 720)">
          <path d="M0 142 L34 0 L68 142 M13 91 H55 M20 54 H48" />
          <g className="bp-arena-lamp"><circle cx="21" cy="0" r="5" /><circle cx="34" cy="-4" r="6" /><circle cx="48" cy="0" r="5" /></g>
        </g>
        <g className="bp-arena-lights bp-arena-lights-right" transform="translate(1450 720)">
          <path d="M0 142 L34 0 L68 142 M13 91 H55 M20 54 H48" />
          <g className="bp-arena-lamp"><circle cx="21" cy="0" r="5" /><circle cx="34" cy="-4" r="6" /><circle cx="48" cy="0" r="5" /></g>
        </g>

        <path className="bp-mars-ridge bp-mars-ridge-back" d="M0 842 C150 792 274 840 410 798 C556 754 704 842 850 792 C1012 737 1115 828 1260 778 C1388 734 1494 774 1600 745 L1600 1000 L0 1000 Z" />
        <path className="bp-mars-ridge" fill="url(#bpArenaGround)" d="M0 882 C138 835 260 894 390 846 C542 790 682 895 824 842 C972 786 1098 887 1248 824 C1382 768 1504 824 1600 790 L1600 1000 L0 1000 Z" />
        <path className="bp-arena-horizon" d="M0 846 C380 785 610 865 872 816 C1130 768 1320 804 1600 748" />
        <g className="bp-mars-craters">
          <ellipse cx="126" cy="925" rx="75" ry="14" /><ellipse cx="126" cy="921" rx="52" ry="7" />
          <ellipse cx="654" cy="930" rx="94" ry="17" /><ellipse cx="654" cy="925" rx="66" ry="8" />
          <ellipse cx="1410" cy="902" rx="100" ry="18" /><ellipse cx="1410" cy="897" rx="72" ry="9" />
        </g>

      </svg>
    </div>
  );
}
