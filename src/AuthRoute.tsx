import { AuthPage } from './Auth'

export default function AuthRoute({ mode }: { mode: 'login' | 'register' }) {
  return <AuthPage mode={mode} />
}
