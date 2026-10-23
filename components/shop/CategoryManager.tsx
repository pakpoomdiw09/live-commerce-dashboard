'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  commerceButton as btn,
  commerceInput as input,
  commercePrimary as primary,
  type ShopMutation,
} from '@/components/shop/CommerceEditor'

export function CategoryManager({
  categories,
  mutate,
  busy,
  canManage,
}: {
  categories: { id: string; name: string }[]
  mutate: ShopMutation
  busy: boolean
  canManage: boolean
}) {
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null),
    field = useRef<HTMLInputElement>(null),
    lock = useRef(false)
  useEffect(() => {
    if (open) {
      dialog.current?.showModal()
      field.current?.focus()
    }
  }, [open])
  function close() {
    if (lock.current || busy) return
    setOpen(false)
    setEditing(null)
    setName('')
    setError('')
  }
  async function save() {
    if (lock.current || busy || !canManage || !name.trim()) return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      const id = await mutate('category', { name: name.trim() }, editing ?? undefined)
      if (id) {
        setEditing(null)
        setName('')
        field.current?.focus()
      } else setError('บันทึกหมวดหมู่ไม่สำเร็จ กรุณาลองอีกครั้ง')
    } catch {
      setError('บันทึกหมวดหมู่ไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      lock.current = false
      setSaving(false)
    }
  }
  async function remove(id: string) {
    if (
      lock.current ||
      busy ||
      !canManage ||
      !confirm('ลบหมวดหมู่นี้หรือไม่? สินค้าในหมวดหมู่จะยังอยู่ครบ')
    )
      return
    lock.current = true
    setSaving(true)
    setError('')
    try {
      if (await mutate('category_delete', {}, id)) {
        if (editing === id) {
          setEditing(null)
          setName('')
        }
      } else setError('ลบหมวดหมู่ไม่สำเร็จ กรุณาลองอีกครั้ง')
    } catch {
      setError('ลบหมวดหมู่ไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      lock.current = false
      setSaving(false)
    }
  }
  const disabled = busy || saving || !canManage
  return (
    <>
      <button
        type="button"
        className={btn}
        disabled={busy || !canManage}
        onClick={() => setOpen(true)}
      >
        <FolderPlus className="h-4 w-4" />
        จัดการหมวดหมู่
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            aria-labelledby="category-manager-title"
            onCancel={(e) => {
              e.preventDefault()
              close()
            }}
            onClose={close}
            className="m-auto w-[calc(100%_-_2rem)] max-w-xl rounded-2xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/40"
          >
            <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 id="category-manager-title" className="text-lg font-semibold">
                  จัดการหมวดหมู่
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  เพิ่ม แก้ไข หรือลบหมวดหมู่สินค้าในร้านของคุณ
                </p>
              </div>
              <button
                type="button"
                aria-label="ปิดจัดการหมวดหมู่"
                disabled={busy || saving}
                onClick={close}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </header>
            <form
              className="space-y-3 border-b border-slate-100 p-5"
              onSubmit={(e) => {
                e.preventDefault()
                void save()
              }}
            >
              <label htmlFor="category-name" className="block text-sm font-medium">
                {editing ? 'แก้ไขชื่อหมวดหมู่' : 'เพิ่มหมวดหมู่ใหม่'}
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={field}
                  id="category-name"
                  className={input + ' min-w-0 flex-1'}
                  placeholder="เช่น เสื้อผ้า เครื่องประดับ"
                  maxLength={80}
                  required
                  value={name}
                  disabled={disabled}
                  onChange={(e) => setName(e.target.value)}
                />
                <button type="submit" className={primary} disabled={disabled || !name.trim()}>
                  <Plus size={16} />
                  {editing ? 'บันทึก' : 'เพิ่มหมวดหมู่'}
                </button>
                {editing && (
                  <button
                    type="button"
                    disabled={disabled}
                    className={btn}
                    onClick={() => {
                      setEditing(null)
                      setName('')
                      setError('')
                      field.current?.focus()
                    }}
                  >
                    ยกเลิกแก้ไข
                  </button>
                )}
              </div>
              {error && (
                <p role="alert" className="text-sm text-rose-700">
                  {error}
                </p>
              )}
              {saving && (
                <p role="status" className="text-xs text-slate-500">
                  กำลังบันทึก…
                </p>
              )}
            </form>
            <div className="max-h-[45vh] overflow-y-auto px-5 pb-5">
              <p className="py-3 text-xs text-slate-500">ทั้งหมด {categories.length} หมวดหมู่</p>
              {categories.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 border-t border-slate-100 py-3"
                >
                  <span className="min-w-0 break-words text-sm">{c.name}</span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className={btn}
                      disabled={disabled}
                      aria-label={`แก้ไขหมวดหมู่ ${c.name}`}
                      onClick={() => {
                        setEditing(c.id)
                        setName(c.name)
                        setError('')
                        field.current?.focus()
                      }}
                    >
                      <Pencil size={15} />
                      <span className="hidden sm:inline">แก้ไข</span>
                    </button>
                    <button
                      type="button"
                      className={btn + ' text-rose-600'}
                      disabled={disabled}
                      aria-label={`ลบหมวดหมู่ ${c.name}`}
                      onClick={() => void remove(c.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
              {!categories.length && (
                <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
                  ยังไม่มีหมวดหมู่ เพิ่มหมวดหมู่แรกได้จากช่องด้านบน
                </p>
              )}
            </div>
          </dialog>,
          document.body,
        )}
    </>
  )
}
