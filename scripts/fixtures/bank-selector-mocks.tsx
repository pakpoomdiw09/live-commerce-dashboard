import type { AnchorHTMLAttributes } from 'react'

const router = { refresh() {}, replace() {}, push() {} }
export function useRouter() {
  return router
}
export default function MockLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />
}
