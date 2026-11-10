import { PROTOCOL_VERSION } from '@gapless/protocol';

export default function HomePage() {
  return (
    <main className='shell'>
      <h1>gapless</h1>
      <p>
        Phase 0 scaffold. Protocol v{PROTOCOL_VERSION}. See docs/ROADMAP.md.
      </p>
    </main>
  );
}
