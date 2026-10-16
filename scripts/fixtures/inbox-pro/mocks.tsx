// Browser test sandbox: no secrets, Supabase clients or real outbound requests.
import React from 'react'
export default function MockLink({children,href,...props}:React.ComponentProps<'a'>){return <a href={href} {...props}>{children}</a>}
export const useRouter=()=>({refresh(){},push(){},replace(){}})
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333']
export const customers=ids.map((id,i)=>({id,tenant_id:'test-shop',display_name:['ลูกค้า A','ลูกค้า B','ลูกค้า C'][i],platform_user_id:'test-'+i,bot_enabled:true,assigned_user_id:null as string|null,conversation_status:'open',conversation_version:0,inbound_seq:1,last_message_at:'2026-10-16T01:00:00Z',phone:null,address:null,tags:[],notes:null,order_status:'new',created_at:'2026-10-16T00:00:00Z',inbox_stage:'UNASSIGNED'}))
export const messages=customers.map((c,i)=>({id:'msg-'+i,customer_id:c.id,sender:'customer',body:'ข้อความของ '+c.display_name,attachments:[],created_at:'2026-10-16T01:00:00Z',inbound_seq:1}))
export const metrics={mutations:0,threadReads:0,channels:new Set<unknown>(),requests:[] as string[]}
const listeners=new Set<{table:string;event:string;handler:(event:unknown)=>void;channel:unknown}>()
export function replay(){for(const row of messages)for(let n=0;n<3;n++)for(const l of listeners)if(l.table==='messages'&&l.event==='INSERT')l.handler({new:row,eventType:'INSERT'})}
export function reconnect(){for(const channel of metrics.channels)(channel as {status:(value:string)=>void}).status('SUBSCRIBED')}
export function supabaseBrowser(){return db}
const db={from(table:string){const filters:Record<string,unknown>={};const q={select(){return q},eq(key:string,value:unknown){filters[key]=value;return q},order(){return q},limit(){return q},abortSignal(){return q},async maybeSingle(){return {data:customers.filter(c=>!filters.id||c.id===filters.id).map(c=>({...c,messages:messages.filter(m=>m.customer_id===c.id),slips:[]}))[0],error:null}},then(resolve:(value:unknown)=>void){if(table==='messages')metrics.threadReads++;const rows=table==='messages'?messages.filter(m=>m.customer_id===filters.customer_id):table==='customers'?customers.map(c=>({...c,messages:messages.filter(m=>m.customer_id===c.id),slips:[]})):[];setTimeout(()=>resolve({data:rows,error:null}),filters.customer_id===ids[0]?80:filters.customer_id===ids[1]?40:5)}};return q},channel(){const channel={status(_value:string){},on(_kind:string,filter:{table:string;event:string},handler:(value:unknown)=>void){listeners.add({...filter,handler,channel});return channel},subscribe(callback:(value:string)=>void){channel.status=callback;metrics.channels.add(channel);setTimeout(()=>{if(metrics.channels.has(channel))callback('SUBSCRIBED')},0);return channel}};return channel},async removeChannel(channel:unknown){metrics.channels.delete(channel);for(const l of listeners)if(l.channel===channel)listeners.delete(l)}}
export function installFetch(){window.fetch=(async(input:RequestInfo|URL,options?:RequestInit)=>{
 const url=String(input);metrics.requests.push(url)
 if(!url.startsWith('/api/'))throw Error('External network is forbidden in fixture')
 const json=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}))
 if(url.startsWith('/api/inbox/state'))return json({viewerId:'admin',members:[{id:'admin',name:'แอดมินทดสอบ'}],conversations:customers.map(c=>({...c,unread_count:0})),aiAllowed:false,pageName:'เพจทดสอบออฟไลน์',quickReplies:[],proEnabled:true})
 if(url.startsWith('/api/inbox/pro'))return json({enabled:true,counts:{total:3,waiting:0,active:0,closed:0,resolved:0,ai:0,bot:3,overdue:0},averageResponseSeconds:null,responseSamples:0,team:[],overdueMinutes:15,days:30})
 const c=customers.find(c=>url.includes(c.id))
 if(options?.method==='PATCH'&&c){metrics.mutations++;const body=JSON.parse(String(options.body));await new Promise(resolve=>setTimeout(resolve,60));if(body.action==='claim'){c.assigned_user_id='admin';c.bot_enabled=false;c.inbox_stage='ASSIGNED'}if(body.action==='close'){c.conversation_status='closed';c.inbox_stage='CLOSED'}if(body.action==='reopen'){c.conversation_status='open';c.inbox_stage='ASSIGNED'}c.conversation_version++;return json({ok:true})}
 if(options?.method==='POST'&&url.endsWith('/read'))return json({ok:true})
 if(url.startsWith('/api/follow-ups/customers/'))return json({followup_opted_out:false,contact_suspended:false})
 if(c)return json({customer:c,orders:[],events:[],followups:[]})
 throw Error('Unmocked API: '+url)
 }) as typeof fetch}
