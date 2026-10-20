import type { ComponentProps } from 'react'
export default function Link({ children, ...props }: ComponentProps<'a'>) { return <a {...props}>{children}</a> }
