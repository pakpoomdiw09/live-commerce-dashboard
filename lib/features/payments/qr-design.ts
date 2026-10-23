export const qrTemplates = [
  { name: 'ส้ม SnapBot', background: '#fff7ed', frame: '#f97316' },
  { name: 'น้ำเงิน', background: '#eff6ff', frame: '#2563eb' },
  { name: 'ชมพู', background: '#fdf2f8', frame: '#db2777' },
  { name: 'ทอง', background: '#fffbeb', frame: '#a16207' },
  { name: 'มินิมอล', background: '#ffffff', frame: '#334155' },
] as const
export type QrDesign = { background: string; frame: string; shop: string; caption: string }
export const defaultQrDesign: QrDesign = {
  ...qrTemplates[0],
  shop: '',
  caption: 'สแกนเพื่อชำระเงิน',
}
export function validateQrDesign(value: unknown): QrDesign {
  const v = value as Partial<QrDesign> | null
  if (
    !v ||
    !/^#[0-9a-f]{6}$/i.test(v.background ?? '') ||
    !/^#[0-9a-f]{6}$/i.test(v.frame ?? '') ||
    typeof v.shop !== 'string' ||
    v.shop.length > 80 ||
    typeof v.caption !== 'string' ||
    v.caption.length > 120
  )
    throw Error('รูปแบบการตกแต่งไม่ถูกต้อง')
  return {
    background: v.background!,
    frame: v.frame!,
    shop: v.shop.trim(),
    caption: v.caption.trim(),
  }
}
