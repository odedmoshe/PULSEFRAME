/**
 * Imported first by every page entry. The pages are served with a content security policy that forbids eval and
 * `Function()`; see packages/core/src/interpret.ts for why the schema library is configured before anything else loads.
 */
import '@pulseframe/core/interpret.ts';
