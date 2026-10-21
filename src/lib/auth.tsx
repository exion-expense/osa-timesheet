import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Profile, Role } from './types'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  mfaRequired: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  is: (...roles: Role[]) => boolean
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [mfaRequired, setMfaRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const loadedUser = useRef<string | null>(null)

  // ตั้ง session พร้อมกับ profile ในครั้งเดียว เพื่อไม่ให้หน้า "ไม่มีสิทธิ์" แว่บขึ้นระหว่างโหลดตำแหน่ง
  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      loadedUser.current = null
      setSession(null)
      setProfile(null)
      setMfaRequired(false)
      setLoading(false)
      return
    }
    if (loadedUser.current !== s.user.id) setLoading(true)
    const [{ data: p }, { data: need }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('mfa_required'),
    ])
    loadedUser.current = s.user.id
    setSession(s)
    setProfile((p as Profile) ?? null)
    setMfaRequired(Boolean(need))
    setLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => load(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED') {
        setSession(s)
        return
      }
      // ผู้ใช้คนใหม่: แสดงตัวโหลดทันที จนกว่าจะรู้ตำแหน่ง
      if (s && loadedUser.current !== s.user.id) setLoading(true)
      // เลื่อนออกจาก callback ตามคำแนะนำของ supabase-js เพื่อไม่ให้ deadlock
      setTimeout(() => load(s), 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    await load(data.session)
  }, [load])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    sessionStorage.clear()
  }, [])

  const is = useCallback(
    (...roles: Role[]) => Boolean(profile?.active && profile.role && roles.includes(profile.role)),
    [profile],
  )

  return (
    <Ctx.Provider value={{ loading, session, profile, mfaRequired, refresh, signOut, is }}>{children}</Ctx.Provider>
  )
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
