import './globals.css';
import './styles/panels.css';
import './styles/home.css';
import './styles/editor.css';
import './styles/units.css';
import './styles/viewer.css';
import './styles/login.css';
import './styles/materials.css';
import './styles/ar.css';
import StagingBanner from '@/components/StagingBanner';

export const metadata = {
  title: 'XRS Showroom',
  description: '3D Scene Manager — Create, edit, and showcase 3D scenes with GLB models and Gaussian Splats',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        {children}
        <StagingBanner />
      </body>
    </html>
  );
}
