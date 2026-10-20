import { NextRequest, NextResponse } from 'next/server'
import { visionTenant } from '@/lib/features/vision/vision-server'
import { inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { enqueueVision, runVisionJob } from '@/lib/features/vision/vision'
import { validateVisionFile, VISION_MAX_BYTES } from '@/lib/features/vision/vision-image'
import { UUID } from '@/lib/utils'

export const runtime='nodejs'
export const maxDuration=60
export async function POST(req:NextRequest) {
  try{
    // Authenticate and authorize before parsing/storing any uploaded evidence.
    const {db,tenantId}=await visionTenant(req,req.nextUrl.searchParams.get('tenantId')??'')
    if(Number(req.headers.get('content-length')??0)>VISION_MAX_BYTES+65536)throw new InboxError('ไฟล์ใหญ่เกิน 5 MB',413)
    const reader=req.body?.getReader()
    if(!reader)throw new InboxError('ไม่มีไฟล์รูปภาพ')
    const chunks:Uint8Array[]=[];let bytes=0
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>VISION_MAX_BYTES+65536)throw new InboxError('ไฟล์ใหญ่เกิน 5 MB',413);chunks.push(part.value)}}finally{await reader.cancel()}
    const bounded=new Request('http://localhost/upload',{method:'POST',headers:{'Content-Type':req.headers.get('content-type')??''},body:Buffer.concat(chunks)})
    const form=await bounded.formData(),file=form.get('file'),key=form.get('requestId')
    if(!(file instanceof File)||typeof key!=='string'||!UUID.test(key))throw new InboxError('กรุณาเลือกรูปและส่งรหัสคำขอที่ถูกต้อง')
    try{await validateVisionFile(file)}catch(error){throw new InboxError(error instanceof Error?error.message:'ไฟล์ไม่ถูกต้อง')}
    if(!process.env.GEMINI_API_KEY?.trim())throw new InboxError('ยังไม่ได้ตั้งค่า GEMINI_API_KEY',503,'VISION_PROVIDER_NOT_CONFIGURED')
    const id=await enqueueVision(db,{tenantId,key,file,source:'test'})
    await runVisionJob(db,id)
    const job=await db.from('vision_jobs').select('id,status,result,decision,reason,created_at').eq('id',id).eq('tenant_id',tenantId).single()
    if(job.error)throw job.error
    return NextResponse.json({job:job.data,previewOnly:true})
  }catch(error){return inboxError(error)}
}
