import { Link } from 'react-router'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-5xl font-bold text-slate-300">404</p>
      <p className="text-slate-600">ไม่พบหน้านี้</p>
      <Link to="/" className="text-sm font-medium text-brand-600 hover:underline">
        กลับหน้าแรก
      </Link>
    </div>
  )
}
