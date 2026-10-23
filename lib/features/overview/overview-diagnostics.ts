/** Server logs only: never log response rows, tokens or search terms. */
export function logOverviewError(
  stage: string,
  error: unknown,
  context: { tenantId?: string; status?: number } = {},
) {
  const value = error as {
    code?: string
    message?: string
    details?: string
    hint?: string
    stack?: string
    status?: number
  } | null
  const clean = (input: unknown) => {
    let text = typeof input === 'string' ? input : undefined
    if (!text) return undefined
    for (const [name, secret] of Object.entries(process.env)) {
      if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && secret && secret.length > 8)
        text = text.split(secret).join('[REDACTED]')
    }
    return text
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
      .slice(0, 2000)
  }
  console.error('[overview]', {
    stage,
    ...context,
    status: context.status ?? value?.status,
    code: clean(value?.code),
    message: clean(value?.message),
    details: clean(value?.details),
    hint: clean(value?.hint),
    stack: clean(value?.stack),
  })
}
