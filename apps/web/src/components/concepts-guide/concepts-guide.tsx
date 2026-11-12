'use client';

import { useState } from 'react';

interface Concept {
  id: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  description: string;
  details: string[];
}

const CONCEPTS: Concept[] = [
  {
    id: 'seq',
    title: 'Sequence Number (seq)',
    subtitle: 'Global Monotonic Ordering',
    badge: 'Core Contract',
    badgeColor: 'bg-emerald-950 text-emerald-400 border-emerald-800',
    description:
      'Every price tick assigned strictly monotonic integer (+1 per delta) on server. Never coalesced or skipped. Sequence contiguity guarantees zero state divergence between server and client.',
    details: [
      'Position defined as (epoch, seq) tuple.',
      'Gate rule: delta valid if seq === lastSeq + 1.',
      'Duplicates (seq <= lastSeq) dropped silently.',
      'Gaps (seq > lastSeq + 1) buffered in pending window.',
    ],
  },
  {
    id: 'epoch',
    title: 'Epoch',
    subtitle: 'Stream Generation Token',
    badge: 'Identity',
    badgeColor: 'bg-purple-950 text-purple-400 border-purple-800',
    description:
      'Opaque string generated upon feed creation or restart. Any config, universe, or seed change emits a new epoch. In-band positions from stale epochs are rejected.',
    details: [
      'Mismatched epoch immediately invalidates client quote map.',
      'Forces clean snapshot fetch from HTTP API.',
      'Prevents applying deltas computed from different universe base prices.',
    ],
  },
  {
    id: 'gap',
    title: 'Gap Detection',
    subtitle: 'Out-of-Order & Loss Handling',
    badge: 'Fault Tolerance',
    badgeColor: 'bg-amber-950 text-amber-400 border-amber-800',
    description:
      'When client receives a delta with seq > lastSeq + 1, a gap is detected. The ahead deltas are placed into a bounded pending buffer (max 256) while waiting for reordered packets.',
    details: [
      '100 ms debounce timer allows reordered deltas to bridge the gap without server chatter.',
      'Buffer overflow or timeout triggers an in-band resume request.',
      'Missing prints are requested before user sees stale quotes.',
    ],
  },
  {
    id: 'replay',
    title: 'Replay Buffer',
    subtitle: 'Bounded Low-Latency Catch-up',
    badge: 'RingBuffer',
    badgeColor: 'bg-blue-950 text-blue-400 border-blue-800',
    description:
      'The server maintains an in-memory fixed-capacity circular RingBuffer of recent deltas (configured window, e.g. 30 seconds). Subscriptions can resume in-band across short interruptions.',
    details: [
      'Client sends {type: "resume", epoch, seq} on open WebSocket.',
      'Server replays missing window in batches up to 1,000 deltas per frame.',
      'Queued live deltas drain seamlessly behind replayed frames.',
      'Avoids heavy JSON snapshot deserialization over HTTP.',
    ],
  },
  {
    id: 'snapshot',
    title: 'Snapshot Recovery',
    subtitle: 'Atomic Full State Synchronization',
    badge: 'Cold Recovery',
    badgeColor: 'bg-cyan-950 text-cyan-400 border-cyan-800',
    description:
      'When an outage exceeds the server replay ring window (expired), or an epoch change occurs, the client falls back to fetching a synchronous HTTP snapshot.',
    details: [
      'Built synchronously inside the server event loop: seq and quotes cannot tear.',
      'Client buffers live deltas during in-flight snapshot HTTP fetch.',
      'Deltas <= snapshot.seq discarded; remaining buffered deltas drain contiguously.',
      'Tested against server digest for byte-for-byte convergence.',
    ],
  },
  {
    id: 'chaos',
    title: 'Chaos Injection',
    subtitle: 'Per-Connection Stream Mutation',
    badge: 'Simulation',
    badgeColor: 'bg-rose-950 text-rose-400 border-rose-800',
    description:
      'Server-side chaos stage modifies outgoing frames on individual sockets without affecting feed state, seq contiguity, or other connected peers.',
    details: [
      'Drop: removes deltas with probability p (generates real global seq gaps).',
      'Duplicate: sends duplicate copies of deltas (tests client deduplication).',
      'Reorder: swaps adjacent packets (tests pending window draining).',
      'Silent: closes data/heartbeat transmission while keeping socket open (tests watchdog timeout).',
    ],
  },
];

export function ConceptsGuide() {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <section className='mt-8 rounded-lg border border-brand-border bg-brand-card p-5'>
      <div className='mb-4 flex items-center justify-between'>
        <div>
          <h2 className='text-base font-bold uppercase tracking-wider text-brand-fg'>
            Architecture & Synchronization Guide
          </h2>
          <p className='mt-1 text-xs text-brand-muted'>
            How gapless achieves continuous reliability and sub-millisecond
            recovery across unreliable streams.
          </p>
        </div>
        <span className='rounded bg-brand-border-subtle px-2.5 py-1 text-xs font-semibold text-brand-muted'>
          6 Core Concepts
        </span>
      </div>

      <div className='grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3'>
        {CONCEPTS.map((concept) => {
          const isOpen = openId === concept.id;
          return (
            <div
              key={concept.id}
              className='flex flex-col rounded-md border border-brand-border-subtle bg-brand-card-inner transition hover:border-brand-border'
            >
              <button
                type='button'
                aria-label={concept.title}
                aria-expanded={isOpen}
                aria-controls={`concept-details-${concept.id}`}
                onClick={() => toggle(concept.id)}
                className='flex w-full items-start justify-between p-3.5 text-left focus:outline-none'
              >
                <div>
                  <div className='flex items-center gap-2'>
                    <span className='text-sm font-bold text-brand-fg'>
                      {concept.title}
                    </span>
                  </div>
                  <div className='mt-0.5 text-xs text-brand-muted'>
                    {concept.subtitle}
                  </div>
                </div>
                <div className='flex items-center gap-2'>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${concept.badgeColor}`}
                  >
                    {concept.badge}
                  </span>
                  <span className='text-xs text-brand-muted transition-transform duration-200'>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>
              </button>

              <div
                id={`concept-details-${concept.id}`}
                className='px-3.5 pb-3.5'
              >
                <p className='text-xs leading-relaxed text-brand-fg/80'>
                  {concept.description}
                </p>

                {isOpen && (
                  <div className='mt-3 border-t border-brand-border-subtle pt-2.5'>
                    <ul className='space-y-1.5 text-xs text-brand-muted'>
                      {concept.details.map((detail) => (
                        <li key={detail} className='flex items-start gap-1.5'>
                          <span className='text-brand-up font-bold'>•</span>
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
