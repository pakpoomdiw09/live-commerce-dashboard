import { BANK_CODES, isSupportedBank, UNSUPPORTED_BANK_MESSAGE } from '@/lib/features/banking/banks'
export type BankAccount = { id: string; tenant_id: string; bank_code: string; account_name: string; account_number: string; is_active: boolean; is_primary?:boolean;qrPayload?:string|null; created_at: string }
export const BANK_ACCOUNT_COLUMNS = 'id,tenant_id,bank_code,account_name,account_number,is_active,created_at'
export function bankAccountError(bank: string, name: string, number: string): string | null {
 if (!BANK_CODES.includes(bank)) return 'เลือกธนาคารให้ถูกต้อง'
 if (!isSupportedBank(bank)) return UNSUPPORTED_BANK_MESSAGE
 if (!name.trim() || name.trim().length>120) return 'กรอกชื่อบัญชีไม่เกิน 120 ตัวอักษร'
 const digits=number.replace(/[\s-]/g,'')
 if (!/^\d{10,15}$/.test(digits)) return 'เลขบัญชีต้องเป็นตัวเลข 10–15 หลัก'
 if (bank==='PROMPTPAY' && !/^0\d{9}$|^\d{13}$|^\d{15}$/.test(digits)) return 'พร้อมเพย์ต้องเป็นเบอร์โทร 10 หลัก เลขบัตร 13 หลัก หรือเลขกระเป๋าเงิน 15 หลัก'
 return null
}
export function formatBankAccount(number: string, bank: string) {
 if(bank==='PROMPTPAY' && number.length===10) return `${number.slice(0,3)}-${number.slice(3,6)}-${number.slice(6)}`
 if(number.length===10) return `${number.slice(0,3)}-${number.slice(3,4)}-${number.slice(4,9)}-${number.slice(9)}`
 return number.replace(/(.{4})(?=.)/g,'$1 ')
}
