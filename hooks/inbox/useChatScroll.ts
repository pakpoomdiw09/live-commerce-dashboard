'use client'
import { useCallback, useLayoutEffect, useRef } from 'react'

/** Anchor only the message viewport. Never scroll the document or an outer layout. */
export function useChatScroll(customerId: string | undefined, revision: unknown) {
  const viewport = useRef<HTMLDivElement>(null),
    content = useRef<HTMLOListElement>(null)
  const saved = useRef({
    customer: '',
    initialized: false,
    stick: true,
    top: 0,
    anchor: '',
    offset: 0,
  })
  const remember = useCallback(() => {
    const el = viewport.current
    if (!el || !el.clientHeight) return
    const state = saved.current
    state.top = el.scrollTop
    const top = el.getBoundingClientRect().top
    const anchor = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (node) => node.getBoundingClientRect().bottom > top,
    )
    state.anchor = anchor?.dataset.messageId ?? ''
    state.offset = anchor ? anchor.getBoundingClientRect().top - top : 0
  }, [])
  const sync = useCallback(() => {
    const el = viewport.current
    if (!el || !el.clientHeight || !content.current?.children.length) return
    const state = saved.current
    if (!state.initialized || state.stick) {
      el.scrollTop = el.scrollHeight
      state.initialized = true
      state.stick = true
    } else {
      const anchor = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).find(
        (node) => node.dataset.messageId === state.anchor,
      )
      if (anchor)
        el.scrollTop +=
          anchor.getBoundingClientRect().top - el.getBoundingClientRect().top - state.offset
      else el.scrollTop = state.top
    }
    remember()
  }, [remember])
  useLayoutEffect(() => {
    if (saved.current.customer !== customerId)
      saved.current = {
        customer: customerId ?? '',
        initialized: false,
        stick: true,
        top: 0,
        anchor: '',
        offset: 0,
      }
    sync()
  }, [customerId, revision, sync])
  useLayoutEffect(() => {
    const el = viewport.current,
      list = content.current
    if (!el || !list) return
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    observer.observe(list)
    return () => observer.disconnect()
  }, [customerId, sync])
  const onScroll = useCallback(() => {
    const el = viewport.current
    if (!el?.clientHeight) return
    saved.current.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    remember()
  }, [remember])
  const latest = useCallback(() => {
    saved.current.stick = true
    sync()
  }, [sync])
  return { viewport, content, onScroll, latest }
}
