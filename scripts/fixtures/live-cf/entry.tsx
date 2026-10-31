import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RuleEditor } from '@/components/comment-rules/RuleEditor'
import { liveCfTest } from './mocks'
import type { CommentRule } from '@/lib/features/comments/comment-rules'
function Fixture() {
  const [rule, setRule] = useState<CommentRule | undefined>()
  return (
    <>
      <button data-test="edit" onClick={() => setRule(liveCfTest.saved!)}>
        เปิดกฎที่บันทึก
      </button>
      <RuleEditor
        key={rule?.id ?? 'new'}
        rule={rule}
        tenantId="11111111-1111-4111-8111-111111111111"
        pages={[{ id: '100', name: 'เพจทดสอบ', picture: null }]}
      />
    </>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
)
