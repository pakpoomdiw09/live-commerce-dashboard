import React from 'react'
import type { CommentRule } from '@/lib/features/comments/comment-rules'

export const liveCfTest = {
  saves: [] as Record<string, any>[],
  pushes: [] as string[],
  saved: null as CommentRule | null,
}
;(window as any).liveCfTest = liveCfTest
export function supabaseBrowser() {
  return {
    from: (table: string) => {
      if (table !== 'comment_rules') throw Error('Unexpected table')
      const write = async (row: Record<string, any>, operation: string) => {
        await new Promise((r) => setTimeout(r, 50))
        liveCfTest.saves.push({ ...row, operation })
        liveCfTest.saved = {
          ...row,
          id: 'saved-rule',
          created_at: new Date().toISOString(),
        } as CommentRule
        return { error: null }
      }
      return {
        insert: (row: Record<string, any>) => write(row, 'insert'),
        update: (row: Record<string, any>) => {
          const query = {
            eq: () => query,
            then: (yes: any, no: any) => write(row, 'update').then(yes, no),
          }
          return query
        },
      }
    },
  }
}
const router = {
  push: (url: string) => {
    liveCfTest.pushes.push(url)
  },
  refresh() {},
}
export const useRouter = () => router
export default function Link({ href, children, ...props }: any) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}
