import { Pool } from 'pg';

let poolSingleton: Pool | null = null;

function getPool(): Pool {
  if (!poolSingleton) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString || String(connectionString).trim() === '') {
      throw new Error('DATABASE_URL is not set. Define it in your .env');
    }
    poolSingleton = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }
  return poolSingleton;
}

export async function initDb(): Promise<void> {
  // Ensure table exists with the desired columns. New schema splits JSON into prompt_variables and ui_variables
  await getPool().query(`
    create table if not exists conversations (
      id uuid primary key,
      conversation_type text not null,
      prompt_name text,
      prompt_label text,
      agent_name text not null,
      webhook_link text not null,
      company_name text,
      prompt_text text,
      agent_description text,
      media_mode text not null default 'audio_only',
      prompt_variables jsonb not null default '{}'::jsonb,
      ui_variables jsonb not null default '{}'::jsonb,
      complete_screen jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
  `);

  // Add new columns if missing (for existing deployments)
  await getPool().query(`
    alter table conversations add column if not exists prompt_variables jsonb not null default '{}'::jsonb;
  `);
  await getPool().query(`
    alter table conversations add column if not exists ui_variables jsonb not null default '{}'::jsonb;
  `);
  await getPool().query(`
    alter table conversations add column if not exists company_name text;
  `);
  await getPool().query(`
    alter table conversations add column if not exists prompt_text text;
  `);
  await getPool().query(`
    alter table conversations add column if not exists agent_description text;
  `);
  await getPool().query(`
    alter table conversations add column if not exists complete_screen jsonb not null default '{}'::jsonb;
  `);
  await getPool().query(`
    alter table conversations add column if not exists media_mode text not null default 'audio_only';
  `);

  // If legacy meta_data column exists, migrate its values and drop it
  const metaDataExists = await getPool().query(
    `select 1 from information_schema.columns where table_name = 'conversations' and column_name = 'meta_data' limit 1`
  );
  if (metaDataExists.rowCount && metaDataExists.rowCount > 0) {
    await getPool().query(`
      update conversations
      set
        prompt_variables = coalesce((meta_data->'prompt_variables')::jsonb, '{}'::jsonb),
        ui_variables = coalesce((meta_data->'ui_variables')::jsonb, '{}'::jsonb)
      where meta_data is not null;
    `);
    await getPool().query(`alter table conversations drop column if exists meta_data;`);
  }
}

export type InsertConversationParams = {
  id: string;
  conversation_type: string;
  prompt_name?: string;
  prompt_label?: string;
  agent_name: string;
  webhook_link: string;
  company_name?: string;
  prompt_text?: string;
  agent_description?: string;
  media_mode?: 'audio_only' | 'audio_video';
  prompt_variables: Record<string, unknown>;
  ui_variables: Record<string, unknown>;
  complete_screen: Record<string, unknown>;
};

export async function insertConversation(params: InsertConversationParams): Promise<string> {
  const {
    id,
    conversation_type,
    prompt_name,
    prompt_label,
    agent_name,
    webhook_link,
    company_name,
    prompt_text,
    agent_description,
    media_mode,
    prompt_variables,
    ui_variables,
    complete_screen,
  } = params;

  const result = await getPool().query(
    `
      insert into conversations (
        id,
        conversation_type,
        prompt_name,
        prompt_label,
        agent_name,
        webhook_link,
        company_name,
        prompt_text,
        agent_description,
        media_mode,
        prompt_variables,
        ui_variables,
        complete_screen
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ($11)::jsonb, ($12)::jsonb, ($13)::jsonb)
      on conflict (id) do update set
        conversation_type = excluded.conversation_type,
        prompt_name = excluded.prompt_name,
        prompt_label = excluded.prompt_label,
        agent_name = excluded.agent_name,
        webhook_link = excluded.webhook_link,
        company_name = excluded.company_name,
        prompt_text = excluded.prompt_text,
        agent_description = excluded.agent_description,
        media_mode = excluded.media_mode,
        prompt_variables = excluded.prompt_variables,
        ui_variables = excluded.ui_variables,
        complete_screen = excluded.complete_screen
      returning id
    `,
    [
      id,
      conversation_type,
      prompt_name ?? null,
      prompt_label ?? null,
      agent_name,
      webhook_link,
      company_name ?? null,
      prompt_text ?? null,
      agent_description ?? null,
      (media_mode === 'audio_video' ? 'audio_video' : 'audio_only'),
      JSON.stringify(prompt_variables ?? {}),
      JSON.stringify(ui_variables ?? {}),
      JSON.stringify(complete_screen ?? {}),
    ],
  );

  return result.rows[0]?.id as string;
}


