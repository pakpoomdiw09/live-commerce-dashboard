'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Bot, Check, Eye, EyeOff, Headphones,
  KeyRound, LockKeyhole, Mail, MessageCircle, Send, Settings2, ShieldCheck,
  Sparkles, UsersRound,
} from 'lucide-react'
import { FACEBOOK_LOGIN_SCOPES, facebookRedirectTo, rememberOAuthNext, safeAuthNext, oauthErrorMessage } from '@/lib/oauth'
import { supabaseAuthBrowser } from '@/lib/supabase/auth-browser'

type Mode = 'login' | 'register' | 'forgot' | 'reset'
type Locale = 'th' | 'en'

const copy = {
  th: {
    tagline: 'ผู้ช่วยอัจฉริยะ', subtitle: 'สำหรับธุรกิจออนไลน์',
    description: 'ตอบแชต ดูแลลูกค้า ตรวจสอบสลิป และติดตามยอดขาย ด้วย AI ครบจบในที่เดียว',
    features: [
      ['บอตแชต', 'ตอบแชตอัตโนมัติ'], ['ตรวจสอบสลิป', 'ตรวจสอบการชำระเงิน'],
      ['ผู้ช่วยติดตามลูกค้า', 'ติดตามและดูแลลูกค้า'], ['รายงานสถิติ', 'วิเคราะห์ข้อมูลธุรกิจ'],
      ['AI อัจฉริยะ', 'ช่วยตอบคำถามและแนะนำสินค้า'], ['ตั้งค่าระบบง่าย', 'จัดการได้ในที่เดียว'],
    ],
    showcase: 'ตัวอย่างหน้าระบบ', demoChat: 'มีสินค้าอะไรแนะนำบ้างคะ?', demoReply: 'ยินดีช่วยแนะนำค่ะ',
    floating: ['ตอบแชตอัตโนมัติ', 'ดูแลลูกค้าได้ต่อเนื่อง'],
    benefits: [['ปลอดภัย', 'ข้อมูลของคุณปลอดภัย'], ['ใช้งานง่าย', 'เริ่มใช้งานได้ทันที'], ['ทีมช่วยเหลือ', 'ดูแลคุณตลอดการใช้งาน']],
    loginTitle: 'เข้าสู่ระบบ', loginDescription: 'ยินดีต้อนรับกลับมา เข้าสู่ระบบเพื่อจัดการธุรกิจของคุณ',
    email: 'อีเมล', emailPlaceholder: 'กรอกอีเมลของคุณ', password: 'รหัสผ่าน',
    passwordPlaceholder: 'กรอกรหัสผ่าน', remember: 'จำฉันไว้ในระบบ', forgot: 'ลืมรหัสผ่าน?',
    login: 'เข้าสู่ระบบ', loggingIn: 'กำลังเข้าสู่ระบบ...', facebook: 'เข้าสู่ระบบด้วย Facebook',
    or: 'หรือ', noAccount: 'ยังไม่มีบัญชีใช่ไหม?', registerFree: 'สมัครใช้งานฟรี',
    hasAccount: 'มีบัญชีอยู่แล้ว?', backLogin: 'กลับเข้าสู่ระบบ', registerTitle: 'สร้างบัญชี SnapBot',
    registerDescription: 'เริ่มต้นจัดการธุรกิจของคุณได้ง่าย ๆ', confirmPassword: 'ยืนยันรหัสผ่าน',
    confirmPasswordPlaceholder: 'กรอกรหัสผ่านอีกครั้ง', registerButton: 'สมัครใช้งานฟรี',
    registering: 'กำลังสร้างบัญชี...', forgotTitle: 'ลืมรหัสผ่าน', forgotDescription: 'กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้',
    sendLink: 'ส่งลิงก์ตั้งรหัสผ่าน', sending: 'กำลังส่ง...', forgotSent: 'หากอีเมลนี้สามารถรับคำขอได้ ระบบจะส่งลิงก์ตั้งรหัสผ่านให้ โปรดตรวจสอบกล่องจดหมาย',
    resetTitle: 'ตั้งรหัสผ่านใหม่', resetDescription: 'ตั้งรหัสผ่านใหม่เพื่อกลับเข้าสู่บัญชีของคุณ',
    newPassword: 'รหัสผ่านใหม่', newPasswordPlaceholder: 'อย่างน้อย 8 ตัวอักษร',
    savePassword: 'บันทึกรหัสผ่านใหม่', savingPassword: 'กำลังบันทึก...',
    passwordRule: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร', passwordMismatch: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
    loginFailure: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองอีกครั้ง',
    authFailure: 'ไม่สามารถดำเนินการได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    signupSuccess: 'หากอีเมลนี้สามารถสมัครได้ ระบบจะส่งลิงก์ยืนยันไปให้ โปรดตรวจสอบกล่องจดหมาย',
    resetSuccess: 'ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบอีกครั้ง',
    forgotError: 'ส่งคำขอไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่',
    registerError: 'สมัครสมาชิกไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่',
    resetError: 'ตั้งรหัสผ่านไม่สำเร็จ ลิงก์อาจหมดอายุ กรุณาขอลิงก์ใหม่',
    resetSignOutFailure: 'เปลี่ยนรหัสผ่านแล้ว แต่ระบบออกจากระบบให้อัตโนมัติไม่สำเร็จ กรุณาออกจากระบบด้วยตนเองก่อนเข้าใช้งานอีกครั้ง',
    facebookError: 'เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ กรุณาลองใหม่',
    providerNotice: 'เชื่อมต่อ Facebook ไม่ได้ กรุณาตรวจสอบการตั้งค่าผู้ให้บริการในระบบ',
    validationEmail: 'กรุณากรอกอีเมลให้ถูกต้อง',
    safeDemo: 'ภาพประกอบตัวอย่าง ไม่ใช่ข้อมูลจริง',
    terms: 'การเข้าสู่ระบบถือว่าคุณยอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว',
  },
  en: {
    tagline: 'Your intelligent assistant', subtitle: 'for online businesses',
    description: 'Reply to chats, care for customers, verify payments, and follow up on sales with AI in one place.',
    features: [
      ['Chat automation', 'Reply to messages automatically'], ['Slip verification', 'Verify customer payments'],
      ['Customer follow-up', 'Keep customers engaged'], ['Business insights', 'Understand your business'],
      ['Smart AI', 'Answer questions and recommend products'], ['Easy setup', 'Manage everything in one place'],
    ],
    showcase: 'Product preview', demoChat: 'What products do you recommend?', demoReply: 'I would be happy to help.',
    floating: ['Automated replies', 'Customer care, around the clock'],
    benefits: [['Secure', 'Your data stays protected'], ['Simple', 'Get started right away'], ['Here to help', 'Support when you need it']],
    loginTitle: 'Sign in', loginDescription: 'Welcome back. Sign in to manage your business.',
    email: 'Email', emailPlaceholder: 'Enter your email', password: 'Password',
    passwordPlaceholder: 'Enter your password', remember: 'Remember me', forgot: 'Forgot password?',
    login: 'Sign in', loggingIn: 'Signing in...', facebook: 'Continue with Facebook',
    or: 'or', noAccount: "Don't have an account?", registerFree: 'Start for free',
    hasAccount: 'Already have an account?', backLogin: 'Back to sign in', registerTitle: 'Create your SnapBot account',
    registerDescription: 'Start managing your business with ease', confirmPassword: 'Confirm password',
    confirmPasswordPlaceholder: 'Enter your password again', registerButton: 'Create free account',
    registering: 'Creating account...', forgotTitle: 'Reset your password', forgotDescription: 'Enter your account email and we will send you a password reset link.',
    sendLink: 'Send reset link', sending: 'Sending...', forgotSent: 'If this email can receive a reset request, we will send a link. Please check your inbox.',
    resetTitle: 'Choose a new password', resetDescription: 'Set a new password to access your account.',
    newPassword: 'New password', newPasswordPlaceholder: 'At least 8 characters',
    savePassword: 'Save new password', savingPassword: 'Saving...',
    passwordRule: 'Password must be at least 8 characters', passwordMismatch: 'The passwords do not match.',
    loginFailure: 'Email or password is incorrect. Please try again.',
    authFailure: 'Unable to complete your request right now. Please try again.',
    signupSuccess: 'If this email can be registered, we will send a confirmation link. Please check your inbox.',
    resetSuccess: 'Your password has been updated. Please sign in again.',
    forgotError: 'Could not send the request. Check your connection and try again.',
    registerError: 'Could not create your account. Check your details and try again.',
    resetError: 'Could not update your password. The link may have expired; request a new one.',
    resetSignOutFailure: 'Your password was changed, but automatic sign-out failed. Please sign out manually before using the account again.',
    facebookError: 'Facebook sign-in failed. Please try again.',
    providerNotice: 'Could not connect to Facebook. Check the provider configuration.',
    validationEmail: 'Enter a valid email address.',
    safeDemo: 'Illustrative preview, not real business data',
    terms: 'By signing in, you agree to our Terms of Service and Privacy Policy.',
    loadingSession: 'Checking session...',
  },
} as const

const featureIcons = [MessageCircle, ShieldCheck, UsersRound, BarChart3, Sparkles, Settings2]

function BrandLogo({ size = 48 }: { size?: number }) {
  return <Image src="/logo-icon.png" alt="SnapBot" width={size} height={size} className="shrink-0 object-contain" />
}

function SocialFacebookIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-[#1877F2]"><path fill="currentColor" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07" /></svg>
}

function ProductShowcase({ t }: { t: typeof copy[Locale] }) {
  return (
    <div className="auth-showcase relative mx-auto mt-8 w-full max-w-[660px]" aria-label={t.showcase}>
      <span className="absolute -right-1 -top-7 z-20 hidden h-[62px] w-[62px] place-items-center rounded-[22px] border border-white/80 bg-gradient-to-br from-white to-orange-100 text-orange-600 shadow-xl shadow-orange-900/10 sm:grid auth-float">
        <Bot size={31} strokeWidth={1.8}/>
        <span className="absolute -bottom-1 -right-1 rounded-full border-2 border-[#fff9f5] bg-emerald-500 p-1" aria-hidden/>
      </span>
      <span className="absolute -left-3 top-12 z-20 hidden items-center gap-2 rounded-2xl border border-white/70 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg backdrop-blur sm:flex auth-float">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-orange-100 text-orange-600"><MessageCircle size={17}/></span>{t.floating[0]}
      </span>
      <span className="absolute -right-2 top-24 z-20 hidden items-center gap-2 rounded-2xl border border-white/70 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg backdrop-blur sm:flex auth-float auth-float-delay">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-100 text-amber-600"><Headphones size={17}/></span>{t.floating[1]}
      </span>
      <div className="relative mx-auto w-[91%] rounded-t-[22px] border-[5px] border-slate-800 bg-slate-800 p-1.5 shadow-2xl shadow-orange-900/15">
        <div className="overflow-hidden rounded-t-[14px] bg-white">
          <div className="flex h-8 items-center gap-1.5 bg-slate-900 px-3">
            <i className="h-1.5 w-1.5 rounded-full bg-rose-400"/><i className="h-1.5 w-1.5 rounded-full bg-amber-400"/><i className="h-1.5 w-1.5 rounded-full bg-emerald-400"/>
            <span className="ml-2 text-[9px] font-medium text-slate-300">SnapBot · {t.showcase}</span>
          </div>
          <div className="grid min-h-[170px] grid-cols-[92px_1fr] sm:min-h-[194px] sm:grid-cols-[118px_1fr]">
            <aside className="space-y-3 bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-800"><BrandLogo size={19}/>SnapBot</div>
              {[t.features[0][0], t.features[1][0], t.features[3][0]].map((item, index) => <div key={item} className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[8px] ${index === 0 ? 'bg-orange-100 font-semibold text-orange-700' : 'text-slate-500'}`}><Activity size={10}/>{item}</div>)}
            </aside>
            <div className="p-3 sm:p-4">
              <p className="text-[9px] font-semibold text-slate-800">{t.showcase} <span className="ml-1 rounded bg-orange-50 px-1.5 py-0.5 font-normal text-orange-600">{t.safeDemo}</span></p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[t.features[0][0], t.features[1][0], t.features[2][0]].map((item, index) => <div key={item} className="rounded-lg border border-slate-100 p-2"><span className="block h-1 w-8 rounded bg-slate-100"/><span className={`mt-2 block h-3 w-8 rounded ${index === 1 ? 'bg-amber-200' : 'bg-orange-100'}`}/><span className="mt-2 block h-1 w-12 rounded bg-slate-100"/></div>)}
              </div>
              <div className="mt-3 flex h-10 items-end gap-1 rounded-lg bg-orange-50/60 px-3 pb-1.5">
                {[30, 50, 40, 68, 52, 82, 63, 90, 72, 100, 75, 94].map((height, i) => <span key={i} style={{ height: `${height}%` }} className="flex-1 rounded-t-sm bg-gradient-to-t from-orange-500 to-amber-300 opacity-80"/> )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto -mt-1 h-3 w-full rounded-b-xl bg-gradient-to-b from-slate-300 to-slate-500 shadow-lg"/>
      <div className="absolute -bottom-1 right-[8%] hidden h-[176px] w-[86px] rounded-[19px] border-[4px] border-slate-800 bg-slate-900 p-1 shadow-xl sm:block auth-float auth-float-delay">
        <div className="h-full overflow-hidden rounded-[13px] bg-white p-2">
          <div className="mx-auto mb-3 h-1 w-7 rounded-full bg-slate-300"/>
          <div className="flex items-center gap-1 text-[7px] font-bold"><BrandLogo size={14}/>SnapBot</div>
          <div className="mt-5 space-y-2">
            <p className="w-[85%] rounded-lg rounded-tl-none bg-slate-100 p-1.5 text-[6px] leading-tight">{t.demoChat}</p>
            <p className="ml-auto w-[85%] rounded-lg rounded-tr-none bg-orange-100 p-1.5 text-[6px] leading-tight text-orange-900">{t.demoReply}</p>
          </div>
          <div className="mt-5 h-5 rounded-md bg-orange-500"/>
        </div>
      </div>
      <div className="pointer-events-none absolute -bottom-8 left-1/2 -z-10 h-20 w-[85%] -translate-x-1/2 rounded-full bg-orange-300/35 blur-3xl"/>
    </div>
  )
}

export function AuthExperience({
  mode, next = '/overview', locale: initialLocale = 'th', oauthError, notice,
}: {
  mode: Mode
  next?: string
  locale?: Locale
  oauthError?: string
  notice?: string
}) {
  const router = useRouter()
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(oauthError ? oauthErrorMessage(oauthError) : null)
  const [success, setSuccess] = useState<string | null>(notice === 'password_reset' ? copy[locale].resetSuccess : notice === 'registered' ? copy[locale].signupSuccess : null)
  const t = copy[locale]
  const isLogin = mode === 'login'
  const isRegister = mode === 'register'
  const title = isLogin ? t.loginTitle : isRegister ? t.registerTitle : mode === 'forgot' ? t.forgotTitle : t.resetTitle
  const description = isLogin ? t.loginDescription : isRegister ? t.registerDescription : mode === 'forgot' ? t.forgotDescription : t.resetDescription
  const encodedNext = encodeURIComponent(safeAuthNext(next, '/overview'))
  const loginHref = `/login?lang=${locale}&next=${encodedNext}`
  const registerHref = `/register?lang=${locale}&next=${encodedNext}`
  const forgotHref = `/forgot-password?lang=${locale}&next=${encodedNext}`

  function switchLocale(value: Locale) {
    setLocale(value)
    setError(null)
    if (success) {
      setSuccess(notice === 'password_reset' ? copy[value].resetSuccess
        : notice === 'registered' || mode === 'register' ? copy[value].signupSuccess
          : mode === 'forgot' ? copy[value].forgotSent : null)
    }
    const params = new URLSearchParams(location.search)
    params.set('lang', value)
    router.replace(`${location.pathname}?${params.toString()}`, { scroll: false })
  }

  function fieldClass() {
    return 'h-12 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-orange-500 focus:ring-4 focus:ring-orange-100'
  }

  async function onFacebook() {
    setBusy(true)
    setError(null)
    try {
      rememberOAuthNext(safeAuthNext(next, '/overview'))
      const redirectTo = facebookRedirectTo(location.origin)
      const { error: authError } = await supabaseAuthBrowser(remember).auth.signInWithOAuth({
        provider: 'facebook',
        options: { redirectTo, scopes: FACEBOOK_LOGIN_SCOPES },
      })
      if (authError) throw authError
    } catch {
      setError(t.providerNotice)
      setBusy(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    const normalizedEmail = email.trim()
    if ((isLogin || isRegister || mode === 'forgot') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError(t.validationEmail)
      setBusy(false)
      return
    }
    try {
      const supabase = supabaseAuthBrowser(remember)
      if (isLogin) {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
        if (authError) {
          setError(t.loginFailure)
          return
        }
        router.replace(safeAuthNext(next, '/overview'))
        router.refresh()
      } else if (isRegister) {
        if (password.length < 8) {
          setError(t.passwordRule)
          return
        }
        if (password !== confirmPassword) {
          setError(t.passwordMismatch)
          return
        }
        const confirmationPath = `/login?lang=${locale}&registered=1&next=${encodedNext}`
        const emailRedirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(confirmationPath)}`
        const { error: authError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo },
        })
        if (authError) throw authError
        setSuccess(t.signupSuccess)
      } else if (mode === 'forgot') {
        const resetPath = `/reset-password?lang=${locale}&next=${encodedNext}`
        const redirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(resetPath)}`
        const { error: authError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo })
        if (authError) throw authError
        setSuccess(t.forgotSent)
      } else {
        if (password.length < 8) {
          setError(t.passwordRule)
          return
        }
        if (password !== confirmPassword) {
          setError(t.passwordMismatch)
          return
        }
        const { error: authError } = await supabase.auth.updateUser({ password })
        if (authError) throw authError
        try {
          const { error: signOutError } = await supabase.auth.signOut()
          if (signOutError) {
            setError(t.resetSignOutFailure)
            return
          }
        } catch {
          setError(t.resetSignOutFailure)
          return
        }
        router.replace(`${loginHref}&password_reset=1`)
      }
    } catch {
      setError(mode === 'register' ? t.registerError : mode === 'forgot' ? t.forgotError : mode === 'reset' ? t.resetError : t.authFailure)
    } finally {
      setBusy(false)
    }
  }

  const passwordField = (label: string, placeholder: string, value: string, onChange: (value: string) => void, autoComplete: string) => (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <span className="relative block">
        <LockKeyhole aria-hidden className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"/>
        <input className={fieldClass()} type={showPassword ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} autoComplete={autoComplete} placeholder={placeholder} required minLength={mode === 'login' ? undefined : 8}/>
        <button type="button" aria-label={showPassword ? (locale === 'th' ? 'ซ่อนรหัสผ่าน' : 'Hide password') : (locale === 'th' ? 'แสดงรหัสผ่าน' : 'Show password')} onClick={() => setShowPassword(current => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-orange-500">
          {showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}
        </button>
      </span>
    </label>
  )

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#fff9f5] text-[#111827] lg:grid lg:grid-cols-[minmax(0,1.42fr)_minmax(390px,1fr)]">
      <section className="relative hidden min-w-0 overflow-hidden px-8 py-7 lg:flex lg:flex-col xl:px-12 2xl:px-16">
        <div className="pointer-events-none absolute -left-28 top-48 h-80 w-80 rounded-full bg-orange-200/40 blur-3xl"/>
        <div className="pointer-events-none absolute -right-20 top-0 h-96 w-96 rounded-full bg-amber-100/70 blur-3xl"/>
        <div className="relative z-10 flex items-center gap-3">
          <BrandLogo size={54}/>
          <div>
            <p className="text-[25px] font-extrabold leading-none tracking-tight">Snap<span className="text-[#f4511e]">Bot</span></p>
            <p className="mt-1 text-xs font-medium tracking-wide text-slate-500">AI Business Assistant</p>
          </div>
        </div>

        <div className="relative z-10 mt-8 max-w-2xl xl:mt-10">
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-orange-700">{t.tagline}</p>
          <h1 className="mt-2 text-4xl font-extrabold leading-[1.12] tracking-tight text-slate-950 xl:text-[52px]">
            {t.tagline}<br/><span className="text-[#f4511e]">{t.subtitle}</span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">{t.description}</p>
        </div>

        <div className="relative z-10 mt-6 grid max-w-[660px] grid-cols-3 gap-2.5 xl:gap-3">
          {t.features.map(([titleText, descriptionText], index) => {
            const Icon = featureIcons[index]
            return (
              <article key={titleText} className="flex min-h-[72px] items-center gap-2.5 rounded-2xl border border-white/90 bg-white/75 px-2.5 py-2.5 shadow-sm shadow-orange-900/[0.03] backdrop-blur sm:px-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-50 text-[#f4511e]"><Icon size={18} strokeWidth={2.2}/></span>
                <span className="min-w-0"><span className="block truncate text-[11px] font-bold text-slate-900 xl:text-xs">{titleText}</span><span className="mt-0.5 block text-[10px] leading-4 text-slate-500 xl:text-[11px]">{descriptionText}</span></span>
              </article>
            )
          })}
        </div>

        <ProductShowcase t={t}/>

        <div className="relative z-10 mt-auto grid max-w-[660px] grid-cols-3 gap-2 border-t border-orange-100/80 pt-5">
          {t.benefits.map(([titleText, detail]) => (
            <div key={titleText} className="flex items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#f4511e] text-white"><Check size={16}/></span>
              <span><span className="block text-xs font-bold">{titleText}</span><span className="block text-[10px] text-slate-500">{detail}</span></span>
            </div>
          ))}
        </div>
      </section>

      <section className="relative flex min-h-screen min-w-0 flex-col bg-white px-5 py-5 sm:px-8 lg:items-center lg:justify-center lg:border-l lg:border-orange-100 lg:px-10 xl:px-14">
        <div className="absolute right-5 top-5 z-10 sm:right-8 sm:top-7 lg:right-8">
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <span aria-hidden>{locale === 'th' ? '🇹🇭' : '🇬🇧'}</span>
            <span className="sr-only">{locale === 'th' ? 'ภาษา' : 'Language'}</span>
            <select aria-label={locale === 'th' ? 'เลือกภาษา' : 'Select language'} value={locale} onChange={event => switchLocale(event.target.value as Locale)} className="cursor-pointer bg-transparent outline-none">
              <option value="th">ไทย</option><option value="en">English</option>
            </select>
          </label>
        </div>

        <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center pb-10 pt-16 sm:pt-14 lg:flex-none lg:py-10">
          <div className="mb-7 text-center">
            <Link href={loginHref} className="mx-auto mb-3 grid h-[76px] w-[76px] place-items-center rounded-[25px] bg-orange-50 ring-1 ring-orange-100 transition hover:scale-[1.03]">
              <BrandLogo size={67}/>
            </Link>
            <p className="text-2xl font-extrabold tracking-tight">Snap<span className="text-[#f4511e]">Bot</span></p>
            <p className="mt-1 text-xs font-medium tracking-wide text-slate-500">AI Business Assistant</p>
            <h2 className="mt-6 text-[26px] font-bold tracking-tight text-slate-900">{title}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">{description}</p>
          </div>

          {success && <p role="status" className="mb-4 flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm leading-5 text-emerald-800"><ShieldCheck size={18} className="mt-0.5 shrink-0"/>{success}</p>}
          {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm leading-5 text-rose-700">{error}</p>}

          <form onSubmit={onSubmit} className="space-y-4">
            {(isLogin || isRegister || mode === 'forgot') && (
              <label className="block space-y-1.5">
                <span className="text-sm font-semibold text-slate-800">{t.email}</span>
                <span className="relative block">
                  <Mail aria-hidden className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400"/>
                  <input className={fieldClass()} type="email" inputMode="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder={t.emailPlaceholder}/>
                </span>
              </label>
            )}

            {(isLogin || isRegister || mode === 'reset') && passwordField(
              mode === 'reset' || isRegister ? t.newPassword : t.password,
              mode === 'reset' || isRegister ? t.newPasswordPlaceholder : t.passwordPlaceholder,
              password, setPassword,
              isLogin ? 'current-password' : 'new-password',
            )}

            {(isRegister || mode === 'reset') && passwordField(
              t.confirmPassword, t.confirmPasswordPlaceholder, confirmPassword, setConfirmPassword, 'new-password',
            )}

            {isLogin && (
              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-slate-600">
                  <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[#f4511e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"/>
                  {t.remember}
                </label>
                <Link href={forgotHref} className="font-semibold text-[#e65100] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-orange-500">{t.forgot}</Link>
              </div>
            )}

            <button type="submit" disabled={busy} aria-busy={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#ff6b00] to-[#f4511e] px-4 text-sm font-bold text-white shadow-sm shadow-orange-200 transition hover:brightness-[1.03] hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 active:scale-[.99] disabled:cursor-wait disabled:opacity-65">
              {busy ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden/>{isLogin ? t.loggingIn : isRegister ? t.registering : mode === 'forgot' ? t.sending : t.savingPassword}</> : <>{mode === 'forgot' ? <Send size={17}/> : mode === 'reset' ? <KeyRound size={17}/> : <ArrowRight size={17}/>} {isLogin ? t.login : isRegister ? t.registerButton : mode === 'forgot' ? t.sendLink : t.savePassword}</>}
            </button>
          </form>

          {isLogin && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200"/>{t.or}<span className="h-px flex-1 bg-slate-200"/></div>
              <button type="button" onClick={() => void onFacebook()} disabled={busy} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-60">
                <SocialFacebookIcon/>{t.facebook}
              </button>
            </>
          )}

          <div className="mt-6 text-center text-sm text-slate-500">
            {isLogin ? <>{t.noAccount} <Link href={registerHref} className="font-bold text-[#e65100] underline-offset-4 hover:underline">{t.registerFree}</Link></>
              : isRegister ? <>{t.hasAccount} <Link href={loginHref} className="font-bold text-[#e65100] underline-offset-4 hover:underline">{t.backLogin}</Link></>
                : <Link href={loginHref} className="inline-flex items-center gap-1.5 font-semibold text-[#e65100] hover:underline"><ArrowLeft size={15}/>{t.backLogin}</Link>}
          </div>
          <p className="mt-7 text-center text-[11px] leading-5 text-slate-400">{t.terms}</p>
        </div>
      </section>
    </main>
  )
}
