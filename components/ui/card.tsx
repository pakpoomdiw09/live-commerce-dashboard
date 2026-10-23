import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { PageBanner } from '@/components/ui/page-banner'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.03]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
  className,
  variant = 'page',
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  variant?: 'page' | 'section'
}) {
  const Container = variant === 'page' ? PageBanner : 'div'
  const Heading = variant === 'page' ? 'h1' : 'h2'
  return (
    <Container className={cn('flex flex-wrap items-center justify-between gap-4', className)}>
      <div className="min-w-0 flex-1 basis-64">
        <Heading
          className={cn(
            'text-xl font-semibold tracking-tight sm:text-2xl',
            variant === 'section' && 'text-slate-900',
          )}
        >
          {title}
        </Heading>
        {description && (
          <p
            className={cn(
              'mt-2 max-w-3xl text-sm leading-6',
              variant === 'page' ? 'text-white' : 'text-slate-500',
            )}
          >
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="flex max-w-full flex-wrap items-center gap-2 rounded-2xl bg-white p-2 text-slate-900">
          {action}
        </div>
      )}
    </Container>
  )
}
