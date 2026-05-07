# ULMCode Eval Harness

This folder holds versioned scenario manifests for the ULM harness runner. Each
manifest maps one required harness capability to concrete checks and acceptance
criteria so future deep evals can grow without losing coverage of the original
ten harness gaps.

Fast scenarios are deterministic and free. Real-model and long-running chaos
variants should stay opt-in and emit scorecards under `.artifacts/ulm-harness/`.
