import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Star, Clock, Zap } from "lucide-react";

interface EspnPick {
  player: string;
  team: string;
  headshot?: string;
  firstBasketPct: number;
  avgPoints: number;
  odds: string;
  isStarter?: boolean;
}

interface JumpBallPlayer {
  player: string;
  headshot?: string;
  position: string;
}

interface VerifiedFirstBasketResult {
  espnGameId: string;
  playerName: string;
  team: string;
  verifiedAt: string;
}

interface GameRowProps {
  awayTeam: string;
  awayPlayer: string;
  awayTipCount: number;
  awayTipPercent: number;
  awayScorePercent: number;
  homeTeam: string;
  homePlayer: string;
  homeTipCount: number;
  homeTipPercent: number;
  homeScorePercent: number;
  h2h: string;
  gameTime?: string;
  status?: string;
  awayStarters?: string[];
  homeStarters?: string[];
  awayPlayerHeadshot?: string;
  homePlayerHeadshot?: string;
  awayEspnPick?: EspnPick | null;
  homeEspnPick?: EspnPick | null;
  awayJumpBall?: JumpBallPlayer | null;
  homeJumpBall?: JumpBallPlayer | null;
  verifiedFirstBasket?: VerifiedFirstBasketResult | null;
  verifiedFirstBasketHeadshot?: string;
}

// ESPN team ID map for logo URLs
const ESPN_TEAM_IDS: Record<string, string> = {
  ATL: "1", BOS: "2", BKN: "17", CHA: "30", CHI: "4", CLE: "5",
  DAL: "6", DEN: "7", DET: "8", GS: "9", HOU: "10", IND: "11",
  LAC: "12", LAL: "13", MEM: "29", MIA: "14", MIL: "15", MIN: "16",
  NO: "3", NYK: "18", OKC: "25", ORL: "19", PHI: "20", PHX: "21",
  POR: "22", SAC: "23", SA: "24", TOR: "28", UTAH: "26", WSH: "27",
};

export function getTeamLogoUrl(team: string): string {
  const id = ESPN_TEAM_IDS[team];
  if (!id) return "";
  return `https://a.espncdn.com/i/teamlogos/nba/500/${id}.png`;
}

function TeamLogo({ team, size = "md" }: { team: string; size?: "sm" | "md" | "lg" }) {
  const logoUrl = getTeamLogoUrl(team);
  const sizeClass = size === "sm" ? "w-7 h-7" : size === "lg" ? "w-12 h-12" : "w-9 h-9";
  return (
    <div className={`${sizeClass} rounded-md bg-muted/40 flex items-center justify-center shrink-0 overflow-hidden`}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`${team} logo`}
          className="w-full h-full object-contain p-0.5"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className="text-[10px] font-bold text-muted-foreground">{team.slice(0, 3)}</span>
      )}
    </div>
  );
}

function ScoreBar({ percent, isFavorite, isTie }: { percent: number; isFavorite: boolean; isTie: boolean }) {
  const barColor = isTie
    ? "bg-muted-foreground/30"
    : isFavorite
      ? percent >= 65 ? "bg-green-500" : percent >= 55 ? "bg-primary" : "bg-primary/60"
      : "bg-red-500/40";
  const textColor = isTie
    ? "text-muted-foreground"
    : isFavorite ? "text-foreground" : "text-red-400";
  return (
    <div className="relative w-full h-7 rounded-md overflow-hidden bg-muted">
      <div
        className={`absolute inset-y-0 left-0 transition-all ${barColor}`}
        style={{ width: `${percent}%` }}
      />
      <div className="relative flex items-center h-full px-2 justify-between">
        <span className={`font-mono text-xs font-bold ${textColor}`}>
          {percent}%
        </span>
        {!isTie && isFavorite && percent >= 55 && (
          <Zap className="w-3 h-3 text-foreground opacity-60" />
        )}
      </div>
    </div>
  );
}

function PlayerPick({
  player,
  team,
  headshot,
  starters,
  tipPercent,
  isTopTip,
}: {
  player: string;
  team: string;
  headshot?: string;
  starters?: string[];
  tipPercent: number;
  isTopTip: boolean;
}) {
  const initials = player.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar className="w-9 h-9 shrink-0 ring-2 ring-border">
        <AvatarImage src={headshot} alt={player} className="object-cover object-top" />
        <AvatarFallback className="text-xs font-bold bg-muted">{initials}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-xs font-semibold truncate ${isTopTip ? "text-foreground" : "text-muted-foreground"}`} data-testid={`text-player-${player.replace(/\s+/g, '-')}`}>
            {player}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {team} &bull; Tip {tipPercent}%
        </div>
        {starters && starters.length > 0 && (
          <div className="text-[10px] text-muted-foreground/60 truncate max-w-[150px] hidden md:block">
            {starters.slice(0, 2).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GameRow({
  awayTeam, awayPlayer, awayTipCount, awayTipPercent, awayScorePercent,
  homeTeam, homePlayer, homeTipCount, homeTipPercent, homeScorePercent,
  h2h, gameTime, status, awayStarters, homeStarters,
  awayPlayerHeadshot, homePlayerHeadshot,
  awayEspnPick, homeEspnPick,
  awayJumpBall, homeJumpBall,
  verifiedFirstBasket, verifiedFirstBasketHeadshot,
}: GameRowProps) {
  // Use ESPN FB% if available, fallback to game scorePercent
  const awayDisplayPct = awayEspnPick ? awayEspnPick.firstBasketPct : awayScorePercent;
  const homeDisplayPct = homeEspnPick ? homeEspnPick.firstBasketPct : homeScorePercent;
  const hasEspn = !!(awayEspnPick || homeEspnPick);

  // Whether there's real user tip data (not just the 50/50 default)
  const hasRealTipData = awayTipCount > 0 || homeTipCount > 0;

  const topPickPercent = Math.max(awayDisplayPct, homeDisplayPct);
  const isFeatured = hasEspn ? topPickPercent >= 18 : topPickPercent >= 60;

  // Resolve display player names and headshots
  const awayDisplayPlayer = awayEspnPick?.player || awayPlayer;
  const homeDisplayPlayer = homeEspnPick?.player || homePlayer;
  const awayDisplayHeadshot = awayEspnPick?.headshot || awayPlayerHeadshot;
  const homeDisplayHeadshot = homeEspnPick?.headshot || homePlayerHeadshot;

  // H2H score bar: ESPN FB% with home-court advantage baked in.
  // NBA home teams win ~53% of tip-offs historically; weight accordingly.
  let scaledAwayPct: number;
  let scaledHomePct: number;
  if (hasEspn) {
    // Apply home-court factor: home team gets a 6% boost, away gets a 6% penalty
    const awayAdj = awayDisplayPct * 0.94;
    const homeAdj = homeDisplayPct * 1.06;
    const total = Math.max(awayAdj + homeAdj, 0.01);
    scaledAwayPct = Math.round((awayAdj / total) * 100);
    scaledHomePct = 100 - scaledAwayPct;
  } else if (hasRealTipData) {
    scaledAwayPct = awayTipPercent;
    scaledHomePct = homeTipPercent;
  } else {
    // No data at all — use historical home-court baseline (47/53)
    scaledAwayPct = 47;
    scaledHomePct = 53;
  }

  const isTie = scaledAwayPct === scaledHomePct;
  const awayIsTop = awayDisplayPct > homeDisplayPct;

  const formatGameTime = (time?: string) => {
    if (!time) return null;
    try {
      const d = new Date(time);
      if (isNaN(d.getTime())) return time;
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
    } catch {
      return time;
    }
  };

  return (
    <div
      className={`border-b last:border-b-0 hover-elevate transition-colors ${isFeatured ? "bg-primary/5" : ""}`}
      data-testid={`game-row-${awayTeam}-${homeTeam}`}
    >
      <div className="p-4">
        {/* Top row: time + badge */}
        {(gameTime || isFeatured) && (
          <div className="flex items-center gap-2 mb-3">
            {gameTime && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                <span className="font-mono">{formatGameTime(gameTime)}</span>
              </div>
            )}
            {isFeatured && (
              <Badge className="text-[10px] px-1.5 h-4 bg-primary/20 text-primary border-primary/30 gap-1 ml-auto">
                <Star className="w-2.5 h-2.5 fill-current" />
                TOP PICK
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px] whitespace-nowrap ml-auto" data-testid={`badge-h2h-${h2h}`}>
              H2H {h2h}
            </Badge>
          </div>
        )}

        {verifiedFirstBasket ? (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-emerald-400/80 bg-emerald-500/15 px-3 py-2.5 shadow-[0_0_16px_rgba(34,197,94,.7),0_0_38px_rgba(34,197,94,.34)] ring-1 ring-emerald-400/65">
            <Avatar className="h-10 w-10 shrink-0 ring-2 ring-emerald-400/80">
              <AvatarImage src={verifiedFirstBasketHeadshot} alt={verifiedFirstBasket.playerName} className="object-cover object-top" />
              <AvatarFallback className="bg-emerald-500/20 text-xs font-black text-emerald-200">
                {verifiedFirstBasket.playerName.split(" ").map((name) => name[0]).join("").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-black uppercase tracking-[.14em] text-emerald-500">✓ Verified First Basket</div>
              <div className="truncate text-sm font-black text-emerald-700 dark:text-emerald-200">{verifiedFirstBasket.playerName}</div>
            </div>
            <Badge className="border-emerald-300/70 bg-emerald-500 text-[9px] font-black text-white">{verifiedFirstBasket.team}</Badge>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_1fr] gap-4 items-center">

          {/* Teams column */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <TeamLogo team={awayTeam} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm leading-tight" data-testid={`text-away-team-${awayTeam}`}>{awayTeam}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Away{hasRealTipData ? ` \u2022 ${awayTipCount} tips` : ""}
                </div>
              </div>
              {hasRealTipData && (
                <div className={`font-mono text-sm font-bold ${awayTipPercent > homeTipPercent ? "text-primary" : awayTipPercent < homeTipPercent ? "text-red-400" : "text-muted-foreground"}`} data-testid={`text-tip-percent-${awayTeam}`}>
                  {awayTipPercent}%
                </div>
              )}
              {!hasRealTipData && hasEspn && (
                <div className={`font-mono text-sm font-bold ${scaledAwayPct > scaledHomePct ? "text-primary" : "text-red-400"}`} data-testid={`text-tip-percent-${awayTeam}`}>
                  {scaledAwayPct}%
                </div>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              <TeamLogo team={homeTeam} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm leading-tight" data-testid={`text-home-team-${homeTeam}`}>{homeTeam}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Home{hasRealTipData ? ` \u2022 ${homeTipCount} tips` : ""}
                </div>
              </div>
              {hasRealTipData && (
                <div className={`font-mono text-sm font-bold ${homeTipPercent > awayTipPercent ? "text-primary" : homeTipPercent < awayTipPercent ? "text-red-400" : "text-muted-foreground"}`} data-testid={`text-tip-percent-${homeTeam}`}>
                  {homeTipPercent}%
                </div>
              )}
              {!hasRealTipData && hasEspn && (
                <div className={`font-mono text-sm font-bold ${scaledHomePct > scaledAwayPct ? "text-primary" : "text-red-400"}`} data-testid={`text-tip-percent-${homeTeam}`}>
                  {scaledHomePct}%
                </div>
              )}
            </div>
          </div>

          {/* Jump Ball column */}
          <div className="flex flex-col gap-2.5 border rounded-md p-2.5 bg-background/50">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold mb-0.5">Jump Ball</div>
            {awayJumpBall ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="w-9 h-9 shrink-0 ring-2 ring-border">
                  <AvatarImage src={awayJumpBall.headshot} alt={awayJumpBall.player} className="object-cover object-top" />
                  <AvatarFallback className="text-xs font-bold bg-muted">{awayJumpBall.player.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-semibold truncate block text-foreground">{awayJumpBall.player}</span>
                  <div className="text-[10px] text-muted-foreground">{awayTeam} &bull; {awayJumpBall.position}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 h-9 text-[10px] text-muted-foreground">No data</div>
            )}
            <div className="border-t border-dashed" />
            {homeJumpBall ? (
              <div className="flex items-center gap-2.5 min-w-0">
                <Avatar className="w-9 h-9 shrink-0 ring-2 ring-border">
                  <AvatarImage src={homeJumpBall.headshot} alt={homeJumpBall.player} className="object-cover object-top" />
                  <AvatarFallback className="text-xs font-bold bg-muted">{homeJumpBall.player.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-semibold truncate block text-foreground">{homeJumpBall.player}</span>
                  <div className="text-[10px] text-muted-foreground">{homeTeam} &bull; {homeJumpBall.position}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 h-9 text-[10px] text-muted-foreground">No data</div>
            )}
          </div>

          {/* Score bars column */}
          <div className="flex flex-col gap-2">
            <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-semibold">
              {hasEspn ? "Top FB% Pick" : "1st to Score"}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <TeamLogo team={awayTeam} size="sm" />
                <div className="flex-1">
                  <ScoreBar percent={scaledAwayPct} isFavorite={awayIsTop} isTie={isTie} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TeamLogo team={homeTeam} size="sm" />
                <div className="flex-1">
                  <ScoreBar percent={scaledHomePct} isFavorite={!awayIsTop} isTie={isTie} />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
