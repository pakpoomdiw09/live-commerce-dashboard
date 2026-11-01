import React from 'react'
export const liveCfTest = { refreshes: 0 }
export const useRouter = () => ({
  refresh() {
    liveCfTest.refreshes++
  },
})
export default function Link({
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props}>{children}</a>
}
