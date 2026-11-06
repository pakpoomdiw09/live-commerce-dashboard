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
    ['1', '2', '3'],
  )
  assert.equal(await evaluate(`document.querySelectorAll('[data-auction-section]').length`), 0)
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('[data-auction-dashboard]')).borderTopWidth==='0px' && getComputedStyle(document.querySelector('[data-auction-dashboard]')).boxShadow==='none'`,
    ),
    true,
    'the auction dashboard does not wrap the unified card in another card',
  )
  assert.equal(
    await evaluate(
      `document.querySelectorAll('[data-auction-unified-form] button[type=submit]').length`,
    ),
    1,
  )
  assert.equal(
    await evaluate(
      `!!document.querySelector('[data-auction-workspace] [data-auction-header-cards]')`,
    ),
    true,
  )
  assert.deepEqual(
    await evaluate(
      `[...document.querySelectorAll('[data-auction-zone] > h3')].map(el=>el.textContent.trim())`,
    ),
    ['1. เลือกไลฟ์สด', '2. เงื่อนไขการประมูล', '3. คำดักข้อความ & ระบบตอบกลับ'],
    'all three sections retain their numbered headings',
  )
  assert.equal(
    await evaluate(
      `!!document.querySelector('[data-auction-workspace]') && ['[data-auction-header-cards]','[data-auction-zone="1"]','[data-auction-zone="2"]','[data-auction-zone="3"]','button[type="submit"]'].every(selector=>document.querySelector('[data-auction-workspace]').contains(document.querySelector(selector)))`,
    ),
    true,
    'finance, all sections and the save action share one card',
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
    `(() => {const b=document.querySelector('[data-auction-zone="2"]').getBoundingClientRect();const c=document.querySelector('[data-auction-zone="3"]').getBoundingClientRect();return {left:b.left,right:c.left}})()`,
  )
  assert.ok(
    desktopLayout.left < desktopLayout.right,
    'section 2 must be left of section 3 on desktop',
  )
  assert.ok(
    await evaluate(
      `[...document.querySelectorAll('[data-auction-zone] > h3, [data-auction-finance-card] > h3')].length===4 && [...document.querySelectorAll('[data-auction-zone] > h3, [data-auction-finance-card] > h3')].every(el=>el.classList.contains('text-white')&&Array.from(el.classList).some(name=>name.startsWith('bg-gradient')))`,
    ),
    'every content card has its orange gradient heading bar',
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-auction-settings-grid]').firstElementChild.firstElementChild.matches('[data-auction-finance-card]') && document.querySelector('[data-auction-finance-card] > h3').textContent.trim()==='สรุปต้นทุน / กำไร / ค่าใช้จ่าย'`,
    ),
    true,
    'finance is restored to the top of the layout, never below the reply section',
  )
  for (const label of [
    'ต้นทุนสินค้า (บาท)',
    'ค่าแอด / ยิงโฆษณา (บาท)',
    'ค่าจัดส่งจริง (บาท)',
    'ค่าธรรมเนียม / อื่นๆ (บาท)',
  ])
    assert.equal(
      await evaluate(`document.querySelector('input[aria-label=${JSON.stringify(label)}]').value`),
      '0',
      `financial input defaults to zero: ${label}`,
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
  await fill('input[aria-label="คำดักยืนยันรับบิล"]', 'เคาะ')
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
  assert.equal(
    await evaluate(`document.querySelector('[aria-label="คำปิดรอบที่เลือก"]').textContent.trim()`),
    '',
    'unsaved close keywords stay empty after reload',
  )
  // Exercise rapid repeated clicks, removal of one duplicate among different tags,
  // then the same unified save/reload path as the other form fields.
  await evaluate(
    `document.querySelector('[data-auction-keyword-editor="close"] button[aria-controls]').click()`,
  )
  await wait(
    `!!document.querySelector('[data-auction-keyword-editor="close"] button[aria-label="เพิ่มอีโมจิ ❌"]')`,
  )
  await evaluate(`(() => {
    const editor=document.querySelector('[data-auction-keyword-editor="close"]');
    const cross=editor.querySelector('button[aria-label="เพิ่มอีโมจิ ❌"]');
    cross.click();
    editor.querySelector('button[aria-label="เพิ่มอีโมจิ 1️⃣"]').click();
    cross.click();cross.click();
  })()`)
  await wait(
    `document.querySelectorAll('[data-auction-keyword-editor="close"] button[aria-label="ลบคำปิดรอบ ❌"]').length===3`,
  )
  await evaluate(
    `document.querySelectorAll('[data-auction-keyword-editor="close"] button[aria-label="ลบคำปิดรอบ ❌"]')[1].click()`,
  )
  await wait(
    `document.querySelectorAll('[data-auction-keyword-editor="close"] button[aria-label="ลบคำปิดรอบ ❌"]').length===2`,
  )
  for (let index = 0; index < 2; index++) {
    await fill('input[aria-label="คำดักยืนยันรับบิล"]', 'เคาะ')
    await evaluate(`document.querySelector('button[aria-label="เพิ่มคำดัก"]').click()`)
  }
  await click('บันทึกและเริ่มประมูล')
  await wait(`sessionQA.requests.at(-1)?.settings?.closeKeywords?.length===3`)
  assert.deepEqual(await evaluate('sessionQA.requests.at(-1).settings.keywords'), [
    'เคาะ',
    'เคาะ',
    'เคาะ',
  ])
  assert.deepEqual(await evaluate('sessionQA.requests.at(-1).settings.closeKeywords'), [
    '❌',
    '1️⃣',
    '❌',
  ])
  await call('Page.reload', { ignoreCache: true })
  await wait(
    `document.querySelectorAll('[data-auction-keyword-editor="close"] button[aria-label="ลบคำปิดรอบ ❌"]').length===2`,
  )
  assert.equal(
    await evaluate(`document.querySelectorAll('button[aria-label="ลบคำดัก เคาะ"]').length`),
    3,
  )
  const profitText = await evaluate(
    `document.querySelector('[aria-label="กำไรสุทธิของไลฟ์นี้"]').textContent`,
  )
  assert.ok(
    profitText.includes('฿96.25'),
    `profit reflects closed auction sales minus cost, ads, shipping and fees; got ${profitText}`,
  )
  for (const width of [375, 768, 1024, 1280, 1440]) {
    await resize(width)
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'fits ' + width)
    const layout = await evaluate(`(() => {
      const source=document.querySelector('[data-auction-zone="1"]').getBoundingClientRect();
      const finance=document.querySelector('[data-auction-finance-card]').getBoundingClientRect();
      const left=document.querySelector('[data-auction-zone="2"]').getBoundingClientRect();
      const right=document.querySelector('[data-auction-zone="3"]').getBoundingClientRect();
      const submit=document.querySelector('[data-auction-unified-form] button[type="submit"]').getBoundingClientRect();
      return {sourceTop:source.top,sourceBottom:source.bottom,financeTop:finance.top,financeBottom:finance.bottom,financeX:finance.x,financeWidth:finance.width,leftTop:left.top,rightTop:right.top,rightBottom:right.bottom,leftBottom:left.bottom,leftX:left.x,rightX:right.x,leftWidth:left.width,rightWidth:right.width,submitTop:submit.top};
    })()`)
    assert.ok(
      layout.financeBottom <= layout.sourceTop,
      'finance is at the top of the left column at ' + width,
    )
    if (width >= 1024) {
      assert.ok(
        layout.financeX < layout.leftX && layout.leftX < layout.rightX,
        'three columns at ' + width,
      )
      assert.ok(
        Math.abs(layout.financeTop - layout.leftTop) < 2,
        'finance aligns beside conditions at ' + width,
      )
      assert.ok(Math.abs(layout.leftTop - layout.rightTop) < 2, 'settings align at ' + width)
      assert.ok(
        Math.abs(layout.financeWidth - layout.leftWidth) < 2,
        'equal first and middle columns at ' + width,
      )
      assert.ok(Math.abs(layout.leftWidth - layout.rightWidth) < 2, 'equal columns at ' + width)
    } else {
      assert.ok(
        layout.sourceBottom <= layout.leftTop,
        'live selection precedes conditions on smaller screens at ' + width,
      )
      assert.ok(layout.rightTop >= layout.leftBottom, 'mobile stacks settings at ' + width)
    }
    assert.ok(
      layout.submitTop >=
        Math.max(layout.sourceBottom, layout.financeBottom, layout.leftBottom, layout.rightBottom),
      'one save button follows every field at ' + width,
    )
    await evaluate(`document.querySelector('button[aria-label="ไลฟ์สด Facebook"]').click()`)
    await wait(`!!document.querySelector('[role="listbox"][aria-label="รายการไลฟ์สด Facebook"]')`)
    assert.ok(
      await evaluate(`(() => {
        const popup=document.querySelector('[role="listbox"][aria-label="รายการไลฟ์สด Facebook"]').getBoundingClientRect();
        const source=document.querySelector('[data-auction-zone="1"]');
        const rect=source.getBoundingClientRect();
        return popup.bottom<=rect.bottom||getComputedStyle(source).overflowY==='visible';
      })()`),
      'live video options are not clipped by the restored source card at ' + width,
    )
    await evaluate(`document.querySelector('button[aria-label="ไลฟ์สด Facebook"]').click()`)
    await evaluate(
      `document.querySelector('[data-auction-keyword-editor="close"] button[aria-controls]').click()`,
    )
    await wait(`!!document.querySelector('[data-auction-keyword-editor="close"] [role="dialog"]')`)
    assert.ok(
      await evaluate(`(() => {
        const picker=document.querySelector('[data-auction-keyword-editor="close"] [role="dialog"]').getBoundingClientRect();
        const card=document.querySelector('[data-auction-workspace]').getBoundingClientRect();
        return picker.left>=card.left&&picker.right<=card.right;
      })()`),
      'the emoji picker remains inside the card at ' + width,
    )
    await evaluate(
      `document.querySelector('[data-auction-keyword-editor="close"] button[aria-controls]').click()`,
    )
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
    'PASS: Finance restored at top beside conditions, three columns at 1024/1280/1440, orange section bars, all fields and one bottom save preserved; duplicate tags and full save/reload still work. Mock APIs only.',
  )
}
