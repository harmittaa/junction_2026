import { defineConfig } from "vitest/config";
import base from "./vitest.config";
export default defineConfig({ ...base, test: { include: ["tests/**/*.emulator.test.ts"], exclude: [], testTimeout: 20000 } });
