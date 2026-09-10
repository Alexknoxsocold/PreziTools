export default function FooterPreziSignal(){
  return <section aria-label="Prezi night signal" className="relative overflow-hidden border-t border-border/30 bg-[linear-gradient(180deg,#0a1020_0%,#07101d_55%,#050b14_100%)] min-h-[250px] sm:min-h-[320px]">
    <div className="pointer-events-none absolute inset-0 opacity-45" style={{backgroundImage:'radial-gradient(circle at 14% 24%,rgba(255,255,255,.85) 0 1px,transparent 1.3px),radial-gradient(circle at 72% 16%,rgba(191,219,254,.7) 0 1px,transparent 1.3px)',backgroundSize:'62px 62px,91px 91px'}}/>
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] opacity-85" style={{background:'linear-gradient(to top,#030711 0%,rgba(3,7,17,.96) 44%,transparent 100%)'}}/>

    <div className="absolute right-[10%] top-[14%] sm:right-[18%] sm:top-[12%] flex flex-col items-center">
      <div className="absolute top-[52px] h-[150px] w-[260px] origin-top rotate-[8deg] opacity-30 blur-md" style={{clipPath:'polygon(44% 0,56% 0,100% 100%,0 100%)',background:'linear-gradient(180deg,rgba(163,255,88,.75),rgba(80,255,100,0))'}}/>
      <div className="relative grid h-24 w-24 place-items-center rounded-full border border-lime-300/70 bg-lime-400/10 shadow-[0_0_22px_rgba(163,230,53,.7),0_0_70px_rgba(34,197,94,.3)] backdrop-blur-sm sm:h-28 sm:w-28">
        <div className="absolute inset-2 rounded-full border border-lime-300/35"/>
        <div className="text-center leading-none text-lime-200 drop-shadow-[0_0_8px_rgba(190,242,100,.8)]">
          <div className="mx-auto mb-1 h-5 w-7 border-b-2 border-lime-200 before:content-[''] before:block before:mx-auto before:h-3 before:w-5 before:border-x-2 before:border-t-2 before:border-lime-200 before:[clip-path:polygon(0_100%,18%_0,50%_55%,82%_0,100%_100%)]"/>
          <span className="text-base font-black tracking-[0.18em] sm:text-lg">PREZI</span>
        </div>
      </div>
    </div>

    <div className="absolute bottom-0 left-[5%] flex items-end gap-1 sm:left-[12%] sm:gap-3">
      <div className="relative h-44 w-28 sm:h-56 sm:w-36">
        <div className="absolute left-1/2 top-0 h-16 w-16 -translate-x-1/2 rounded-[45%_45%_38%_38%] bg-[#090b12] shadow-[0_0_20px_rgba(0,0,0,.65)] sm:h-20 sm:w-20">
          <span className="absolute -left-1 top-0 h-10 w-4 origin-bottom -rotate-6 bg-[#090b12] [clip-path:polygon(50%_0,100%_100%,0_100%)] sm:h-12"/>
          <span className="absolute -right-1 top-0 h-10 w-4 origin-bottom rotate-6 bg-[#090b12] [clip-path:polygon(50%_0,100%_100%,0_100%)] sm:h-12"/>
          <span className="absolute right-2 top-8 h-1.5 w-5 -rotate-12 rounded-full bg-slate-200/75 sm:top-10"/>
        </div>
        <div className="absolute bottom-0 left-1/2 h-36 w-full -translate-x-1/2 rounded-t-[46%] bg-[linear-gradient(120deg,#080a11_0%,#111521_45%,#05070c_100%)] sm:h-44"/>
        <div className="absolute bottom-0 -left-8 h-32 w-24 -rotate-12 rounded-t-[80%] bg-[#05070c] opacity-95 sm:h-40 sm:w-28"/>
      </div>

      <div className="relative h-36 w-24 sm:h-48 sm:w-32">
        <div className="absolute left-1/2 top-2 h-14 w-14 -translate-x-1/2 rotate-6 rounded-[48%_52%_44%_44%] bg-[#64b955] sm:h-17 sm:w-17">
          <span className="absolute -left-2 top-6 h-5 w-4 bg-[#64b955] [clip-path:polygon(100%_0,100%_100%,0_55%)]"/>
          <span className="absolute -right-2 top-6 h-5 w-4 bg-[#64b955] [clip-path:polygon(0_0,0_100%,100%_55%)]"/>
          <span className="absolute left-2 top-0 h-5 w-9 -rotate-6 bg-[#173c46] [clip-path:polygon(0_100%,8%_35%,24%_72%,39%_0,55%_65%,74%_12%,100%_100%)]"/>
          <span className="absolute right-1 top-7 h-1.5 w-4 -rotate-12 rounded-full bg-sky-100/80"/>
        </div>
        <div className="absolute bottom-0 left-1/2 h-24 w-full -translate-x-1/2 rounded-t-[42%] bg-[linear-gradient(150deg,#53256f,#29153d_58%,#12101b)] sm:h-32"/>
      </div>
    </div>

    <div className="absolute inset-x-0 bottom-0 h-6 bg-[#030711] shadow-[0_-12px_30px_rgba(0,0,0,.45)]"/>
  </section>;
}
