import Link from 'next/link'

export default function NotFound(){
 return <main className="flex min-h-[60vh] items-center justify-center px-4 py-16">
  <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
   <p className="text-sm font-semibold tracking-widest text-blue-600">404 · NOT FOUND</p>
   <h1 className="mt-3 text-2xl font-semibold text-slate-900">ไม่พบหน้าที่ต้องการ</h1>
   <p className="mt-3 text-sm leading-relaxed text-slate-600">ลิงก์อาจเปลี่ยนไป หรือรายการนี้ไม่มีอยู่แล้ว กรุณาตรวจสอบที่อยู่เว็บไซต์ หรือกลับไปยังหน้าหลัก</p>
   <div className="mt-6 flex flex-wrap justify-center gap-3">
    <Link href="/overview" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">กลับหน้าภาพรวม</Link>
    <Link href="/inbox" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">เปิด Inbox</Link>
   </div>
  </section>
 </main>
}
