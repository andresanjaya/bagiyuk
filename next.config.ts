import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// Keep an active development preview from overwriting the production build.
export default function config(phase: string) {
  return { distDir: phase === PHASE_DEVELOPMENT_SERVER || process.env.VERCEL ? '.next' : '.next-production' };
}
