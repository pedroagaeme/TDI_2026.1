import { defineConfig } from '@trigger.dev/sdk';

const projectRef = process.env.TRIGGER_PROJECT_REF?.trim();

if (!projectRef) {
  throw new Error('TRIGGER_PROJECT_REF is required.');
}

export default defineConfig({
  project: projectRef,
  dirs: ['./trigger'],
  maxDuration: 3600
});
