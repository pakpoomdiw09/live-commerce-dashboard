// Default: authenticated queue inspection only. --send actually drains due jobs.
const path=require('node:path')
require('@next/env').loadEnvConfig(path.resolve(__dirname,'..'),true,{info(){},error(){}})
;(async()=>{
 const args=process.argv.slice(2),send=args.includes('--send')
 const base=args.find(arg=>!arg.startsWith('--'))||process.env.CRON_BASE_URL||'http://localhost:3000'
 const url=new URL(base)
 if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)
  ||(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Use an HTTPS origin, or localhost for development')
 const secret=process.env.CRON_SECRET?.trim()||process.env.INTERNAL_API_SECRET?.trim()||''
 if(!secret)throw new Error('Set CRON_SECRET in the local environment and deployment first')
 url.pathname='/api/cron/follow-ups';url.search=send?'':'?dryRun=1'
 console.log(send?'LIVE: processing due follow-up jobs':'DRY RUN: inspecting the queue without claiming or sending')
 const response=await fetch(url,{method:send?'POST':'GET',headers:{Authorization:`Bearer ${secret}`},redirect:'error',signal:AbortSignal.timeout(55000)})
 if(!response.ok)throw new Error(`Cron HTTP ${response.status}; check deployment URL, CRON_SECRET and server logs`)
 const result=await response.json()
 if(send){if(typeof result.sent!=='number')throw new Error('Unexpected worker response');console.log(JSON.stringify({sent:result.sent,cancelled:result.cancelled,failed:result.failed,review:result.review,skipped:result.skipped,remaining:result.remaining}))}
 else {if(result.dryRun!==true)throw new Error('Unexpected dry-run response');console.log(JSON.stringify({dryRun:true,nowUTC:result.nowUTC,hasDueJobs:result.hasDueJobs,nextDueJob:result.nextDueJob}))}
})().catch(error=>{console.error(error instanceof Error?error.message:'Cron test failed');process.exitCode=1})
