import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Settings, Save, RotateCw, Loader2, Lock, Target, CheckCircle2, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Game {
  id: string;
  awayTeam: string;
  homeTeam: string;
  gameTime: string;
  awayStarters: string[];
  homeStarters: string[];
}

interface PlayerStat {
  id: string;
  player: string;
  team: string;
  position: string;
}

interface EspnPlayerStat {
  player: string;
  team: string;
  gamesPlayed: number;
  firstBasketPct: number;
  firstBasketsScored?: number;
}

interface FbTracking {
  id: string;
  playerName: string;
  team: string;
  fbScored: number;
  gamesTracked: number;
  season: string;
  lastUpdated: string | null;
}

interface ProcessedGame {
  id: string;
  espnGameId: string;
  firstScorer: string | null;
  firstScorerTeam: string | null;
  processedAt: string;
}

const ADMIN_AUTH_KEY = "adminAuthenticated";

function AdminPasswordGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        onAuthenticated();
      } else {
        setError("Incorrect password. Please try again.");
        setPassword("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <CardTitle>Admin Access</CardTitle>
          <CardDescription>Enter the admin password to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                data-testid="input-admin-password"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" data-testid="text-admin-error">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading || !password} data-testid="button-admin-submit">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Enter"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function FbTrackerTab({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { toast } = useToast();
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});
  const [showProcessed, setShowProcessed] = useState(false);
  const [bulkPlayer, setBulkPlayer] = useState("");
  const [bulkTeam, setBulkTeam] = useState("");
  const [bulkCount, setBulkCount] = useState("");

  const { data: espnStats, isLoading: espnLoading } = useQuery<EspnPlayerStat[]>({
    queryKey: ["/api/espn-player-stats"],
    enabled: isAuthenticated,
  });

  const { data: fbTracking, isLoading: trackingLoading } = useQuery<FbTracking[]>({
    queryKey: ["/api/fb-tracking"],
    enabled: isAuthenticated,
  });

  const { data: processedGames } = useQuery<ProcessedGame[]>({
    queryKey: ["/api/admin/fb-tracking/processed-games"],
    enabled: isAuthenticated && showProcessed,
  });

  const upsertMutation = useMutation({
    mutationFn: async ({ playerName, team, fbScored }: { playerName: string; team: string; fbScored: number }) => {
      return apiRequest("POST", "/api/admin/fb-tracking", { playerName, team, fbScored });
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fb-tracking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/espn-player-stats"] });
      toast({ title: "Saved", description: `${vars.playerName} updated to ${vars.fbScored} FB scored` });
      setEditingValues(prev => {
        const copy = { ...prev };
        delete copy[`${vars.playerName}__${vars.team}`];
        return copy;
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save. Please try again.", variant: "destructive" });
    },
  });

  const autoTrackerMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/run-auto-tracker", {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/fb-tracking"] });
      queryClient.invalidateQueries({ queryKey: ["/api/espn-player-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/fb-tracking/processed-games"] });
      toast({
        title: data.processed > 0 ? `✓ ${data.processed} game(s) tracked!` : "No new games",
        description: data.message,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Auto-tracker failed. Check server logs.", variant: "destructive" });
    },
  });

  // Build map of existing DB entries for quick lookup
  const trackingMap: Record<string, FbTracking> = {};
  (fbTracking || []).forEach(r => { trackingMap[`${r.playerName}__${r.team}`] = r; });

  // Merge ESPN players with DB tracking
  const allPlayers = espnStats || [];

  const getKey = (player: string, team: string) => `${player}__${team}`;

  const handleSave = (player: string, team: string) => {
    const key = getKey(player, team);
    const val = editingValues[key];
    if (val === undefined || val === "") return;
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 0) {
      toast({ title: "Invalid value", description: "Enter a number ≥ 0", variant: "destructive" });
      return;
    }
    upsertMutation.mutate({ playerName: player, team, fbScored: num });
  };

  const handleBulkAdd = () => {
    if (!bulkPlayer.trim() || !bulkTeam.trim() || bulkCount === "") {
      toast({ title: "Missing fields", description: "Fill in all three fields", variant: "destructive" });
      return;
    }
    const num = parseInt(bulkCount, 10);
    if (isNaN(num) || num < 0) {
      toast({ title: "Invalid count", description: "Enter a number ≥ 0", variant: "destructive" });
      return;
    }
    upsertMutation.mutate({ playerName: bulkPlayer.trim(), team: bulkTeam.trim().toUpperCase(), fbScored: num });
    setBulkPlayer("");
    setBulkTeam("");
    setBulkCount("");
  };

  if (espnLoading || trackingLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Auto-Tracker Control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCw className="h-4 w-4 text-green-500" />
            Auto First-Basket Tracker
          </CardTitle>
          <CardDescription>
            Checks ESPN play-by-play for any completed games today, finds who scored first, and automatically increments their count. Runs automatically every 30 min from 6 PM – 2 AM ET. Click to run it now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => autoTrackerMutation.mutate()}
            disabled={autoTrackerMutation.isPending}
            data-testid="button-run-auto-tracker"
          >
            {autoTrackerMutation.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Scanning ESPN...</>
            ) : (
              <><RotateCw className="h-4 w-4 mr-2" />Run Auto-Tracker Now</>
            )}
          </Button>
          {autoTrackerMutation.isSuccess && (
            <p className="text-sm text-muted-foreground mt-3">
              {(autoTrackerMutation.data as any)?.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-blue-500" />
            Add / Update Player
          </CardTitle>
          <CardDescription>
            Manually set a player's current FB scored count. Use this to seed historical data or correct any auto-tracked values.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5 flex-1 min-w-[160px]">
              <Label className="text-xs">Player Name</Label>
              <Input
                placeholder="e.g. Nikola Jokic"
                value={bulkPlayer}
                onChange={e => setBulkPlayer(e.target.value)}
                data-testid="input-bulk-player"
              />
            </div>
            <div className="space-y-1.5 w-24">
              <Label className="text-xs">Team</Label>
              <Input
                placeholder="DEN"
                value={bulkTeam}
                onChange={e => setBulkTeam(e.target.value.toUpperCase())}
                data-testid="input-bulk-team"
              />
            </div>
            <div className="space-y-1.5 w-24">
              <Label className="text-xs">FB Scored</Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
                value={bulkCount}
                onChange={e => setBulkCount(e.target.value)}
                data-testid="input-bulk-count"
              />
            </div>
            <Button
              onClick={handleBulkAdd}
              disabled={upsertMutation.isPending}
              data-testid="button-bulk-save"
            >
              {upsertMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today's Players — Quick Edit</CardTitle>
          <CardDescription>
            {allPlayers.length} players in today's games. DB icon = count saved to database.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {allPlayers.length === 0 && (
              <p className="text-sm text-muted-foreground p-4">No players found for today's games.</p>
            )}
            {allPlayers.map(p => {
              const key = getKey(p.player, p.team);
              const dbRecord = trackingMap[key];
              const currentDb = dbRecord?.fbScored;
              const editVal = editingValues[key];
              const displayVal = editVal !== undefined ? editVal : (currentDb !== undefined ? String(currentDb) : "");
              const hasDbValue = currentDb !== undefined;

              return (
                <div key={key} className="flex items-center gap-3 px-4 py-2.5" data-testid={`row-fbtrack-${key}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{p.player}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{p.team}</Badge>
                      {hasDbValue && (
                        <Badge className="text-[10px] px-1.5 h-4 bg-blue-900/60 text-blue-300 border border-blue-700/40 no-default-active-elevate">
                          <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                          DB: {currentDb}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {p.gamesPlayed} GP · {Math.round(p.firstBasketPct)}% FB rate
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      className="w-20 h-8 text-sm text-center"
                      placeholder={hasDbValue ? String(currentDb) : "—"}
                      value={displayVal}
                      onChange={e => setEditingValues(prev => ({ ...prev, [key]: e.target.value }))}
                      data-testid={`input-fbscored-${key}`}
                    />
                    <Button
                      size="sm"
                      variant={editVal !== undefined && editVal !== "" ? "default" : "outline"}
                      onClick={() => handleSave(p.player, p.team)}
                      disabled={upsertMutation.isPending || (editVal === undefined || editVal === "")}
                      data-testid={`button-save-fbscored-${key}`}
                    >
                      <Save className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <button
            className="flex items-center justify-between w-full"
            onClick={() => setShowProcessed(!showProcessed)}
            data-testid="button-toggle-processed"
          >
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Auto-Tracked Game Log</CardTitle>
            </div>
            {showProcessed ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          <CardDescription>Games automatically processed after they completed</CardDescription>
        </CardHeader>
        {showProcessed && (
          <CardContent className="p-0">
            {!processedGames || processedGames.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No games auto-processed yet. This fills in as tonight's games finish.</p>
            ) : (
              <div className="divide-y">
                {[...processedGames].reverse().map(g => (
                  <div key={g.id} className="px-4 py-2.5 flex items-center gap-3" data-testid={`row-processed-${g.espnGameId}`}>
                    <div className="flex-1 min-w-0">
                      {g.firstScorer ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          <span className="text-sm font-medium">{g.firstScorer}</span>
                          {g.firstScorerTeam && <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{g.firstScorerTeam}</Badge>}
                          <span className="text-xs text-muted-foreground">scored first</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">Game {g.espnGameId} — scorer not detected</span>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        ESPN #{g.espnGameId} · {new Date(g.processedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export default function Admin() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"lineups" | "fb-tracker">("lineups");
  const [editingGame, setEditingGame] = useState<string | null>(null);
  const [localLineups, setLocalLineups] = useState<Record<string, { away: string[], home: string[] }>>({});
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    const cachedAuth = sessionStorage.getItem(ADMIN_AUTH_KEY) === "true";
    if (!cachedAuth) {
      setSessionChecked(true);
      return;
    }
    fetch("/api/admin/session")
      .then(r => r.json())
      .then(data => {
        if (data.isAdmin) {
          setIsAuthenticated(true);
        } else {
          sessionStorage.removeItem(ADMIN_AUTH_KEY);
        }
      })
      .catch(() => sessionStorage.removeItem(ADMIN_AUTH_KEY))
      .finally(() => setSessionChecked(true));
  }, []);

  const { data: games, isLoading: gamesLoading } = useQuery<Game[]>({
    queryKey: ["/api/games"],
    enabled: isAuthenticated && activeTab === "lineups",
  });

  const { data: playerStats, isLoading: playersLoading } = useQuery<PlayerStat[]>({
    queryKey: ["/api/player-stats"],
    enabled: isAuthenticated && activeTab === "lineups",
  });

  const updateLineupMutation = useMutation({
    mutationFn: async ({ gameId, lineups }: { gameId: string; lineups: { awayStarters: string[], homeStarters: string[] } }) => {
      return apiRequest("PUT", `/api/games/${gameId}/lineups`, lineups);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      queryClient.invalidateQueries({ queryKey: ["/api/today-starters"] });
      toast({ title: "Lineups Updated", description: "Starting lineups have been saved successfully." });
      setEditingGame(null);
    },
    onError: () => {
      toast({ title: "Update Failed", description: "Failed to update lineups. Please try again.", variant: "destructive" });
    },
  });

  if (!sessionChecked) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <AdminPasswordGate
        onAuthenticated={() => {
          sessionStorage.setItem(ADMIN_AUTH_KEY, "true");
          setIsAuthenticated(true);
        }}
      />
    );
  }

  const todayGames = games?.filter(g => g.gameTime?.includes(new Date().toISOString().split('T')[0])) || [];

  const getPlayersByTeam = (team: string) => playerStats?.filter(p => p.team === team) || [];

  const handleStartEdit = (gameId: string, game: Game) => {
    setEditingGame(gameId);
    setLocalLineups({
      ...localLineups,
      [gameId]: {
        away: Array.isArray(game.awayStarters) ? game.awayStarters : ['', '', '', '', ''],
        home: Array.isArray(game.homeStarters) ? game.homeStarters : ['', '', '', '', ''],
      }
    });
  };

  const handlePlayerSelect = (gameId: string, team: 'away' | 'home', index: number, player: string) => {
    setLocalLineups({
      ...localLineups,
      [gameId]: {
        ...localLineups[gameId],
        [team]: [
          ...localLineups[gameId][team].slice(0, index),
          player,
          ...localLineups[gameId][team].slice(index + 1),
        ]
      }
    });
  };

  const handleSave = (gameId: string) => {
    const lineups = localLineups[gameId];
    if (!lineups || lineups.away.length !== 5 || lineups.home.length !== 5) {
      toast({ title: "Invalid Lineups", description: "Each team must have exactly 5 starters selected.", variant: "destructive" });
      return;
    }
    const allStarters = [...lineups.away, ...lineups.home];
    if (allStarters.some(name => !name || name.trim() === '')) {
      toast({ title: "Incomplete Lineups", description: "All 5 starter slots must be filled for both teams.", variant: "destructive" });
      return;
    }
    if (new Set(lineups.away).size !== 5 || new Set(lineups.home).size !== 5) {
      toast({ title: "Duplicate Players", description: "Each player can only start once per team.", variant: "destructive" });
      return;
    }
    updateLineupMutation.mutate({ gameId, lineups: { awayStarters: lineups.away, homeStarters: lineups.home } });
  };

  const hasDuplicates = (gameId: string): boolean => {
    const lineups = localLineups[gameId];
    if (!lineups) return false;
    const awayFilled = lineups.away.filter(n => n && n.trim() !== '');
    const homeFilled = lineups.home.filter(n => n && n.trim() !== '');
    return new Set(awayFilled).size !== awayFilled.length || new Set(homeFilled).size !== homeFilled.length;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8" />
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-admin-title">Admin Panel</h1>
          <p className="text-muted-foreground">Manage lineups and first basket tracking</p>
        </div>
      </div>

      <nav aria-label="Model diagnostics" className="flex flex-wrap gap-4 text-sm text-primary underline">
        <Link href="/admin/fb-diagnostics">NBA diagnostics</Link>
        <Link href="/admin/wnba-diagnostics">WNBA diagnostics</Link>
        <Link href="/admin/mlb-diagnostics">MLB diagnostics</Link>
      </nav>

      <div className="flex gap-2 border-b pb-0">
        <button
          onClick={() => setActiveTab("lineups")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === "lineups" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          data-testid="tab-lineups"
        >
          Lineup Management
        </button>
        <button
          onClick={() => setActiveTab("fb-tracker")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activeTab === "fb-tracker" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          data-testid="tab-fb-tracker"
        >
          <Target className="h-3.5 w-3.5" />
          FB Tracker
        </button>
      </div>

      {activeTab === "fb-tracker" && (
        <FbTrackerTab isAuthenticated={isAuthenticated} />
      )}

      {activeTab === "lineups" && (
        <>
          {(gamesLoading || playersLoading) ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : todayGames.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">No games scheduled for today</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {todayGames.map((game) => {
                const isEditing = editingGame === game.id;
                const awayPlayers = getPlayersByTeam(game.awayTeam);
                const homePlayers = getPlayersByTeam(game.homeTeam);
                const currentLineups = isEditing && localLineups[game.id] ? localLineups[game.id] : {
                  away: Array.isArray(game.awayStarters) ? game.awayStarters : ['', '', '', '', ''],
                  home: Array.isArray(game.homeStarters) ? game.homeStarters : ['', '', '', '', ''],
                };

                return (
                  <Card key={game.id} data-testid={`card-game-${game.id}`}>
                    <CardHeader>
                      <div className="flex items-center justify-between gap-1">
                        <div>
                          <CardTitle className="text-lg">{game.awayTeam} @ {game.homeTeam}</CardTitle>
                          <CardDescription>
                            {new Date(game.gameTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET
                          </CardDescription>
                        </div>
                        {!isEditing && (
                          <Button variant="outline" onClick={() => handleStartEdit(game.id, game)} data-testid={`button-edit-${game.id}`}>
                            Edit Lineups
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {(['away', 'home'] as const).map(side => {
                          const teamAbbr = side === 'away' ? game.awayTeam : game.homeTeam;
                          const players = side === 'away' ? awayPlayers : homePlayers;
                          return (
                            <div key={side}>
                              <div className="flex items-center gap-2 mb-3">
                                <Badge variant="secondary">{teamAbbr}</Badge>
                                <span className="text-sm font-medium">{side === 'away' ? 'Away' : 'Home'} Starters</span>
                              </div>
                              <div className="space-y-2">
                                {[0, 1, 2, 3, 4].map((index) => (
                                  <div key={index} className="flex items-center gap-2">
                                    <span className="text-sm text-muted-foreground w-4">{index + 1}.</span>
                                    {isEditing ? (
                                      <Select
                                        value={currentLineups[side][index] || ""}
                                        onValueChange={(value) => handlePlayerSelect(game.id, side, index, value)}
                                      >
                                        <SelectTrigger className="flex-1" data-testid={`select-${side}-${index}-${game.id}`}>
                                          <SelectValue placeholder="Select player" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {players.map((player) => (
                                            <SelectItem key={player.id} value={player.player}>
                                              {player.player} ({player.position})
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    ) : (
                                      <span className="text-sm">{currentLineups[side][index] || '—'}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {isEditing && (
                        <div className="flex gap-2 mt-4 pt-4 border-t">
                          <Button
                            onClick={() => handleSave(game.id)}
                            disabled={updateLineupMutation.isPending || hasDuplicates(game.id)}
                            data-testid={`button-save-${game.id}`}
                          >
                            {updateLineupMutation.isPending ? (
                              <><RotateCw className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                            ) : (
                              <><Save className="h-4 w-4 mr-2" />Save Lineups</>
                            )}
                          </Button>
                          <Button variant="outline" onClick={() => setEditingGame(null)} disabled={updateLineupMutation.isPending} data-testid={`button-cancel-${game.id}`}>
                            Cancel
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
