/**
 * Side-effect module for browser pages: import it BEFORE anything else from this package.
 * It tells the schema library to validate by interpretation instead of generated code. The library otherwise probes
 * `Function()` when the first schemas are built, which a strict content security policy reports as a violation
 * (the probe is caught and harmless, but a clean page should produce no violations). The server does not import this.
 */
import { z } from 'zod';

z.config({ jitless: true });
