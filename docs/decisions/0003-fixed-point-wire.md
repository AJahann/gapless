# ADR 0003 — Fixed-point integers on the wire

Status: accepted.

Prices (1e6) and sizes (1e4) are integers in messages and in quote state;
formatting happens only in views. This buys exact client/server equality and a
canonical digest for the convergence tests, and removes float-drift arguments
from debugging. Cost is a small amount of scaling code in one module.
