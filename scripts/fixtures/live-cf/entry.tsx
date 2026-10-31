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
        products={[
          {
            id: 'p1',
            code: 'SHIRT',
            name: 'เสื้อร้านค้า',
            price: 199,
            stock: 10,
            variants: [
              { id: 'v1', label: 'สีขาว', price: 250, stock: 4 },
              { id: 'v2', label: 'สีดำ', price: 270, stock: 6 },
            ],
          },
          { id: 'p2', code: 'SOAP', name: 'สบู่', price: 99, stock: 5, variants: [] },
        ]}
      />
    </>
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
)
