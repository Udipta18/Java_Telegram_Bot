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
}

/**
 * Saves a new interview question to Supabase.
 */
export async function saveQuestion(
  question: string,
  topic?: string,
  subTopic?: string
): Promise<Question> {
  const { data, error } = await supabase
    .from('questions')
    .insert({
      question,
      topic: topic || null,
      sub_topic: subTopic || null
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
