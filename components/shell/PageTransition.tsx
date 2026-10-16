'use client'

import { MotionConfig, motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Fades and slides the page content up on every navigation; the sidebar stays put.
 * Keyed by pathname rather than an app/template.tsx, because a template only re-mounts when its
 * own child segment changes (/chatbot/conversations -> /chatbot/images would not animate).
 * Ends at transform: none, so fixed-position modals inside pages still cover the viewport.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </motion.div>
    </MotionConfig>
  )
}
