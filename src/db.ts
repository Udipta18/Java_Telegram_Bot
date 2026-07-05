import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import WebSocket from 'ws';

// Polyfill WebSocket globally for Node.js v20 and below
// @ts-ignore
global.WebSocket = WebSocket;

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder-url.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'placeholder-key';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false
  }
});

export interface Question {
  id: number;
  question: string;
  topic: string | null;
  sub_topic: string | null;
  created_at: string;
  review_status: string;
  next_review_date: string | null;
  review_count: number;
  tags: string[];
}

/**
 * Saves a new interview question to Supabase.
 */
export async function saveQuestion(
  question: string,
  topic?: string,
  subTopic?: string,
  tags?: string[]
): Promise<Question> {
  const { data, error } = await supabase
    .from('questions')
    .insert({
      question,
      topic: topic || null,
      sub_topic: subTopic || null,
      tags: tags || []
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as Question;
}

/**
 * Retrieves questions, optionally filtering by topic.
 */
export async function getQuestions(topic?: string): Promise<Question[]> {
  let query = supabase.from('questions').select('*');

  if (topic) {
    query = query.eq('topic', topic);
  }

  // Order by created_at or id
  query = query.order('id', { ascending: true });

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || []) as Question[];
}

/**
 * Searches questions containing the keyword (case-insensitive).
 */
export async function searchQuestions(keyword: string): Promise<Question[]> {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .ilike('question', `%${keyword}%`)
    .order('id', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as Question[];
}

/**
 * Fetches questions due for daily practice.
 * Priority: revision-due questions first, then unseen questions.
 * Excludes questions marked as 'understood'.
 */
export async function getDailyPracticeQuestions(limit: number): Promise<Question[]> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // 1. Get revision-due questions (next_review_date <= today)
  const { data: revisionDue, error: revErr } = await supabase
    .from('questions')
    .select('*')
    .eq('review_status', 'revision')
    .lte('next_review_date', today)
    .order('next_review_date', { ascending: true })
    .limit(limit);

  if (revErr) {
    throw revErr;
  }

  const revisionQuestions = (revisionDue || []) as Question[];
  const remaining = limit - revisionQuestions.length;

  if (remaining <= 0) {
    return revisionQuestions.slice(0, limit);
  }

  // 2. Fill remaining slots with unseen questions
  const { data: unseenData, error: unseenErr } = await supabase
    .from('questions')
    .select('*')
    .eq('review_status', 'unseen')
    .order('id', { ascending: true })
    .limit(remaining);

  if (unseenErr) {
    throw unseenErr;
  }

  const unseenQuestions = (unseenData || []) as Question[];

  // Combine and shuffle to mix topics
  const combined = [...revisionQuestions, ...unseenQuestions];
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }
  return combined;
}

/**
 * Marks a question for revision — it will reappear in 2 days.
 */
export async function markQuestionRevision(id: number): Promise<void> {
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 2);
  const nextDateStr = nextDate.toISOString().split('T')[0];

  const { error } = await supabase
    .from('questions')
    .update({
      review_status: 'revision',
      next_review_date: nextDateStr,
      review_count: undefined // We'll handle increment separately
    })
    .eq('id', id);

  if (error) {
    throw error;
  }

  // Increment review_count using RPC or a separate update
  // Since Supabase JS doesn't support increment directly, we fetch and update
  const { data } = await supabase
    .from('questions')
    .select('review_count')
    .eq('id', id)
    .single();

  if (data) {
    await supabase
      .from('questions')
      .update({ review_count: (data.review_count || 0) + 1 })
      .eq('id', id);
  }
}

/**
 * Marks a question as fully understood — won't appear in daily practice again.
 */
export async function markQuestionUnderstood(id: number): Promise<void> {
  // Fetch current review_count first
  const { data } = await supabase
    .from('questions')
    .select('review_count')
    .eq('id', id)
    .single();

  const newCount = (data?.review_count || 0) + 1;

  const { error } = await supabase
    .from('questions')
    .update({
      review_status: 'understood',
      next_review_date: null,
      review_count: newCount
    })
    .eq('id', id);

  if (error) {
    throw error;
  }
}
