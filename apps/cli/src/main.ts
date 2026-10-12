#!/usr/bin/env node
// `analyzr` entry point; Node 24 runs this TypeScript file directly (type stripping).
import { runCli } from './program.ts';

process.exitCode = await runCli(process.argv.slice(2));
