/** Serial, visibility-aware background refresh with bounded failure backoff. */
export function createBackgroundRefresh(
 task:(signal:AbortSignal)=>Promise<unknown>,
 onError:(error:unknown)=>void,
 options:{intervalMs?:number;minGapMs?:number;visible?:()=>boolean}={},
){
 const interval=options.intervalMs??60000,gap=options.minGapMs??3000
 const visible=options.visible??(()=>document.visibilityState!=='hidden')
 const controller=new AbortController()
 let timer:ReturnType<typeof setTimeout>|undefined,running=false,dirty=false,stopped=false,last=0,failures=0
 const delay=()=>failures?Math.min(300000,30000*2**(failures-1)):gap
 const schedule=(milliseconds:number)=>{
  clearTimeout(timer)
  if(!stopped)timer=setTimeout(()=>{timer=undefined;void run()},milliseconds)
 }
 const run=async()=>{
  if(stopped)return
  if(!visible()){schedule(interval);return}
  if(running){dirty=true;return}
  running=true;last=Date.now();dirty=false
  try{await task(controller.signal);failures=0}
  catch(error){failures=Math.min(failures+1,5);if(!stopped)onError(error)}
  finally{running=false;if(!stopped)schedule(dirty?Math.max(0,delay()-(Date.now()-last)):failures?delay():interval)}
 }
 const request=()=>{
  if(stopped)return
  if(running){dirty=true;return}
  schedule(Math.max(0,delay()-(Date.now()-last)))
 }
 return {request,stop(){stopped=true;clearTimeout(timer);controller.abort()}}
}
