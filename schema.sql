-- Create questions table
CREATE TABLE IF NOT EXISTS questions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question TEXT NOT NULL,
    topic TEXT,
    sub_topic TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
