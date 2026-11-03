module.exports = async function ({
  wait,
  evaluate,
  fill,
  click,
  call,
  resize,
  output,
  fs,
  assert,
  errors,
}) {
  await wait(
    `document.querySelector('input[aria-label="ค่าจัดส่งที่เรียกเก็บ (บาท)"]')?.value==='37'`,
  )
  assert.deepEqual(
    await evaluate(
      `[...document.querySelectorAll('[data-auction-zone]')].map(el=>el.dataset.auctionZone)`,
    ),
    ['A', 'B', 'C'],
  )
  assert.equal(await evaluate(`document.querySelectorAll('[data-auction-section]').length`), 0)
  assert.equal(
    await evaluate(
      `document.querySelectorAll('[data-auction-unified-form] button[type=submit]').length`,
    ),
    1,
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-auction-unified-form]').firstElementChild.hasAttribute('data-auction-header-cards')`,
    ),
    true,
  )
  await fill('input[aria-label="ชื่อสินค้า"]', 'พระสมเด็จบันทึกพร้อมคำดัก')
  await fill('input[aria-label="ราคาเปิดประมูล (บาท)"]', '450')
  await fill('input[aria-label="ราคาเคาะขั้นต่ำต่อครั้ง (บาท)"]', '35')
  await fill('input[aria-label="ค่าจัดส่งที่เรียกเก็บ (บาท)"]', '47')
  await fill('input[aria-label="ต้นทุนสินค้า (บาท)"]', '125.50')
  await fill('input[aria-label="คำดักบิด / ยืนยันผู้ชนะ"]', 'เคาะ')
  await evaluate(`document.querySelector('button[aria-label="เพิ่มคำดัก"]').click()`)
  await fill(
    'textarea[aria-label="Public Reply ใต้คอมเมนต์"]',
    '{ชื่อลูกค้า} ชนะ {รายการ} {ราคา} บาท',
  )
  await fill(
    'textarea[aria-label="Private Reply เข้า Inbox"]',
    '{ชื่อลูกค้า} {รายการ} {ราคา} รวม {ยอดรวมสะสม} โอน {เลขบัญชี}',
  )
  await evaluate('new Promise(resolve=>setTimeout(resolve,5500))')
  assert.equal(
    await evaluate(
      `document.querySelector('input[aria-label="ค่าจัดส่งที่เรียกเก็บ (บาท)"]').value`,
    ),
    '47',
  )
  await click('บันทึกและเริ่มประมูล')
  await wait(
    `document.querySelector('[data-auction-unified-form]').textContent.includes('บันทึกครบแล้ว')`,
  )
  assert.equal(await evaluate('sessionQA.requests.filter(row=>row.itemName).length'), 1)
  assert.equal(await evaluate('sessionQA.requests.at(-1).shippingFee'), '47')
  assert.deepEqual(await evaluate('sessionQA.requests.at(-1).settings.keywords'), ['1', 'เคาะ'])
  assert.equal(await evaluate('sessionQA.requests.at(-1).finance.cost'), '125.50')
  await call('Page.reload', { ignoreCache: true })
  await wait(
    `document.querySelector('input[aria-label="ค่าจัดส่งที่เรียกเก็บ (บาท)"]')?.value==='47'`,
  )
  assert.equal(
    await evaluate(`document.querySelector('input[aria-label="ราคาเปิดประมูล (บาท)"]').value`),
    '450',
  )
  assert.equal(
    await evaluate(
      `document.querySelector('input[aria-label="ราคาเคาะขั้นต่ำต่อครั้ง (บาท)"]').value`,
    ),
    '35',
  )
  assert.equal(
    await evaluate(
      `Number(document.querySelector('input[aria-label="ต้นทุนสินค้า (บาท)"]').value)`,
    ),
    125.5,
  )
  assert.ok(
    await evaluate(
      `document.querySelector('[aria-label="คำดักที่เลือก"]').textContent.includes('เคาะ')`,
    ),
  )
  assert.ok(
    await evaluate(
      `document.querySelector('textarea[aria-label="Private Reply เข้า Inbox"]').value.includes('รวม {ยอดรวมสะสม}')`,
    ),
  )
  for (const width of [375, 768, 1024, 1440]) {
    await resize(width)
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'fits ' + width)
    const shot = await call('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    })
    fs.writeFileSync(
      require('node:path').join(output, `session-${width}.png`),
      Buffer.from(shot.data, 'base64'),
    )
  }
  assert.deepEqual(errors, [])
  console.log(
    'PASS: Single form, three zones, finance header, one save, polling preserves drafts, backend reload restores shipping/keywords/templates, responsive at 375/768/1024/1440. Mock APIs only.',
  )
}
