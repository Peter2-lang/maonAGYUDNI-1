import { config } from 'dotenv';

// Existing runtime variables win; local overrides take precedence over .env.
config({ path: ['.env.local', '.env'], quiet: true });
