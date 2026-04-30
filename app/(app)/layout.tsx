import { RequireAuth } from '@/components/require-auth';

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
