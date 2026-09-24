export default function BestPlaysSportsSky() {
  return (
    <div className="bp-sports-sky pointer-events-none absolute inset-x-0 bottom-0" aria-hidden="true">
      <svg viewBox="0 0 1600 430" preserveAspectRatio="xMidYMax slice" role="presentation">
        <defs>
          <linearGradient id="bpMarsGround" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b4533c" stopOpacity=".5" />
            <stop offset=".42" stopColor="#7c2d32" stopOpacity=".45" />
            <stop offset="1" stopColor="#240f24" stopOpacity=".72" />
          </linearGradient>
          <radialGradient id="bpMarsGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#fb923c" stopOpacity=".75" />
            <stop offset=".5" stopColor="#ef4444" stopOpacity=".24" />
            <stop offset="1" stopColor="#ef4444" stopOpacity="0" />
          </radialGradient>
          <filter id="bpSkyGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        <ellipse className="bp-mars-sun" cx="1285" cy="185" rx="170" ry="120" fill="url(#bpMarsGlow)" />
        <path className="bp-mars-ridge bp-mars-ridge-back" d="M0 347 C110 322 190 330 278 307 C385 280 482 322 575 302 C690 278 788 329 875 305 C985 276 1073 300 1172 278 C1284 253 1397 301 1600 263 L1600 430 L0 430 Z" />
        <path className="bp-mars-ridge" fill="url(#bpMarsGround)" d="M0 366 C128 334 240 374 350 340 C470 304 576 368 700 338 C825 307 920 366 1038 330 C1154 295 1258 359 1378 318 C1462 289 1531 306 1600 294 L1600 430 L0 430 Z" />
        <g className="bp-mars-craters">
          <ellipse cx="110" cy="386" rx="68" ry="13" /><ellipse cx="110" cy="383" rx="50" ry="7" />
          <ellipse cx="612" cy="382" rx="86" ry="16" /><ellipse cx="612" cy="378" rx="62" ry="8" />
          <ellipse cx="1398" cy="369" rx="94" ry="17" /><ellipse cx="1398" cy="365" rx="69" ry="9" />
        </g>

        <g className="bp-plane" transform="translate(-190 102)">
          <path d="M0 10 L72 6 L111 -4 L120 2 L95 9 L122 17 L112 22 L72 14 L7 18 L0 14 L39 10 Z" />
          <path d="M49 8 L66 -13 L74 -13 L68 8 M46 16 L60 31 L68 30 L64 14" />
        </g>

        <g className="bp-meteor-impact bp-impact-one">
          <path className="bp-impact-trail" d="M1130 92 L1262 286" />
          <circle className="bp-impact-core" cx="1262" cy="286" r="6" />
          <circle className="bp-impact-ring" cx="1262" cy="286" r="16" />
          <path className="bp-impact-dust" d="M1215 309 Q1262 274 1312 310 M1230 319 Q1260 292 1297 318" />
        </g>
        <g className="bp-meteor-impact bp-impact-two">
          <path className="bp-impact-trail" d="M330 112 L424 300" />
          <circle className="bp-impact-core" cx="424" cy="300" r="5" />
          <circle className="bp-impact-ring" cx="424" cy="300" r="13" />
        </g>

        <g className="bp-sport-figure bp-football" transform="translate(174 280)">
          <circle cx="28" cy="11" r="9" />
          <path d="M27 22 L33 60 L16 91 M33 60 L55 89 M31 34 L57 43 L77 31 M30 37 L12 56" />
          <path className="bp-sport-motion" d="M89 24 Q172 -42 254 15" />
          <path className="bp-football-ball" d="M82 25 Q90 20 98 25 Q90 34 82 25 Z" />
        </g>

        <g className="bp-sport-figure bp-basketball" transform="translate(665 270)">
          <circle cx="34" cy="13" r="9" />
          <path className="bp-ponytail" d="M27 9 Q14 10 17 24" />
          <path d="M33 25 L35 64 L18 96 M35 64 L58 94 M34 37 L58 18 L76 7 M33 38 L20 54" />
          <g className="bp-basketball-ball">
            <circle className="bp-ball-core" cx="80" cy="3" r="10" />
            <path className="bp-ball-seams" d="M70 3 H90 M80 -7 V13 M73 -3 Q80 3 87 9 M73 9 Q80 3 87 -3" />
          </g>
          <path className="bp-sport-motion bp-basketball-arc" d="M81 3 Q154 -60 238 27" />
          <path d="M249 18 L249 100 M219 29 L263 29 M222 30 Q241 54 260 30" />
        </g>

        <g className="bp-sport-figure bp-baseball" transform="translate(1092 280)">
          <circle cx="38" cy="12" r="9" />
          <path d="M37 24 L42 60 L23 91 M42 60 L68 86 M39 34 L64 48 L89 31 M39 35 L57 20" />
          <path className="bp-baseball-bat" d="M56 21 L103 -7" />
          <g className="bp-baseball-ball">
            <path className="bp-baseball-comet" d="M75 -12 H109" />
            <circle className="bp-ball-core" cx="110" cy="-12" r="6" />
            <path className="bp-ball-seams" d="M106 -16 Q110 -12 106 -8 M114 -16 Q110 -12 114 -8" />
          </g>
          <path className="bp-sport-motion bp-baseball-arc" d="M112 -13 Q210 -88 324 -20" />
          <g transform="translate(102 -8)">
            <g className="bp-contact-spark">
              <path d="M-13 0 H13 M0 -13 V13 M-9 -9 L9 9 M-9 9 L9 -9" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
