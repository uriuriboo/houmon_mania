/**
 * zod は CSP で unsafe-eval を許可しないで動かすため、JIT(new Function による最適化)を無効にする(9.2.3、10.2)。
 * zod はこのモジュールから import する。
 */
import { z } from 'zod';

z.config({ jitless: true });

export { z };
