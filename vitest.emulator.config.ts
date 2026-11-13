import { mergeConfig } from "vitest/config";
import base from "./vitest.config";
export default mergeConfig(base, { test: { include: ["tests/**/*.emulator.test.ts"], exclude: [], testTimeout: 20000 } });
