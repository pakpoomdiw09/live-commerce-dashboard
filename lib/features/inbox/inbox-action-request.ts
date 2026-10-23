/** Bound the mutation and its refresh separately; never automatically replay an uncertain write. */
export async function inboxActionRequest(url: string, body: unknown, timeoutMs = 20000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    // Consume the response inside the deadline too (headers alone may arrive before the body).
    const data = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error
      return null
    })
    if (response.ok && (!data || typeof data !== 'object' || Array.isArray(data)))
      throw new Error('ไม่สามารถยืนยันผลการบันทึก กรุณาตรวจสถานะแชทก่อนลองใหม่')
    return { response, data }
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('รอนานเกินกำหนด กรุณาตรวจสถานะแชทก่อนลองใหม่ รายการอาจบันทึกแล้ว')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function refreshInboxAction(refresh: () => Promise<void>, timeoutMs = 8000) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve().then(refresh),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('REFRESH_TIMEOUT')), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
