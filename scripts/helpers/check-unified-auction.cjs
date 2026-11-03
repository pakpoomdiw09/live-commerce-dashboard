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
  await wait(`!!document.querySelector('[data-auction-unified-form] [data-auction-zone]')`)
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
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-auction-header-cards]>*').length`),
    6,
  )
  for (const label of [
    'ต้นทุนสินค้า (บาท)',
    'ค่าแอด / ยิงโฆษณา (บาท)',
    'ค่าจัดส่งจริง (บาท)',
    'ราคาปิดประมูล / ยอดขายสุทธิ (บาท)',
    'ค่าธรรมเนียม / อื่นๆ (บาท)',
    'กำไรสุทธิ (บาท)',
  ])
    assert.ok(
      await evaluate(
        `document.querySelector('[data-auction-header-cards]').textContent.includes(${JSON.stringify(label)})`,
      ),
      `financial card label is visible: ${label}`,
    )
  const desktopLayout = await evaluate(
    `(() => {const b=document.querySelector('[data-auction-zone="B"]').getBoundingClientRect();const c=document.querySelector('[data-auction-zone="C"]').getBoundingClientRect();return {left:b.left,right:c.left}})()`,
  )
  assert.ok(desktopLayout.left < desktopLayout.right, 'zone B must be left of zone C on desktop')
  assert.ok(
    await evaluate(
      `[...document.querySelectorAll('[data-auction-zone] h2')].every(el=>el.classList.contains('text-white')&&Array.from(el.classList).some(name=>name.startsWith('bg-gradient')))`,
    ),
    'all auction zone headers use the orange gradient',
  )
  for (const label of [
    'ต้นทุนสินค้า (บาท)',
    'ค่าแอด / ยิงโฆษณา (บาท)',
    'ค่าจัดส่งจริง (บาท)',
    'ค่าธรรมเนียม / อื่นๆ (บาท)',
  ])
    assert.equal(
      await evaluate(`document.querySelector('input[aria-label=${JSON.stringify(label)}]').value`),
      '',
      `unsaved financial input is blank: ${label}`,
    )
  for (const label of [
    'ชื่อสินค้า',
    'ราคาเปิดประมูล (บาท)',
    'ราคาเคาะขั้นต่ำต่อครั้ง (บาท)',
    'ค่าจัดส่งที่เรียกเก็บ (บาท)',
  ])
    assert.equal(
      await evaluate(`document.querySelector('input[aria-label=${JSON.stringify(label)}]').value`),
      '',
      `unsaved auction input is blank: ${label}`,
    )
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="จำนวนคำดัก"]').textContent`),
    '0 คำ',
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="เปิด Public Reply ใต้คอมเมนต์"]').getAttribute('aria-checked')`,
    ),
    'false',
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="เปิด Private Reply เข้า Inbox"]').getAttribute('aria-checked')`,
    ),
    'false',
  )
  assert.equal(
    await evaluate(`document.querySelector('select[aria-label="บัญชีธนาคารรับเงิน"]').value`),
    '',
  )
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="Public Reply ใต้คอมเมนต์"]').value`,
    ),
    '',
  )
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="Private Reply เข้า Inbox"]').value`,
    ),
    '',
  )
  await fill('input[aria-label="ชื่อสินค้า"]', 'พระสมเด็จบันทึกพร้อมคำดัก')
  await fill('input[aria-label="ราคาเปิดประมูล (บาท)"]', '450')
  await fill('input[aria-label="ราคาเคาะขั้นต่ำต่อครั้ง (บาท)"]', '35')
  await fill('input[aria-label="ค่าจัดส่งที่เรียกเก็บ (บาท)"]', '47')
  await fill('input[aria-label="ต้นทุนสินค้า (บาท)"]', '125.50')
  await fill('input[aria-label="ค่าแอด / ยิงโฆษณา (บาท)"]', '15')
  await fill('input[aria-label="ค่าจัดส่งจริง (บาท)"]', '20')
  await fill('input[aria-label="ค่าธรรมเนียม / อื่นๆ (บาท)"]', '3.25')
  await fill('select[aria-label="บัญชีธนาคารรับเงิน"]', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')
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
  assert.deepEqual(await evaluate('sessionQA.requests.at(-1).settings.keywords'), ['เคาะ'])
  assert.equal(await evaluate('sessionQA.requests.at(-1).finance.cost'), '125.50')
  assert.equal(await evaluate('sessionQA.requests.at(-1).finance.ads'), '15')
  assert.equal(await evaluate('sessionQA.requests.at(-1).finance.fees'), '3.25')
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
  assert.equal(
    await evaluate(
      `Number(document.querySelector('input[aria-label="ค่าแอด / ยิงโฆษณา (บาท)"]').value)`,
    ),
    15,
  )
  assert.equal(
    await evaluate(
      `Number(document.querySelector('input[aria-label="ค่าธรรมเนียม / อื่นๆ (บาท)"]').value)`,
    ),
    3.25,
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
