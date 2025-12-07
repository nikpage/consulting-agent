import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function Home() {
  const router = useRouter()
  
  useEffect(() => {
    const { code, state } = router.query
    if (code && state) {
      router.push(`/api/auth/google/callback?code=${code}&state=${state}`)
    }
  }, [router.query])
  
  return <div><h1>Sales Assistant</h1><p>Go to <a href="/admin/setup">/admin/setup</a></p></div>
}
