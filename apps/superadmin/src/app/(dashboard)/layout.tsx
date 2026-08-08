import { LayoutProvider } from '@/context/LayoutContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/components/ui/Toast';
import { NotificationProvider } from '@/context/NotificationContext';
import LayoutWrapper from '@/components/layout/LayoutWrapper';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <NotificationProvider>
          <LayoutProvider>
            <LayoutWrapper>{children}</LayoutWrapper>
          </LayoutProvider>
        </NotificationProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
