'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'
import { requireSupabaseEnv } from '@/lib/supabase/env'

const SESSION_MODE_COOKIE = 'snapbot_session_mode'
const REMEMBER_MAX_AGE = 60 * 60 * 24 * 400

function readCookies() {
  return document.cookie.split(';').flatMap((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return []
    try {
      return [{ name: decodeURIComponent(part.slice(0, separator).trim()), value: decodeURIComponent(part.slice(separator + 1).trim()) }]
    } catch {
      return []
    }
  })
}

function writeCookie(name: string, value: string, options: CookieOptions, remember: boolean) {
  const attributes = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`]
  if (options.domain) attributes.push(`Domain=${options.domain}`)
  const maxAge = options.maxAge
  if (typeof maxAge === 'number' && (remember || maxAge <= 0)) attributes.push(`Max-Age=${Math.floor(maxAge)}`)
  if (options.expires instanceof Date) {
    const expires = options.expires
    if (!Number.isNaN(expires.getTime())) attributes.push(`Expires=${expires.toUTCString()}`)
  }
  const sameSite = options.sameSite
  if (sameSite === true) attributes.push('SameSite=Strict')
  else if (typeof sameSite === 'string') attributes.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`)
  if (options.secure || location.protocol === 'https:') attributes.push('Secure')
  document.cookie = attributes.join('; ')
}

/** Creates a request-scoped Supabase browser client with the selected cookie lifetime. */
export function supabaseAuthBrowser(remember: boolean) {
  const { url, anonKey } = requireSupabaseEnv()
  return createBrowserClient(url, anonKey, {
    isSingleton: false,
    cookies: {
      getAll: readCookies,
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => writeCookie(name, value, options, remember))
        writeCookie(SESSION_MODE_COOKIE, remember ? 'remember' : 'session', {
          path: '/',
          sameSite: 'lax',
          secure: location.protocol === 'https:',
          ...(remember ? { maxAge: REMEMBER_MAX_AGE } : {}),
        }, remember)
      },
    },
  })
}
