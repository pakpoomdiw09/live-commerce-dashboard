export type AuctionSettingsStatus = {
  label: string
  badgeClass: string
  dotClass: string
}

export function auctionSettingsStatus(degraded: boolean, hasError: boolean): AuctionSettingsStatus {
  if (!degraded) {
    return {
      label: 'โหลดการตั้งค่าแล้ว',
      badgeClass: 'bg-emerald-500 text-white',
      dotClass: 'bg-white',
    }
  }
  if (hasError) {
    return {
      label: 'ตรวจสอบการตั้งค่าไม่ได้',
      badgeClass: 'bg-rose-100 text-rose-800',
      dotClass: 'bg-rose-500',
    }
  }
  return {
    label: 'กำลังตรวจสอบการตั้งค่า',
    badgeClass: 'bg-amber-100 text-amber-900',
    dotClass: 'bg-amber-500',
  }
}
