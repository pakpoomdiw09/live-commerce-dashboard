import {isFeatureEnabled} from '@/lib/feature-flags'
/** Shared validation and types. No secrets, transport or database access. */
export const SHOP_TABS = { overview: 'ภาพรวมร้านค้า', products: 'สินค้าทั้งหมด', orders: 'คำสั่งซื้อ', editor: 'ออกแบบเซลเพจ', customers: 'ลูกค้าของร้านค้า', reports: 'รายงานยอดขาย', settings: 'ตั้งค่าร้านค้า' } as const
export type ShopTab = keyof typeof SHOP_TABS
export const ORDER_STATES = { pending_payment: 'รอชำระเงิน', payment_review: 'รอตรวจสอบชำระเงิน', paid: 'ชำระเงินแล้ว', preparing: 'กำลังเตรียมสินค้า', shipped: 'จัดส่งแล้ว', completed: 'สำเร็จ', cancelled: 'ยกเลิก' } as const
export const BLOCK_NAMES = { hero: 'แบนเนอร์หลัก', products: 'สินค้า', promotion: 'โปรโมชั่น', text: 'รายละเอียด', review: 'รีวิวลูกค้า', faq: 'คำถามที่พบบ่อย', cta: 'ปุ่มสั่งซื้อ', footer: 'ท้ายเว็บไซต์' } as const
export type SalesBlock = { id: string; type: keyof typeof BLOCK_NAMES; title: string; text: string; image: string; button: string }
export type SalesDesign = { theme: string; blocks: SalesBlock[]; template?: 'basic' | 'premium' }
export class CommerceError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
export const PRESET_CATEGORIES = [
 {key:'collectibles',name:'พระเครื่อง เครื่องราง และของสะสม',icon:'🏺',description:'พระเครื่อง วัตถุมงคล ของสะสม'},
 {key:'beauty',name:'ความงามและของใช้ส่วนตัว',icon:'🧴',description:'สกินแคร์ เครื่องสำอาง ผลิตภัณฑ์ดูแลตัวเอง'},
 {key:'women-fashion',name:'เสื้อผ้าแฟชั่นผู้หญิง',icon:'👗',description:'เสื้อ กางเกง เดรส และแฟชั่นผู้หญิง'},
 {key:'men-fashion',name:'เสื้อผ้าแฟชั่นผู้ชาย',icon:'👕',description:'เสื้อ กางเกง และแฟชั่นผู้ชาย'},
 {key:'home',name:'ของใช้ในบ้านและชีวิตประจำวัน',icon:'🏠',description:'ของใช้ในบ้าน เครื่องครัว และของใช้ประจำวัน'},
 {key:'food',name:'อาหาร ขนม และเครื่องดื่ม',icon:'🍪',description:'อาหารสำเร็จรูป ขนม และเครื่องดื่ม'},
 {key:'electronics',name:'โทรศัพท์มือถือ อุปกรณ์ไอที และแกดเจ็ต',icon:'📱',description:'มือถือ อุปกรณ์คอมพิวเตอร์ และอุปกรณ์เสริม'},
 {key:'health',name:'สุขภาพและอาหารเสริม',icon:'💊',description:'ผลิตภัณฑ์สุขภาพ อาหารเสริม และอุปกรณ์ดูแลสุขภาพ'},
 {key:'accessories',name:'กระเป๋า รองเท้า และเครื่องประดับ',icon:'👜',description:'กระเป๋า รองเท้า นาฬิกา และเครื่องประดับ'},
 {key:'baby',name:'สินค้าแม่และเด็ก',icon:'🧸',description:'ของใช้สำหรับแม่ เด็ก และของเล่น'},
 {key:'pets',name:'สัตว์เลี้ยงและอุปกรณ์',icon:'🐾',description:'อาหารสัตว์ ของใช้ และอุปกรณ์สัตว์เลี้ยง'},
] as const
export const presetCategory=(value:unknown)=>typeof value==='string'?PRESET_CATEGORIES.find(c=>`preset:${c.key}`===value):undefined
export function categoryOptions(rows:readonly {id:string;name:string}[]){
 const standard=PRESET_CATEGORIES.map(c=>({id:`preset:${c.key}`,name:c.name,icon:c.icon,description:c.description,databaseId:rows.find(row=>row.name===c.name)?.id??null,legacy:false}))
 const names=new Set<string>(PRESET_CATEGORIES.map(c=>c.name))
 return [...standard,...rows.filter(row=>!names.has(row.name)).map(row=>({...row,icon:'🏷️',description:'หมวดหมู่เดิมของร้าน',databaseId:row.id,legacy:true}))]
}
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
export function text(v: unknown, max: number, required = false) { if (typeof v !== 'string' || v.trim().length > max || required && !v.trim()) throw new CommerceError('กรุณากรอกข้อความให้ครบและไม่ยาวเกินกำหนด'); return v.trim() }
export function safeImage(v: unknown) { if (!v) return ''; const value = text(v, 2048); let u: URL; try { u = new URL(value) } catch { throw new CommerceError('ลิงก์รูปภาพไม่ถูกต้อง') } if (u.protocol !== 'https:' || u.username || u.password) throw new CommerceError('รูปภาพต้องใช้ลิงก์ HTTPS'); return value }
export function money(v: unknown, allowZero = false) { if (typeof v !== 'number' || !Number.isFinite(v) || v < (allowZero ? 0 : 0.01) || v > 9999999 || Math.abs(v * 100 - Math.round(v * 100)) > 0.00001) throw new CommerceError('จำนวนเงินไม่ถูกต้อง รองรับทศนิยม 2 ตำแหน่ง'); return v }
export function stock(v: unknown) { if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > 1000000) throw new CommerceError('สต็อกต้องเป็นจำนวนเต็ม 0–1,000,000'); return Number(v) }
export function slug(v: unknown) { const s = text(v, 60, true); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) throw new CommerceError('ลิงก์ใช้ตัวอักษร a-z ตัวเลข และขีดกลางเท่านั้น'); return s }
export function parseProduct(v: any) {
  if (!v || typeof v !== 'object') throw new CommerceError('ข้อมูลสินค้าไม่ถูกต้อง')
  const code = text(v.code, 20, true); if (!/^[\p{L}\p{N}_-]+$/u.test(code)) throw new CommerceError('รหัสสินค้าใช้ตัวอักษร ตัวเลข ขีดกลาง หรือขีดล่าง')
  if (!Array.isArray(v.images) || v.images.length > 8 || !Array.isArray(v.variants) || v.variants.length > 40) throw new CommerceError('รูปภาพไม่เกิน 8 รูป และตัวเลือกไม่เกิน 40 รายการ')
  const variants = v.variants.map((r: any) => { if (!r || r.id && !isUuid(r.id)) throw new CommerceError('ตัวเลือกสินค้าไม่ถูกต้อง'); return { id: isUuid(r.id) ? r.id : undefined, label: text(r.label, 80, true), price: money(r.price), stock: stock(r.stock) } })
  if (new Set(variants.map((r: any) => r.label.toLowerCase())).size !== variants.length) throw new CommerceError('ชื่อตัวเลือกสินค้าซ้ำกัน')
  const price = money(v.price), compare = v.compare_price == null ? null : money(v.compare_price)
  if (compare != null && compare < price) throw new CommerceError('ราคาเปรียบเทียบต้องไม่น้อยกว่าราคาขาย')
  if (v.category_id && !isUuid(v.category_id) && !presetCategory(v.category_id)) throw new CommerceError('หมวดหมู่ไม่ถูกต้อง')
  return { code, name: text(v.name, 120, true), description: text(v.description ?? '', 2000), price, stock: variants.length ? stock(variants.reduce((n: number, r: any) => n + r.stock, 0)) : stock(v.stock), images: v.images.map(safeImage), compare_price: compare, cost: v.cost == null ? null : money(v.cost, true), category_id: v.category_id || null, featured: v.featured === true, is_active: v.is_active === true, variants }
}
export function parseDesign(v: any): SalesDesign {
  if (!v || !/^#[0-9a-f]{6}$/i.test(v.theme) || !Array.isArray(v.blocks) || v.blocks.length > 30) throw new CommerceError('รูปแบบหน้าเว็บไม่ถูกต้อง')
  const ids = new Set<string>()
  if (v.blocks.filter((b: any) => b?.type === 'products').length > 1) throw new CommerceError('เพิ่มส่วนสินค้าทั้งหมดได้หนึ่งส่วนต่อหน้า')
  return { theme: v.theme, template: v.template === 'premium' ? 'premium' : 'basic', blocks: v.blocks.map((b: any) => { if (!b || !isUuid(b.id) || ids.has(b.id) || !Object.hasOwn(BLOCK_NAMES, b.type)) throw new CommerceError('ส่วนประกอบหน้าเว็บไม่ถูกต้อง'); ids.add(b.id); return { id: b.id, type: b.type, title: text(b.title ?? '', 160), text: text(b.text ?? '', 5000), image: safeImage(b.image), button: text(b.button ?? '', 60) } }) }
}
export function parseCheckout(v: any) {
  if (!v || typeof v !== 'object') throw new CommerceError('ตะกร้าไม่ถูกต้อง')
  if (!isUuid(v.key) || !Array.isArray(v.items) || !v.items.length || v.items.length > 30) throw new CommerceError('ตะกร้าหรือรหัสคำสั่งซื้อไม่ถูกต้อง')
  const phone = text(v.phone, 20, true).replace(/[\s-]/g, ''); if (!/^\+?[0-9]{9,15}$/.test(phone)) throw new CommerceError('หมายเลขโทรศัพท์ไม่ถูกต้อง')
  const items = v.items.map((i: any) => { if (!i || !isUuid(i.product_id) || i.variant_id && !isUuid(i.variant_id) || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99) throw new CommerceError('รายการสินค้าไม่ถูกต้อง'); return { product_id: i.product_id, variant_id: i.variant_id || null, qty: i.qty } }).sort((a: any, b: any) => `${a.product_id}${a.variant_id}`.localeCompare(`${b.product_id}${b.variant_id}`))
  if (new Set(items.map((i: any) => `${i.product_id}:${i.variant_id}`)).size !== items.length) throw new CommerceError('สินค้าในตะกร้าซ้ำกัน')
  return { key: v.key, name: text(v.name, 120, true), phone, address: text(v.address, 1000, true), items }
}
export const shopV2 = () => isFeatureEnabled('sales_page_v2')
export const commerceFlag = (part: string) => shopV2() && process.env[part] !== 'false'
