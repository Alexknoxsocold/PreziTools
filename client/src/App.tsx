import { Switch, Route, Link } from "wouter";
import { lazy, Suspense, useState } from "react";
import { queryClient } from "./lib/queryClient";
import "./nrfi-premium.css";
import "./best-plays-fullscreen.css";
import "./wnba-tip-glow.css";
import "./wnba-first-basket-compact.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { BillingProvider } from "@/context/BillingContext";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import Header from "@/components/Header";
import Navigation from "@/components/Navigation";
import SplashScreen from "@/components/SplashScreen";
import PlanWelcome from "@/components/PlanWelcome";
import { Skeleton } from "@/components/ui/skeleton";

const BestPlays = lazy(() => import("@/pages/BestPlaysHub"));
const NBA = lazy(() => import("@/pages/NBA"));
const WNBA = lazy(() => import("@/pages/WNBAHiddenHistory"));
const NFL = lazy(() => import("@/pages/NFL"));
const NFLPerformance = lazy(() => import("@/pages/NFLPerformance"));
const OpeningTips = lazy(() => import("@/pages/OpeningTips"));
const PlayerStats = lazy(() => import("@/pages/PlayerStats"));
const TeamStats = lazy(() => import("@/pages/TeamStats"));
const Admin = lazy(() => import("@/pages/Admin"));
const AdminMlbDiagnostics = lazy(() => import("@/pages/AdminMlbDiagnostics"));
const AdminFbDiagnostics = lazy(() => import("@/pages/AdminFbDiagnostics"));
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));
const Invite = lazy(() => import("@/pages/Invite"));
const MLB = lazy(() => import("@/pages/MLB"));
const NRFICalibration = lazy(() => import("@/pages/NRFICalibration"));
const MLBHrPerformance = lazy(() => import("@/pages/MLBHrPerformance"));
const Legal = lazy(() => import("@/pages/Legal"));
const NotFound = lazy(() => import("@/pages/not-found"));

function RouteFallback() { return <div className="space-y-4" role="status" aria-live="polite" aria-label="Loading page"><Skeleton className="h-8 w-56"/><Skeleton className="h-24 w-full"/><Skeleton className="h-64 w-full"/><span className="sr-only">Loading page…</span></div>; }
function Router(){return <Suspense fallback={<RouteFallback/>}><Switch><Route path="/signup" component={Signup}/><Route path="/login" component={Login}/><Route path="/invite" component={Invite}/><Route path="/" component={BestPlays}/><Route path="/nba" component={NBA}/><Route path="/wnba" component={WNBA}/><Route path="/nfl/performance" component={NFLPerformance}/><Route path="/nfl" component={NFL}/><Route path="/opening-tips" component={OpeningTips}/><Route path="/player-stats" component={PlayerStats}/><Route path="/team-stats" component={TeamStats}/><Route path="/mlb/home-runs/performance" component={MLBHrPerformance}/><Route path="/mlb/calibration" component={NRFICalibration}/><Route path="/mlb/home-runs" component={MLB}/><Route path="/mlb" component={MLB}/><Route path="/legal" component={Legal}/><Route path="/admin/mlb-diagnostics" component={AdminMlbDiagnostics}/><Route path="/admin/fb-diagnostics" component={AdminFbDiagnostics}/><Route path="/admin" component={Admin}/><Route component={NotFound}/></Switch></Suspense>}
function App(){const[splashDone,setSplashDone]=useState(false);return <AppErrorBoundary><QueryClientProvider client={queryClient}><AuthProvider><BillingProvider><TooltipProvider>{!splashDone&&<SplashScreen onDone={()=>setSplashDone(true)}/>} {splashDone&&<PlanWelcome/>}<a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-md bg-background px-3 py-2 text-sm font-semibold shadow-lg ring-2 ring-ring transition-transform focus:translate-y-0">Skip to main content</a><div className="min-h-screen bg-background flex flex-col"><Header/><Navigation/><main id="main-content" tabIndex={-1} className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 focus:outline-none"><Router/></main><footer className="border-t border-border/60 bg-background mt-6 sm:mt-8"><div className="max-w-7xl mx-auto px-4 md:px-6 lg:px-8 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><span className="text-xs text-muted-foreground">© 2027 PreziTools.</span><div className="flex flex-wrap items-center gap-x-4 gap-y-2"><Link href="/legal?tab=terms" className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm transition-colors">Terms of Service</Link><Link href="/legal?tab=privacy" className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm transition-colors">Privacy Policy</Link></div></div></footer></div><Toaster/></TooltipProvider></BillingProvider></AuthProvider></QueryClientProvider></AppErrorBoundary>}
export default App;
