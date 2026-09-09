-- ==============================================================================
-- DOMA UNITED FC - DATABASE & STORAGE SCHEMA (SUPABASE / POSTGRESQL)
-- ==============================================================================

-- 1. NEWS TABLE
CREATE TABLE IF NOT EXISTS public.news (
    id TEXT PRIMARY KEY,
    headline TEXT NOT NULL,
    category TEXT DEFAULT 'Club',
    summary TEXT,
    content TEXT,
    cover_image TEXT,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. GALLERY TABLE
CREATE TABLE IF NOT EXISTS public.gallery (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bio TEXT,
    src TEXT NOT NULL,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SQUAD (PLAYERS) TABLE
CREATE TABLE IF NOT EXISTS public.players (
    id TEXT PRIMARY KEY,
    player_name TEXT NOT NULL,
    position TEXT NOT NULL,
    number TEXT,
    status TEXT DEFAULT 'Starting XI',
    photo TEXT,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MATCHES TABLE
CREATE TABLE IF NOT EXISTS public.matches (
    id TEXT PRIMARY KEY,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT,
    venue TEXT,
    status TEXT DEFAULT 'Upcoming',
    home_score TEXT,
    away_score TEXT,
    matchday TEXT,
    home_logo TEXT,
    away_logo TEXT,
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. LIVE STREAMS TABLE
CREATE TABLE IF NOT EXISTS public.live_streams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    provider TEXT NOT NULL DEFAULT 'youtube',
    home_team TEXT,
    away_team TEXT,
    match_date DATE,
    match_time TIME,
    event_name TEXT,
    teams TEXT,
    competition TEXT,
    stream_url TEXT NOT NULL,
    thumbnail_url TEXT,
    scheduled_start TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('live', 'upcoming', 'offline')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.live_streams ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE public.live_streams ADD COLUMN IF NOT EXISTS home_team TEXT;
ALTER TABLE public.live_streams ADD COLUMN IF NOT EXISTS away_team TEXT;
ALTER TABLE public.live_streams ADD COLUMN IF NOT EXISTS match_date DATE;
ALTER TABLE public.live_streams ADD COLUMN IF NOT EXISTS match_time TIME;
ALTER TABLE public.live_streams DROP CONSTRAINT IF EXISTS live_streams_status_check;
ALTER TABLE public.live_streams ADD CONSTRAINT live_streams_status_check CHECK (status IN ('live', 'upcoming', 'offline'));

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Public can READ (SELECT).
-- Authenticated admins / Service Role can CREATE, UPDATE, DELETE.
-- ==============================================================================

ALTER TABLE public.news ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_streams ENABLE ROW LEVEL SECURITY;

-- Public READ policies
CREATE POLICY "Allow public read access to news"
    ON public.news FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access to gallery"
    ON public.gallery FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access to players"
    ON public.players FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access to matches"
    ON public.matches FOR SELECT TO anon, authenticated
    USING (true);

CREATE POLICY "Allow public read access to live streams"
    ON public.live_streams FOR SELECT TO anon, authenticated
    USING (true);

-- Admin WRITE policies (using service_role or authenticated users)
CREATE POLICY "Allow full access to service_role on news"
    ON public.news FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow full access to service_role on gallery"
    ON public.gallery FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow full access to service_role on players"
    ON public.players FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow full access to service_role on matches"
    ON public.matches FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow full access to service_role on live streams"
    ON public.live_streams FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Also allow authenticated admin users to insert/update/delete
CREATE POLICY "Allow authenticated users full access on news"
    ON public.news FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated users full access on gallery"
    ON public.gallery FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated users full access on players"
    ON public.players FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY "Allow authenticated users full access on matches"
    ON public.matches FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

-- The Express server uses SUPABASE_SERVICE_ROLE_KEY for admin writes.
-- Never expose that key in public JavaScript or commit it to source control.

-- ==============================================================================
-- STORAGE BUCKET (for Gallery, News Covers, Player Photos)
-- Run in Supabase SQL editor or create the bucket 'doma-uploads' in the dashboard.
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('doma-uploads', 'doma-uploads', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "Allow public read access on doma-uploads"
    ON storage.objects FOR SELECT TO anon, authenticated
    USING (bucket_id = 'doma-uploads');

CREATE POLICY "Allow authenticated / service_role upload to doma-uploads"
    ON storage.objects FOR INSERT TO authenticated, service_role
    WITH CHECK (bucket_id = 'doma-uploads');

CREATE POLICY "Allow authenticated / service_role update on doma-uploads"
    ON storage.objects FOR UPDATE TO authenticated, service_role
    USING (bucket_id = 'doma-uploads');

CREATE POLICY "Allow authenticated / service_role delete from doma-uploads"
    ON storage.objects FOR DELETE TO authenticated, service_role
    USING (bucket_id = 'doma-uploads');
