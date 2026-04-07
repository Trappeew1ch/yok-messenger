-- Migration: Add recovery_phrase_hash column to users table
-- Run this to add the seed phrase recovery column
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS recovery_phrase_hash TEXT;
