-- Create questions table
CREATE TABLE IF NOT EXISTS questions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question TEXT NOT NULL,
    topic TEXT,
    sub_topic TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    review_status TEXT DEFAULT 'unseen',
    next_review_date DATE,
    review_count INTEGER DEFAULT 0,
    tags TEXT[] DEFAULT '{}'
);

-- If table already exists, add new columns
ALTER TABLE questions ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'unseen';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS next_review_date DATE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
