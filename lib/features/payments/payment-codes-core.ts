/** Receiving codes describe a payment request; they are NEVER proof of payment. */
export type ReceivingCode={id:string;account_id:string;label:string;payload:string;amount_satang:number|null;order_id:string|null;source:'generated'|'imported';is_active:boolean;created_at:string}
export type ReceivingAccount={id:string;bank_code:string;account_name:string;account_number:string;is_active:boolean;is_primary?:boolean}
export function receivingAmount(value:unknown):number|null {
 if(value===null||value===undefined||value==='')return null
 if(typeof value!=='string'&&typeof value!=='number')throw Error('ยอดเงินไม่ถูกต้อง')
 const match=/^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(value))
 if(!match)throw Error('ยอดเงินต้องเป็นบาทและไม่เกิน 2 ตำแหน่งทศนิยม')
 const amount=Number(match[1])*100+Number((match[2]??'').padEnd(2,'0'))
 if(amount<=0||amount>9999999999)throw Error('ยอดเงินต้องมากกว่า 0 และไม่เกิน 99,999,999.99 บาท')
 return amount
}
export function crc16(bytes:Uint8Array){let crc=0xffff;for(const byte of bytes){crc^=byte<<8;for(let i=0;i<8;i++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff}return crc.toString(16).toUpperCase().padStart(4,'0')}
function fields(value:string):Map<string,string>{
 const bytes=new TextEncoder().encode(value),decoder=new TextDecoder('utf-8',{fatal:true}),result=new Map<string,string>()
 for(let offset=0;offset<bytes.length;){
  const header=decoder.decode(bytes.slice(offset,offset+4))
  if(!/^\d{4}$/.test(header))throw Error('โครงสร้าง QR ไม่ถูกต้อง')
  const id=header.slice(0,2),length=Number(header.slice(2));offset+=4
  if(!length||offset+length>bytes.length||result.has(id))throw Error('ข้อมูล QR ซ้ำหรือไม่ครบ')
  result.set(id,decoder.decode(bytes.slice(offset,offset+length)));offset+=length
 }
 return result
}
/** Thai QR tag 29 credit transfer only. Bill-payment/bank-account/barcodes require an adapter. */
export function parseReceivingQr(payload:string){
 if(typeof payload!=='string'||new TextEncoder().encode(payload).length>1024||!/6304[0-9a-f]{4}$/i.test(payload))throw Error('ไม่ใช่ QR พร้อมเพย์ที่รองรับ')
 const root=fields(payload)
 if([...root.keys()].some(key=>Number(key)>=2&&Number(key)<=51&&key!=='29'))throw Error('ยังไม่รองรับ QR ที่รวมหลายช่องทางรับเงิน')
 if(root.get('00')!=='01'||!['11','12'].includes(root.get('01')??'')||root.get('53')!=='764'||root.get('58')!=='TH'||crc16(new TextEncoder().encode(payload.slice(0,-4)))!==payload.slice(-4).toUpperCase())throw Error('QR ไม่ผ่านการตรวจรูปแบบ สกุลเงิน หรือรหัสตรวจสอบ')
 const merchant=fields(root.get('29')??'')
 if(merchant.get('00')!=='A000000677010111')throw Error('ยังไม่รองรับ QR ธนาคารหรือผู้ให้บริการรูปแบบนี้')
 const proxies=['01','02','03'].filter(key=>merchant.has(key))
 if(proxies.length!==1)throw Error('QR ต้องระบุผู้รับเพียงหนึ่งรายการ')
 const kind=proxies[0],raw=merchant.get(kind)!
 const recipient=kind==='01'&&/^0066\d{9}$/.test(raw)?'0'+raw.slice(4):kind==='02'&&/^\d{13}$/.test(raw)?raw:kind==='03'&&/^\d{15}$/.test(raw)?raw:null
 if(!recipient)throw Error('หมายเลขผู้รับใน QR ไม่ถูกต้อง')
 return {recipient,amountSatang:receivingAmount(root.get('54')),method:root.get('01')}
}
export function codeMatchesAccount(payload:string,account:ReceivingAccount){
 if(!account.is_active||account.bank_code!=='PROMPTPAY')throw Error('เลือกบัญชีพร้อมเพย์ที่เปิดใช้งานของร้านก่อน')
 const decoded=parseReceivingQr(payload)
 if(decoded.recipient!==account.account_number)throw Error('หมายเลขผู้รับใน QR ไม่ตรงกับบัญชีพร้อมเพย์ที่เลือก')
 return decoded
}
