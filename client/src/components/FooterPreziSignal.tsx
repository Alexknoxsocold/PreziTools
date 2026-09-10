import mascotArtwork from '@/assets/85F46A4B-0441-496D-93AC-B5048B1115BE.png';

export default function FooterPreziSignal(){
  return <section aria-label="Prezi mascot" className="relative overflow-hidden border-t border-border/30 bg-[linear-gradient(180deg,#08101d_0%,#07101a_45%,#050a12_100%)]">
    <div className="pointer-events-none absolute inset-0 opacity-30" style={{backgroundImage:'radial-gradient(circle at 14% 28%,rgba(255,255,255,.8) 0 1px,transparent 1.3px),radial-gradient(circle at 74% 18%,rgba(191,219,254,.7) 0 1px,transparent 1.3px)',backgroundSize:'68px 68px,96px 96px'}}/>
    <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lime-400/10 blur-3xl sm:h-80 sm:w-80"/>

    <div className="relative mx-auto flex min-h-[280px] max-w-7xl items-end justify-center px-4 pt-8 sm:min-h-[360px] sm:px-6 sm:pt-10 lg:px-8">
      <div className="relative w-full max-w-[760px] overflow-hidden rounded-t-[34px] border-x border-t border-white/10 bg-white/[0.025] shadow-[0_-20px_70px_rgba(0,0,0,.35)] backdrop-blur-sm sm:rounded-t-[44px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-[#08101d] via-[#08101d]/45 to-transparent"/>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-[#050a12] via-[#050a12]/55 to-transparent"/>
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#07101a] to-transparent sm:w-28"/>
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#07101a] to-transparent sm:w-28"/>

        <img
          src={mascotArtwork}
          alt="Prezi mascot"
          className="block h-[270px] w-full object-cover object-[50%_44%] opacity-95 sm:h-[350px] sm:object-[50%_46%]"
        />

        <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-lime-300/25 bg-black/45 px-4 py-2 text-[10px] font-black tracking-[0.22em] text-lime-100 shadow-[0_0_30px_rgba(132,204,22,.16)] backdrop-blur-md sm:bottom-7 sm:px-5 sm:py-2.5 sm:text-xs">
          PREZI TOOLS
        </div>
      </div>
    </div>
  </section>;
}
