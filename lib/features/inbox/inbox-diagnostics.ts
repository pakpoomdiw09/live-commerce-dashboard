/** Logs database context without logging request bodies, headers or credentials. */
export function logInboxError(
  stage: string,
  error: unknown,
  context: Record<string, unknown> = {},
) {
  const value = error as {
    code?: string
    message?: string
    details?: string
    hint?: string
    status?: number
    stack?: string
  } | null
  const clean = (input: unknown) => {
    if (typeof input !== 'string') return undefined
    let text = input
    for (const [name, secret] of Object.entries(process.env))
      if (/(KEY|TOKEN|SECRET|PASSWORD)/i.test(name) && secret && secret.length > 8)
        text = text.split(secret).join('[REDACTED]')
    return text
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]')
      .slice(0, 2000)
  }
  console.error('[inbox/action]', {
    stage,
    ...context,
    code: clean(value?.code),
    message: clean(value?.message),
    details: clean(value?.details),
    hint: clean(value?.hint),
    errorStatus: value?.status,
    stack: clean(value?.stack),
  })
}
