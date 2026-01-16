import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { z } from 'zod';

const RepoSchema = z.object({
  owner: z.string(),
  name: z.string(),
  default_branch: z.string().default('main'),
  prompt_path: z.string().default('prompt.md'),
});

const ConfigSchema = z.object({
  slack: z.object({
    app_token: z.string(),
    bot_token: z.string(),
    signing_secret: z.string().optional(),
  }),
  github: z.object({
    token: z.string(),
  }),
  factory: z.object({
    default_api_key: z.string().optional(),
  }).optional(),
  auth: z.object({
    admins: z.array(z.string()).default([]),
    operators: z.array(z.string()).default([]),
  }),
  repos: z.array(RepoSchema).default([]),
  user_keys: z.record(z.string()).default({}),
  concurrency: z.object({
    max_parallel_loops: z.number().default(3),
    max_per_repo: z.number().default(1),
  }).default({}),
  notifications: z.object({
    update_interval_ms: z.number().default(5000),
    thread_updates: z.boolean().default(true),
    pin_status: z.boolean().default(true),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type Repo = z.infer<typeof RepoSchema>;

let config: Config | null = null;

export function loadConfig(path = 'config.yaml'): Config {
  if (config) return config;

  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}. Copy config.example.yaml to config.yaml`);
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = parse(raw);
  config = ConfigSchema.parse(parsed);
  return config;
}

export function getConfig(): Config {
  if (!config) {
    return loadConfig();
  }
  return config;
}

export function getRepo(owner: string, name: string): Repo | undefined {
  const cfg = getConfig();
  return cfg.repos.find(r => r.owner === owner && r.name === name);
}

export function getFactoryKey(userId: string): string | undefined {
  const cfg = getConfig();
  return cfg.user_keys[userId] || cfg.factory?.default_api_key;
}
