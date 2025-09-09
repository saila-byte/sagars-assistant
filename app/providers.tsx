'use client';

import { ReactNode } from 'react';
import { CVIProvider } from './components/cvi/components/cvi-provider';


export default function Providers({ children }: { children: ReactNode }) {
  return <CVIProvider>{children}</CVIProvider>;
}
