import 'server-only'

export const VISION_MAX_BYTES=5*1024*1024
/** Check both declared MIME and magic bytes; never accept SVG, GIF, empty or oversized files. */
export async function validateVisionFile(file:File) {
  if(!file.size||file.size>VISION_MAX_BYTES)throw new Error('รูปภาพต้องมีขนาดไม่เกิน 5 MB')
  const bytes=Buffer.from(await file.arrayBuffer())
  const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null
  if(!mime||mime!==file.type)throw new Error('รองรับไฟล์ JPG, PNG และ WebP ที่ถูกต้องเท่านั้น')
  return bytes
}
/** Only signed webhook attachments from Meta's CDN. Never fetch a URL provided by the playground. */
export async function downloadVisionImage(value:string):Promise<File> {
  const url=new URL(value)
  if(url.protocol!=='https:'||url.username||url.password||url.port||!/(^|\.)(?:fbcdn\.net|fbsbx\.com)$/i.test(url.hostname))throw new Error('UNTRUSTED_IMAGE_HOST')
  const response=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'})
  if(!response.ok||Number(response.headers.get('content-length')??0)>VISION_MAX_BYTES)throw new Error('IMAGE_DOWNLOAD_FAILED')
  const reader=response.body?.getReader();if(!reader)throw new Error('IMAGE_DOWNLOAD_FAILED')
  const chunks:Uint8Array[]=[];let size=0
  try{while(true){const {done,value:chunk}=await reader.read();if(done)break;size+=chunk.length;if(size>VISION_MAX_BYTES)throw new Error('IMAGE_TOO_LARGE');chunks.push(chunk)}}finally{await reader.cancel()}
  const file=new File([Buffer.concat(chunks)],'image',{type:response.headers.get('content-type')?.split(';')[0]??''})
  await validateVisionFile(file);return file
}
