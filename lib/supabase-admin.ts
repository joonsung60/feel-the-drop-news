import { createClient } from '@supabase/supabase-js'

// 서버 전용 Supabase 클라이언트. RLS를 우회하는 service_role 키를 사용하므로
// 절대 클라이언트('use client') 코드에서 import 하지 마라. 백엔드 파이프라인
// (worker, lib/jobs, lib/suggest, app/api/**)에서만 사용한다.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.')
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
