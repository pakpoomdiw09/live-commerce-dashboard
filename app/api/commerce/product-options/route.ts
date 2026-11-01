import { NextRequest, NextResponse } from 'next/server'
import {
  commerceScope,
  commerceProductCategories,
  commerceResponse,
} from '@/lib/features/commerce/commerce-server'

export async function GET(req: NextRequest) {
  try {
    const scope = await commerceScope(req.nextUrl.searchParams.get('tenantId') ?? '', true, req)
    const categories = await commerceProductCategories(scope)
    return NextResponse.json({ categories }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return commerceResponse(error)
  }
}
