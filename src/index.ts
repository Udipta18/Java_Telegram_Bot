import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import cron from 'node-cron';
import { saveQuestion, getQuestions, searchQuestions, getDailyPracticeQuestions, markQuestionRevision, markQuestionUnderstood } from './db.js';
import { classifyQuestion, extractQuestionsFromImage } from './openai.js';

// Load environment variables from standard root and src/ directories
dotenv.config();
dotenv.config({ path: path.join(process.cwd(), 'src', '.ENV') });
dotenv.config({ path: path.join(process.cwd(), 'src', '.env') });

const app = express();
const port = process.env.PORT || 3000;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

// Parse JSON request bodies
app.use(express.json());

/**
 * Escapes HTML characters to prevent Telegram HTML parse mode errors.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Sends a daily practice session of 20 questions to the owner.
 */
async function sendDailyPractice(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !OWNER_CHAT_ID) {
    console.error('Cannot send daily practice: TELEGRAM_BOT_TOKEN or OWNER_CHAT_ID not set.');
    return;
  }

  try {
    const questions = await getDailyPracticeQuestions(20);

    if (questions.length === 0) {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: OWNER_CHAT_ID,
        text: '📚 <b>Daily Practice</b>\n\nNo questions due for practice today! All caught up 🎉',
        parse_mode: 'HTML'
      });
      return;
    }

    // Send header message
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: OWNER_CHAT_ID,
      text: `📚 <b>Daily Practice — ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}</b>\n\n${questions.length} questions for today. Good luck! 💪`,
      parse_mode: 'HTML'
    });

    // Send each question with inline buttons
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const questionText = `📝 <b>Q${i + 1}/${questions.length}</b> [${escapeHtml(q.topic || 'General')} / ${escapeHtml(q.sub_topic || 'General')}]\n\n${escapeHtml(q.question)}`;

      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: OWNER_CHAT_ID,
        text: questionText,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Need Revision', callback_data: `practice_revision:${q.id}` },
              { text: '✅ Fully Understood', callback_data: `practice_understood:${q.id}` }
            ]
          ]
        }
      });

      // Small delay to avoid hitting Telegram rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`Daily practice sent: ${questions.length} questions to chat ${OWNER_CHAT_ID}`);
  } catch (err: any) {
    console.error('Error sending daily practice:', err?.message || err);
  }
}

// Schedule daily practice cron job
// Default: '30 2 * * *' = 2:30 AM UTC = 8:00 AM IST
const cronExpression = process.env.DAILY_CRON || '30 2 * * *';
if (cron.validate(cronExpression)) {
  cron.schedule(cronExpression, () => {
    console.log(`[CRON] Daily practice triggered at ${new Date().toISOString()}`);
    sendDailyPractice();
  });
  console.log(`Daily practice cron scheduled: "${cronExpression}"`);
} else {
  console.error(`Invalid DAILY_CRON expression: "${cronExpression}". Cron job NOT scheduled.`);
}

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// External cron trigger endpoint
// Use a free service like cron-job.org to call this URL at 8 AM IST
// URL: https://your-app.onrender.com/cron/daily-practice?secret=YOUR_CRON_SECRET
app.get('/cron/daily-practice', async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is set, validate the request
  if (cronSecret && req.query.secret !== cronSecret) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  console.log(`[CRON] External daily practice triggered at ${new Date().toISOString()}`);
  await sendDailyPractice();
  res.json({ status: 'ok', message: 'Daily practice sent' });
});

// Telegram Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const { message, callback_query } = req.body;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    // Handle button clicks (callback queries)
    if (callback_query && callback_query.message && callback_query.message.chat) {
      const chatId = callback_query.message.chat.id;
      const data = callback_query.data;

      // Answer callback query immediately to clear the loading spinner
      if (botToken && botToken !== 'your_telegram_bot_token_here') {
        try {
          await axios.post(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
            callback_query_id: callback_query.id
          });
        } catch (err: any) {
          console.error('Error answering callback query:', err?.message || err);
        }
      }

      // Handle practice revision button
      if (data && data.startsWith('practice_revision:')) {
        const questionId = parseInt(data.substring(18), 10);
        try {
          await markQuestionRevision(questionId);
          if (botToken) {
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: `🔄 Marked for revision — will reappear in <b>2 days</b> ↩️`,
              parse_mode: 'HTML',
              reply_to_message_id: callback_query.message.message_id
            });
          }
        } catch (err: any) {
          console.error('Error marking revision:', err?.message || err);
        }
      }

      // Handle practice understood button
      else if (data && data.startsWith('practice_understood:')) {
        const questionId = parseInt(data.substring(20), 10);
        try {
          await markQuestionUnderstood(questionId);
          if (botToken) {
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: `✅ Marked as <b>fully understood</b> — won't appear again 🧠`,
              parse_mode: 'HTML',
              reply_to_message_id: callback_query.message.message_id
            });
          }
        } catch (err: any) {
          console.error('Error marking understood:', err?.message || err);
        }
      }

      // Handle topic selection button
      else if (data && data.startsWith('select_topic:')) {
        const topic = data.substring(13); // Extract topic name
        try {
          const questions = await getQuestions(topic);

          if (questions.length === 0) {
            if (botToken && botToken !== 'your_telegram_bot_token_here') {
              await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: `No questions found in topic "${escapeHtml(topic)}".`
              });
            }
          } else {
            // Build individual question strings
            const header = `<b>Questions in ${escapeHtml(topic)} (${questions.length}):</b>\n\n`;
            const questionStrings = questions.map(
              (q, idx) => `<b>${idx + 1}. [${escapeHtml(q.sub_topic || 'General')}]</b>\n${escapeHtml(q.question)}`
            );

            // Chunk messages to stay under Telegram's 4096 char limit
            const MAX_LEN = 4000;
            const chunks: string[] = [];
            let current = header;

            for (const qs of questionStrings) {
              if ((current + qs + '\n\n').length > MAX_LEN) {
                chunks.push(current);
                current = '';
              }
              current += (current.length > 0 && current !== header ? '\n\n' : '') + qs;
            }
            if (current.length > 0) chunks.push(current);

            if (botToken && botToken !== 'your_telegram_bot_token_here') {
              for (const chunk of chunks) {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: chunk,
                  parse_mode: 'HTML'
                });
              }
            } else {
              console.log(`Questions in topic ${topic}:\n`, chunks.join('\n---\n'));
            }
          }
        } catch (err: any) {
          console.error('Error fetching questions for topic:', err?.message || err);
          if (err?.response) {
            console.error('Response status:', err.response.status);
            console.error('Response data:', JSON.stringify(err.response.data));
          }
        }
      }
    }
    // Handle standard messages
    else if (message && message.chat && message.chat.id) {
      const chatId = message.chat.id;
      const text = message.text as string | undefined;
      const photo = message.photo;

      // Log chat ID for owner identification
      console.log(`Message from chat ID: ${chatId}`);

      // Handle screenshots / photos
      if (photo && photo.length > 0) {
        if (!botToken || botToken === 'your_telegram_bot_token_here') {
          console.warn('Warning: TELEGRAM_BOT_TOKEN is not configured. Cannot process photo webhook.');
        } else {
          // Get the largest photo size
          const largestPhoto = photo[photo.length - 1];
          const fileId = largestPhoto.file_id;

          // Retrieve file path
          const fileResponse = await axios.get(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
          if (fileResponse.data && fileResponse.data.ok) {
            const filePath = fileResponse.data.result.file_path;

            // Download file as arraybuffer
            const downloadResponse = await axios.get(`https://api.telegram.org/file/bot${botToken}/${filePath}`, {
              responseType: 'arraybuffer'
            });
            const base64Image = Buffer.from(downloadResponse.data, 'binary').toString('base64');

            // Extract questions using OpenAI Vision
            const questions = await extractQuestionsFromImage(base64Image);

            if (questions.length > 0) {
              // Classify and save each question
              await Promise.all(
                questions.map(async (q) => {
                  const { topic, subTopic } = await classifyQuestion(q);
                  await saveQuestion(q, topic, subTopic);
                })
              );
            }

            // Reply back to Telegram
            const replyText = `Found ${questions.length} questions.`;
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: replyText
            });
          }
        }
      }
      // Handle normal text message (not starting with /)
      else if (text && !text.startsWith('/')) {
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        if (lines.length === 1) {
          const question = lines[0];
          // Classify the question using OpenAI
          const { topic, subTopic } = await classifyQuestion(question);

          // Save the question to the database
          await saveQuestion(question, topic, subTopic);

          if (!botToken || botToken === 'your_telegram_bot_token_here') {
            console.warn('Warning: TELEGRAM_BOT_TOKEN is not configured.');
          } else {
            // Send response back to Telegram
            const replyText = `✅ Saved\nTopic: ${topic}\nSub Topic: ${subTopic}`;
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: replyText
            });
          }
        } else if (lines.length > 1) {
          // Save and classify each question
          await Promise.all(
            lines.map(async (line) => {
              const { topic, subTopic } = await classifyQuestion(line);
              await saveQuestion(line, topic, subTopic);
            })
          );

          if (!botToken || botToken === 'your_telegram_bot_token_here') {
            console.warn('Warning: TELEGRAM_BOT_TOKEN is not configured.');
          } else {
            const replyText = `Saved ${lines.length} questions.`;
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: replyText
            });
          }
        }
      }
      // Handle commands (starting with /)
      else if (text && text.startsWith('/')) {
        const parts = text.split(' ');
        const command = parts[0].toLowerCase();

        if (command === '/help') {
          const helpText = `<b>📖 AI Interview Question Vault Bot</b>

Send any text message to save it as an interview question.
Send a photo/screenshot to extract questions using AI.

<b>Available Commands:</b>
/help - Show this help message
/topics - List all saved topics
/search &lt;keyword&gt; - Search questions by keyword
/random - Show a random interview question
/practice - Start a practice session (20 questions)`;

          if (botToken && botToken !== 'your_telegram_bot_token_here') {
            await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              chat_id: chatId,
              text: helpText,
              parse_mode: 'HTML'
            });
          } else {
            console.log('Help command received, but token not configured.');
          }
        } else if (command === '/topics') {
          try {
            const questions = await getQuestions();
            const topicCounts: { [key: string]: number } = {};
            questions.forEach((q) => {
              const t = q.topic || 'General';
              topicCounts[t] = (topicCounts[t] || 0) + 1;
            });

            if (Object.keys(topicCounts).length === 0) {
              const replyText = 'No questions or topics saved yet.';
              if (botToken && botToken !== 'your_telegram_bot_token_here') {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: replyText
                });
              } else {
                console.log(replyText);
              }
            } else {
              const inlineKeyboard = Object.entries(topicCounts).map(([topic, count]) => {
                return [
                  {
                    text: `${topic} (${count})`,
                    callback_data: `select_topic:${topic}`
                  }
                ];
              });

              if (botToken && botToken !== 'your_telegram_bot_token_here') {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: 'Select a topic to view its questions:',
                  reply_markup: {
                    inline_keyboard: inlineKeyboard
                  }
                });
              } else {
                console.log('Topics command processed with inline keyboard simulation:');
                console.log(JSON.stringify(inlineKeyboard, null, 2));
              }
            }
          } catch (err: any) {
            console.error('Error in /topics:', err?.message || err);
          }
        } else if (command === '/search') {
          const keyword = parts.slice(1).join(' ').trim();
          if (!keyword) {
            if (botToken && botToken !== 'your_telegram_bot_token_here') {
              await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: 'Please specify a keyword to search. Example: /search Java'
              });
            } else {
              console.log('Search command received without keyword.');
            }
          } else {
            try {
              const results = await searchQuestions(keyword);
              if (results.length === 0) {
                const replyText = `No questions found matching "${keyword}".`;
                if (botToken && botToken !== 'your_telegram_bot_token_here') {
                  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    chat_id: chatId,
                    text: replyText
                  });
                } else {
                  console.log(replyText);
                }
              } else {
                const resultsList = results
                  .map((q, idx) => `<b>${idx + 1}. [${escapeHtml(q.topic || 'General')}]</b>\n${escapeHtml(q.question)}`)
                  .join('\n\n');
                const replyText = `<b>Matching questions for "${escapeHtml(keyword)}":</b>\n\n${resultsList}`;

                if (botToken && botToken !== 'your_telegram_bot_token_here') {
                  await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    chat_id: chatId,
                    text: replyText,
                    parse_mode: 'HTML'
                  });
                } else {
                  console.log(replyText);
                }
              }
            } catch (err: any) {
              console.error('Error in /search:', err?.message || err);
            }
          }
        } else if (command === '/random') {
          try {
            const questions = await getQuestions();
            if (questions.length === 0) {
              const replyText = 'No questions saved yet.';
              if (botToken && botToken !== 'your_telegram_bot_token_here') {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: replyText
                });
              } else {
                console.log(replyText);
              }
            } else {
              const randomIndex = Math.floor(Math.random() * questions.length);
              const randomQ = questions[randomIndex];
              const replyText = `🎲 <b>Random Question</b> [ID: ${randomQ.id}]\n\n<b>Topic:</b> ${escapeHtml(randomQ.topic || 'General')} / ${escapeHtml(randomQ.sub_topic || 'General')}\n\n<b>Question:</b>\n${escapeHtml(randomQ.question)}`;

              if (botToken && botToken !== 'your_telegram_bot_token_here') {
                await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  chat_id: chatId,
                  text: replyText,
                  parse_mode: 'HTML'
                });
              } else {
                console.log('Random question selected:\n', replyText);
              }
            }
          } catch (err: any) {
            console.error('Error in /random:', err?.message || err);
          }
        } else if (command === '/practice') {
          // Owner-only: manual trigger for daily practice
          if (OWNER_CHAT_ID && chatId.toString() !== OWNER_CHAT_ID) {
            if (botToken) {
              await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                chat_id: chatId,
                text: '🔒 This command is only available to the bot owner.'
              });
            }
          } else {
            await sendDailyPractice();
          }
        }
      }
    }
  } catch (error: any) {
    console.error('Error handling webhook update:', error?.message || error);
  }

  // Always respond with 200 OK to Telegram to acknowledge receipt
  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  if (OWNER_CHAT_ID) {
    console.log(`Owner chat ID: ${OWNER_CHAT_ID}`);
  } else {
    console.log('⚠️  OWNER_CHAT_ID not set. Send any message to the bot and check logs for your chat ID.');
  }
});
