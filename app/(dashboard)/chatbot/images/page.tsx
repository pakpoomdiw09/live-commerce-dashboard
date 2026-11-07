import { redirect } from 'next/navigation'

/** Image replies use the shop catalog; old bookmarks open product management. */
export default function Page() {
  redirect('/shop')
}
