/**
 * pnpm proof:perform — perform mode (ADR-0025; .artifacts/stage-plan.md "PROOF (lead)" as corrected by its verifier). LEAD: the
 * entry point and the list of checks; the checks are built once W1 (moves.ts), W2 (cameraPath.ts) and W3 (the view and the
 * player port) are merged. Until then it runs nothing and exits 2 (blocked), the exit code the proofs use for "cannot run
 * here", never a pass. Writes .artifacts/perform/perform-proof.json and docs/evidence/perform-proof.json when built.
 *
 * Checks (CPU unless said):
 *  Q1 quantise: 64 taps at beat ± U(−60, 60) ms (seeded) over a 120 BPM click track land on frameOfSeconds(beat); half beat, ÷2, ×2.
 *  F1 flash: one take alternating two colour pads at 20 taps a second; F2 one take alternating the strobe pad with colour pads —
 *     both exports pass flashCheck, and the same takes with the rule switched off fail it (control); the strobe part runs under
 *     the software-adapter launch of proof:gpu and is labelled so (blocked, exit 2, without it).
 *  B1 barcode: frames identified by their position in the exported file; zoom measured on lossless stills 1.18 ± 0.02; the frame
 *     before the hit and after the release byte-identical to the stills before the take.
 *  C1 camera: stills within 0.01 of the dense path, export within 0.03; no magenta-background pixel on 12 stills; a partial
 *     retake keeps the keys outside its range.
 *  D1 determinism: SHA-256 of canonical apply_take args equal across two runs and between Node (POST /takes dryRun) and the browser.
 *  U1 undo: document hash after undo equals before the take; redo equals after; Store.replay equals the stored document.
 *  N1 nothing committed while playing: revision unchanged through the take, +1 on accept, one history entry; the sound session is
 *     the same object before and after 50 injected taps; plan + apply for 200 hits under one frame period (pass or fail).
 *  K1 keyboard take: wiring only (captured time within 30 ms of the audio clock read in the same handler). Latency: not checked.
 *  P1 preview equals stills on the hit frames; S1 sound hits start within one frame; A1 accessibility audit and a keyboard-only take.
 */
console.error('perform-proof: not built yet (ADR-0025); nothing was measured');
process.exit(2);
