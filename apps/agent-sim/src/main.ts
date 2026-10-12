#!/usr/bin/env node
// `analyzr-agent-sim` entry point; Node 24 runs this TypeScript file directly (type stripping).
import { runSim } from './program.ts';

process.exitCode = await runSim(process.argv.slice(2));
