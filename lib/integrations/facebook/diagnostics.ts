/** Safe raw JSON diagnostics: credentials and payment details never reach logs. */
export function redactFacebookDiagnostic(value: unknown, extraSecrets: readonly string[] = []) {
  const secrets = [
    ...extraSecrets,
    ...Object.entries(process.env)
      .filter(([key]) => /TOKEN|SECRET|API_KEY|SERVICE_ROLE_KEY/i.test(key))
      .map(([, item]) => item),
  ]
    .filter((item): item is string => typeof item === 'string' && !!item)
    .flatMap((item) => [item, encodeURIComponent(item)])
    .sort((a, b) => b.length - a.length)
  return JSON.parse(
    JSON.stringify(value ?? null, (key, item) => {
      if (
        /token|secret|authorization|password|appsecret_proof|account_number|receiver_account|sender_account/i.test(
          key,
        )
      )
        return '[REDACTED]'
      if (typeof item !== 'string') return item
      let safe = item
      for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]')
      return safe
        .replace(/Bearer\s+[^\s"'&,)]+/gi, 'Bearer [REDACTED]')
        .replace(
          /((?:access_token|appsecret_proof|client_secret)\s*[=:]\s*)[^\s&"',)]+/gi,
          '$1[REDACTED]',
        )
    }),
  )
}
