-- Grandpa's Studio hosted layer — schema for hosted-server
-- Postgres 15+

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null,
  avatar_color text not null default '#6750a4',
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_id_idx on sessions(user_id);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create type team_role as enum ('owner', 'admin', 'editor', 'viewer');

create table team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role team_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  team_id uuid not null references teams(id) on delete cascade,
  role team_role not null default 'editor',
  token_hash text not null unique,
  invited_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);
create index invites_team_id_idx on invites(team_id);

create table projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  name text not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index projects_team_id_idx on projects(team_id);

create table folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_folder_id uuid references folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index folders_project_id_idx on folders(project_id);

create table documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  name text not null default 'Untitled',
  updated_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  revision bigint not null default 0,
  deleted_at timestamptz,
  fig_object_key text not null,
  thumb_object_key text
);
create index documents_project_id_idx on documents(project_id);
create index documents_folder_id_idx on documents(folder_id);

create table favorites (
  user_id uuid not null references users(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, document_id)
);
