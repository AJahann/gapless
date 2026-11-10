# ADR 0002 — (epoch, seq) positions

Status: accepted.

One global seq per feed, plus an epoch that changes on restart or config
change. Per-symbol seqs were rejected: they make gap detection per-symbol,
prevent cheap replay-ring indexing, and complicate the snapshot race.

Cost: a quiet symbol's quote does not change on most deltas — irrelevant,
since the quote map is keyed by symbol and seq only orders the stream.

The replay ring is indexed by seq (O(1) lookup of the resume start), which is
only possible because seq is global and contiguous.
