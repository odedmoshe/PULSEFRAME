import path from 'node:path';
import { generateBarcodeFixture } from './index.ts';

const out = path.resolve(process.argv[2] ?? '.artifacts/fixtures/barcode_640x360_30fps_4s.mp4');
console.log(JSON.stringify(await generateBarcodeFixture({ out }), null, 2));
