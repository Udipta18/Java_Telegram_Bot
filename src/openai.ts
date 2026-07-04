import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'placeholder'
});

/**
 * Classifies a given interview question text using OpenAI.
 * Returns the detected topic and subTopic.
 */
export async function classifyQuestion(question: string): Promise<{ topic: string; subTopic: string }> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      console.warn('Warning: OPENAI_API_KEY is not configured. Using fallback classification.');
      return { topic: 'General', subTopic: 'General' };
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an AI that classifies technical interview questions. Categorize the given interview question. Return a JSON object with keys "topic" (e.g., Java, Spring, SQL, Systems Design) and "subTopic" (e.g., Garbage Collection, Dependency Injection, Joins, Caching). Be concise, use title case.'
        },
        {
          role: 'user',
          content: question
        }
      ],
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(content);

    return {
      topic: parsed.topic || 'General',
      subTopic: parsed.subTopic || 'General'
    };
  } catch (error: any) {
    console.error('Error classifying question with OpenAI:', error?.message || error);
    return { topic: 'General', subTopic: 'General' };
  }
}

/**
 * Extracts interview questions from a base64 encoded image using OpenAI Vision.
 */
export async function extractQuestionsFromImage(base64Image: string): Promise<string[]> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      console.warn('Warning: OPENAI_API_KEY is not configured. Cannot perform OCR/vision extraction.');
      return [];
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an AI that extracts technical interview questions from screenshots. Ignore unnecessary text, headers, footers, or UI elements. Extract only the actual interview questions. Return a JSON object with a key "questions" containing a list of the extracted question strings.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract the interview questions from this image.'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ],
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(content);
    return parsed.questions || [];
  } catch (error: any) {
    console.error('Error extracting questions from image with OpenAI Vision:', error?.message || error);
    return [];
  }
}

