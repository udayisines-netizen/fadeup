import { Outlet } from 'react-router-dom'

export function RootLayout() {
  return (
    <div className="min-h-svh bg-paper-0">
      <Outlet />
    </div>
  )
}
