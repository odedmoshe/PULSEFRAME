/**
 * The proofs' default server mode (autonomy decision 5, verifier C14): every proof script runs `guarded` (today's behaviour)
 * unless PF_MODE is set, so the refusal-pinning proofs keep meaning what they meant. `PF_MODE=open pnpm proof:phase5` (also
 * lifeline, stills, craft, teach) runs the same checks against an open server. Loaded first by the root package.json proof
 * scripts (`tsx --import`); proof:autonomy sets its modes itself and does not load it. Servers a proof spawns inherit it.
 */
process.env.PF_MODE ??= 'guarded';
