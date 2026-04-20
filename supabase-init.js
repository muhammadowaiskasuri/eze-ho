import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const SUPABASE_URL = 'https://tvowpberwugkcgjlvegp.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2b3dwYmVyd3Vna2Nnamx2ZWdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTEzODYsImV4cCI6MjA5MTU2NzM4Nn0.0USLMmslNip2iKhLnEwvtV5e_qb9QXSaNWOGkk1-gVU'
export const ADMIN_EMAIL = 'nccscargolahore@gmail.com'
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
